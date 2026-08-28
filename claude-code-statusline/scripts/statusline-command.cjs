#!/usr/bin/env node
'use strict';

// Claude Code status line, in node — deliberately no jq.
//
// jq is NOT guaranteed present, and on Windows this command runs under
// git-bash (Claude Code routes statusLine through Git Bash when it is
// installed), where jq is typically absent while node is present in any
// Node project. Every jq call in a jq-based script then fails with
// "command not found", and because a status line's natural error handling
// treats empty output as "field absent", it degrades to blank/n/a/0 values
// instead of failing loudly — a broken status line that looks finished.
//
// Line 1: current directory, git branch, model name.
// Line 2: ctx used/total (pct) | tok: session tokens | cost $X.XX | 5h X% / 7d Y%
//
// cost comes from cost.total_cost_usd, which Claude Code computes itself —
// never re-derive it from a hardcoded per-model price table, which silently
// drifts as pricing changes and as new models ship.
//
// Cumulative session TOKENS are the one figure the payload genuinely does
// not carry (context_window describes only the live context window), so
// they are summed from transcript_path.
//
// IMPORTANT: a single assistant turn can appear as several JSONL lines (one
// per content block — e.g. a "thinking" block and the "tool_use" block that
// follows it), and every line for that turn repeats the SAME usage object
// under the SAME message.id. Summing every assistant line naively
// multiply-counts a turn's tokens once per content block. Measured on a real
// transcript: 15 assistant usage lines, 7 unique message.id — a 2.1x
// over-count. Usage is therefore counted once per unique message.id.

const fs = require('fs');
const { execFileSync } = require('child_process');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function fmtNum(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) n = 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

let payload;
try {
  payload = JSON.parse(readStdin() || '{}');
} catch (e) {
  payload = {};
}

const dir = (payload.workspace && payload.workspace.current_dir) || payload.cwd || '';
const model = (payload.model && payload.model.display_name) || 'unknown';
const transcriptPath = payload.transcript_path || '';

// Split on both separators: cwd is a native Windows path on Windows.
const dirDisplay = dir ? dir.split(/[\\/]/).filter(Boolean).pop() : '(unknown)';

let branch = '';
if (dir) {
  try {
    execFileSync('git', ['--no-optional-locks', 'rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: 'ignore',
    });
    branch = execFileSync('git', ['--no-optional-locks', 'branch', '--show-current'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (e) {
    branch = '';
  }
}

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

// --- Line 1: cwd / branch / model ---
let line1 = `${CYAN}${dirDisplay}${RESET}`;
if (branch) line1 += ` ${YELLOW}(${branch})${RESET}`;
line1 += ` ${MAGENTA}[${model}]${RESET}`;

// --- Live context window. Both are 0 before the first API response. ---
const cw = payload.context_window || {};
const ctxUsed = typeof cw.total_input_tokens === 'number' ? cw.total_input_tokens : null;
const ctxSize = typeof cw.context_window_size === 'number' ? cw.context_window_size : null;
// used_percentage is pre-calculated (input tokens only) — prefer it over
// recomputing, so the number always agrees with what Claude Code reports.
const ctxPct = typeof cw.used_percentage === 'number' ? Math.round(cw.used_percentage) : null;
let ctxStr = ctxUsed !== null && ctxSize !== null ? `${fmtNum(ctxUsed)}/${fmtNum(ctxSize)}` : 'n/a';
if (ctxPct !== null) ctxStr += ` (${ctxPct}%)`;

// --- Cumulative session tokens, summed from the transcript, deduped by message.id ---
let tokTotal = 0;
if (transcriptPath && fs.existsSync(transcriptPath)) {
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const seenMessageIds = new Set();
    for (const rawLine of raw.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (e) {
        continue;
      }
      if (entry.type !== 'assistant' || !entry.message || !entry.message.usage) continue;
      const msgId = entry.message.id;
      if (msgId) {
        if (seenMessageIds.has(msgId)) continue;
        seenMessageIds.add(msgId);
      }
      const u = entry.message.usage;
      tokTotal +=
        (u.input_tokens || 0) +
        (u.output_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0);
    }
  } catch (e) {
    // leave the total at 0 on any read/parse failure
  }
}

// --- Session cost: taken from the payload, never recomputed. ---
const cost = payload.cost || {};
const costStr = typeof cost.total_cost_usd === 'number' ? cost.total_cost_usd.toFixed(2) : 'n/a';

// --- Claude.ai rate-limit usage ---
const rl = payload.rate_limits || {};
const five = rl.five_hour && typeof rl.five_hour.used_percentage === 'number' ? rl.five_hour.used_percentage : null;
const week = rl.seven_day && typeof rl.seven_day.used_percentage === 'number' ? rl.seven_day.used_percentage : null;
const fiveStr = five !== null ? `${Math.round(five)}%` : 'n/a';
const weekStr = week !== null ? `${Math.round(week)}%` : 'n/a';

const line2 =
  `${BLUE}ctx${RESET} ${ctxStr} ${BLUE}|${RESET} ` +
  `${GREEN}tok:${RESET} ${fmtNum(tokTotal)} ${BLUE}|${RESET} ` +
  `${GREEN}cost${RESET} $${costStr} ${BLUE}|${RESET} ` +
  `${YELLOW}5h${RESET} ${fiveStr} ${BLUE}/${RESET} ${YELLOW}7d${RESET} ${weekStr}`;

process.stdout.write(`${line1}\n${line2}`);
