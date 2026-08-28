---
name: claude-code-statusline
description: Writing a Claude Code status line command (the `statusLine` setting) that is correct rather than merely plausible - which numbers the stdin payload already provides (cost, context percentage) versus the one it genuinely does not (cumulative session tokens), the per-content-block duplication that makes naive transcript summing over-count by 2x or more, why jq is the wrong dependency and git-bash is the shell your command actually runs in on Windows, and the fact that a broken status line degrades to plausible-looking zeros instead of erroring. Load when creating, debugging, or reviewing a status line, a `/statusline` result, or any script that parses Claude Code's session JSON or its JSONL transcript.
---

# Claude Code status lines

A status line is a shell command that receives session JSON on stdin and prints what you
want shown at the bottom of the interface. Its defining hazard is that **it has no failure
mode a user will notice**: a missing tool, a wrong field name, or a corrupted script all
produce blank or `0` output, which is exactly what a correct status line prints before the
first API response. It looks finished while being wrong end to end. Every rule below exists
because of that.

Working implementation: `scripts/statusline-command.cjs` - node, no dependencies, two lines
(cwd/branch/model, then context/tokens/cost/rate-limits). Referenced throughout.

---

## 1. Take every number the payload already gives you; derive ONLY what it does not

The single most common defect is re-deriving a value Claude Code already computed, which
turns a correct number into one that silently drifts.

- **NEVER hardcode a per-model price table to compute session cost.** `cost.total_cost_usd`
  is in the payload, computed client-side by Claude Code itself. A hand-rolled table
  (`opus: {input: 15, output: 75, ...}`, matched by substring on the model name) is wrong the
  day pricing changes or a model ships whose name misses every branch and silently falls
  through to a default tier. The payload also carries `cost.total_duration_ms`,
  `cost.total_api_duration_ms`, `cost.total_lines_added`, `cost.total_lines_removed`.
- Prefer `context_window.used_percentage` over recomputing a percentage, so your number
  always agrees with what Claude Code reports elsewhere. If you must compute it, use the
  input-only formula it uses - `input_tokens + cache_creation_input_tokens +
  cache_read_input_tokens`, **excluding** `output_tokens`. Note `context_window.total_input_tokens`
  already includes both cache fields.
- Also free in the payload, no work required: `model.display_name`, `workspace.current_dir`
  and `workspace.project_dir` (which differ once the session changes directory),
  `workspace.git_worktree`, `workspace.repo.{host,owner,name}` parsed from the `origin`
  remote, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`, `session_id`,
  `session_name`, `version`, `exceeds_200k_tokens`, `fast_mode`, `effort.level`,
  `thinking.enabled`, `output_style.name`, `vim.mode`.
- **The one figure genuinely absent is a cumulative session TOKEN count.** `context_window`
  describes only the live context window (and resets on `/compact`); `cost` carries dollars
  and durations but no token total. That, and only that, justifies reading
  `transcript_path` - see §2. Confirm a field is truly missing before parsing the transcript
  for it; the transcript is the expensive, fragile path.
- `context_window.current_usage` is `null` before the first API call and again right after
  `/compact` until the next call. `total_input_tokens` / `total_output_tokens` are `0` in the
  same window. Handle both without printing something alarming.

## 2. When you do sum the transcript, dedup by `message.id` - or over-count by 2x

The JSONL transcript at `transcript_path` does not have one line per assistant turn. A
single turn is written as **several lines, one per content block** - a `thinking` block, then
the `tool_use` block that follows it - and **every one of those lines repeats the identical
`usage` object under the identical `message.id`**.

- Summing `message.usage` per LINE multiplies a session's token total by however many content
  blocks its average turn contains. Measured on a real transcript while writing this skill:
  **15 assistant lines carrying `usage`, 7 unique `message.id`** - a 2.1x over-count. The
  ratio is not a constant to correct for; it rises with thinking and tool use.
- MUST track a `Set` of seen `message.id` and count each turn once
  (`scripts/statusline-command.cjs:107-136`). Filter to `entry.type === 'assistant'` with a
  present `entry.message.usage` first.
- Token total is `input_tokens + output_tokens + cache_creation_input_tokens +
  cache_read_input_tokens`. Omitting the cache fields under-reports heavily, since cache reads
  dominate a long session.
- Wrap the whole read in try/catch and fall back to `0`, but understand you are choosing to
  show a wrong-looking number over crashing. Never let a parse failure on one line abort the
  loop - `continue` past unparseable lines.
- Cost note: this file is re-read on **every assistant message** (§5). It grows without bound
  over a long session. That is an accepted tradeoff for one number; do not extend the same
  scan to compute things the payload already has.

## 3. `jq` is the wrong dependency, and on Windows the command does not run in your shell

The official examples use `jq`, which makes it the default reach. It is not present
everywhere.

- On Windows, **Claude Code routes the `statusLine` command through Git Bash when Git Bash is
  installed**, and through PowerShell only when it is absent. So the relevant `PATH` is
  git-bash's, not PowerShell's - and a Windows box with a complete Node/git/PowerShell
  toolchain routinely has no `jq` there (verified on this machine: `which jq` returned nothing
  across all 27 `PATH` entries). Every `jq` call then fails with `command not found`, and
  because empty output reads as "field absent", the line degrades to `n/a`/`0` rather than
  erroring. Nothing surfaces.
- Prefer a runtime whose presence you have confirmed. `node` is guaranteed in any Node
  project and has JSON parsing built in; rewriting from `jq` to plain node removes the
  dependency instead of documenting an install step. Python is an equivalent choice.
- **Write the script path in `command` with forward slashes.** Git Bash consumes unquoted
  backslashes as escapes, so `C:\Users\me\statusline.cjs` reaches the runner with its
  separators eaten and fails with no visible error. `~` works and expands to the Windows home
  directory. A known-good form:
  ```json
  { "statusLine": { "type": "command", "command": "node ~/.claude/statusline-command.cjs" } }
  ```
- To run PowerShell deliberately, invoke it explicitly - this works regardless of which shell
  Claude Code picks: `"command": "powershell -NoProfile -File C:/Users/me/.claude/statusline.ps1"`.
- Parse `cwd` on **both** separators (`dir.split(/[\\/]/)`). On Windows the payload's paths are
  native backslash form, even though the script runs under git-bash.
- Do not assume macOS parity in either direction. A macOS box typically has `jq` via Homebrew
  and a uniform posix path universe; neither is a safe premise for a script meant to be shared.

## 4. A status line cannot be verified by reading it - run it with a real payload

"Wrote the script" and "verified the script" are different claims, and only the second is
safe to report.

- MUST pipe a realistic payload into the finished script and read its stdout before calling
  it done. Then repeat with the degenerate cases, all of which occur in normal use:
  `{}` (and malformed stdin), a payload with `context_window` zeroed (pre-first-response),
  and a `cwd` outside any git repository. All four must print something sensible and exit 0.
- Point `transcript_path` at a real `.jsonl` for at least one run. A wrong path is
  indistinguishable from an empty session, because both yield `0`.
- **Beware backslash collapse when authoring the script through a shell heredoc.** Writing
  this skill's own script through a quoted heredoc silently turned `dir.split(/[\\/]/)` into
  `dir.split(/[\/]/)` - one round of escape processing halved the `\\` while leaving `\x1b`
  and `\n` intact. The result parsed, ran, exited 0, and printed the entire path where the
  folder name belonged. Same failure class as everything else here: plausible output, wrong.
  After writing a script this way, grep every line containing a backslash and confirm each
  one, or use a file-writing tool instead of the shell. The same collapse corrupts a
  hand-written JSON test payload containing Windows paths; build such a payload
  programmatically rather than typing escapes into a heredoc.
- If a subagent with no shell/exec tools (Read/Edit only) writes the script, it **cannot**
  perform this verification. Say so plainly rather than substituting a weaker check -
  re-reading the source, hand-tracing one example - and presenting it as equivalent. Have a
  session that does have a shell run the real test.
- When a live status line misbehaves, `claude --debug` logs the exit code and stderr of the
  first invocation of the session. Check also that output goes to **stdout**, not stderr, and
  that `disableAllHooks` / `allowManagedHooksOnly` are not suppressing it - the latter makes a
  custom status line vanish with no warning.

## 5. Output contract, and the fact that it runs constantly

- Each printed line becomes one row. Emit **no trailing newline** after the final line, or you
  get a blank row. `scripts/statusline-command.cjs` uses a single
  `process.stdout.write(line1 + "\n" + line2)` for exactly this reason.
- ANSI color codes work. OSC 8 hyperlinks work only in terminals that support them (iTerm2,
  Kitty, WezTerm - not Terminal.app).
- `tput cols` and language-level width detection do **not** work: Claude Code captures stdout
  rather than attaching a tty. Read the `COLUMNS` and `LINES` environment variables, which it
  sets before running your script.
- It runs at session start and resume, on every new assistant message, after `/compact`, on
  permission-mode and vim-mode changes, when the `command` setting itself changes, on a
  `refreshInterval` tick if configured, and when a rate-limit window passes its `resets_at`.
  Updates are debounced 300ms and an in-flight run is cancelled by the next trigger. **Keep it
  fast and side-effect free** - it is not a place to run a network call or anything that
  mutates repo state.
- Event triggers go quiet while the session is idle (e.g. waiting on background subagents).
  Set `refreshInterval` (minimum 1 second) only if you display a clock or externally-sourced
  data that must move during idle time.
- `padding` (default `0`) adds horizontal spacing relative to the built-in indentation. Set
  `hideVimModeIndicator: true` if you render `vim.mode` yourself, to avoid showing it twice.
- The status line runs locally and consumes no API tokens.

## 6. Installing

Copy `scripts/statusline-command.cjs` to `~/.claude/` and point settings at it:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline-command.cjs"
  }
}
```

Claude Code reloads settings on save and re-runs the command immediately on a `command`
change, so there is nothing to restart. `/statusline` will write this configuration for you
from a description, but review what it produces against §1 and §3 - a generated script is a
prime candidate for both the hardcoded-price-table and the assumed-`jq` defects.
