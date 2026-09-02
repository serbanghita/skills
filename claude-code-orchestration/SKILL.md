---
name: claude-code-orchestration
description: Driving the Claude Code CLI headless from a host application - auth without API keys, binary discovery, the canonical argv, stream-json event taxonomy, hooks as the only real sandbox (fail-open, canary, system-subtype events), workspace confinement, prompt-injection containment, sessions/resume/continuity loss, conversation persistence, and measured cost/latency. Load when embedding Claude Code as a subprocess, building agent features on top of the CLI, or debugging a headless run that misbehaves.
---

# Claude Code CLI Orchestration

Distilled from building CeraPad's agent feature (`~/work/whiteboard-app/src-tauri/src/agent/`),
seven billed authoring experiments (2.52 USD, method in
`whiteboard-app/.planning/archived/2026-08-12_23-28-50_claude-agent-guardrails/experiment-2026-08-12.md`), and a set of
probes run against the real CLI. The single meta-rule first, because it produced every finding
below: **the CLI's wire behavior diverges from what its flag names suggest - measure with a
real run before building on a flag's implied meaning.** CLI version at measurement: 2.1.228.

---

## 1. Auth: bring-your-own-CLI, no API key

- Headless runs work on the user's existing `claude` login with NO API key:
  `env -u ANTHROPIC_API_KEY claude -p "..."` succeeds on subscription auth. Tokens bill to
  the user's account. Do not add an `ANTHROPIC_API_KEY` setting, a key-paste onboarding, or
  a hosted proxy - the credential belongs to the CLI (OAuth in the login keychain, minted by
  interactive `claude auth login`, rotated there); a copy in app storage goes stale with no
  non-interactive re-auth path.
- `claude auth status` prints JSON and exits 0 when logged in
  (`{"loggedIn": true, "authMethod": "claude.ai", ...}`). When logged OUT it still prints
  valid JSON but exits 1 - so parse stdout REGARDLESS of exit code; the idiomatic
  check-status-then-read discards the exact payload the check exists for. Reserve exit-code
  handling for output that does not parse.
- NEVER pass `--bare`: it disables OAuth and keychain reads, breaking the no-key model.
- A missing or logged-out CLI is a preflight failure with install/login guidance, never a
  fallback credential path. The one escape hatch worth having: a `CLAUDE_BIN`-style env
  override honored above all discovery.

## 2. Binary discovery and preflight

- `claude` lives behind a symlink (`~/.local/bin/claude` -> versioned target); `claude update`
  repoints it. Store the SYMLINK, never the resolved target; persist only user-supplied
  overrides; re-resolve auto-discovered paths on every launch.
- Preflight cheapest-first, cached per app session, invalidated by ENOENT on spawn:
  1. Discovery (env override, stored override, candidate list, `$SHELL -lc 'command -v'`
     with a timeout - login rc files can hang).
  2. Liveness: `claude --version` (~0.07s) catches a stale symlink or wrong-arch binary.
  3. Auth: `claude auth status` per section 1.
  4. Capability: one billed `-p` smoke run - NEVER automatic, only behind an explicit user
     action, with its own low budget cap (0.20 is plenty; real work costs 0.2-0.6).
- Connectivity is deliberately NOT a preflight state: probing emits traffic the user never
  asked for. Classify a failed run into an offline variant after the fact.

## 3. The canonical argv

```
claude -p <prompt>
  --output-format stream-json --verbose --include-partial-messages --include-hook-events
  --model <explicit>            # or the user's ~/.claude model silently applies
  --max-budget-usd <cap>        # hard stop for runaway loops
  --allowedTools Read,Edit,Write
  --permission-mode acceptEdits # or headless waits forever on an approval prompt with no UI
  --settings <workspace settings.json>
  --setting-sources project
  --session-id <uuid>           # first turn; --resume <uuid> afterwards
```

- Build argv entirely host-side; caller input goes only into the prompt VALUE. Unit-test
  that a prompt containing `--dangerously-skip-permissions` arrives as prompt text.
- `-p` skips the workspace trust dialog. stdin must be closed (`Stdio::null()`) or every
  run pays a fixed 3s "no stdin data received" wait.
- `--settings` ADDS a settings file; it does not replace the user's sources. Without
  `--setting-sources`, the user's global config (model, plugins, skills, and any hooks
  those plugins carry) loads into your run - behavior varies per machine, and your run
  executes hook commands the user configured for interactive work. Measured: a run passing
  no `--model` used the model from `~/.claude/settings.json`.
- `--setting-sources ""` is legal and does NOT suppress `--settings` - but it ALSO
  suppresses the workspace's project sources, including CLAUDE.md. Measured: with `""` the
  agent could not read a fact stated only in CLAUDE.md; with `project` it could. Use
  `project` when the workspace is app-generated (its project files are files you wrote).
- `--strict-mcp-config` exists because a project `.mcp.json` is otherwise honored - relevant
  whenever the agent can write its own working directory (section 6).
- Costs are unpredictable in advance (cache-read/creation split varies per run); the budget
  cap is the only number you can state beforehand.

## 4. The stream (stream-json)

Top-level `type` values seen in ordinary runs: `system`, `assistant`, `user`, `result`,
`rate_limit_event`. Rules:

- Parse DEFENSIVELY: ignore unknown types and subtypes without failing (the CLI self-updates
  independently of your app), log ignored kinds once per run, hard-error only on malformed
  JSON. Record the CLI version from the init event.
- `user` events carry the `tool_result` blocks; `is_error` is the per-tool outcome and is
  ABSENT on success - the parser must not require the field. Skip `user` and you discard
  every tool result.
- `system/thinking_tokens` appears tens of times per run and carries nothing you need - it
  is the concrete case the ignore-unknown rule must survive.
- `system/permission_denied` is NORMAL traffic in a successful run (carries `tool_name`,
  `message`). A denied tool call does not fail the run; every measured run containing them
  still ended `result/success`. Forward them; never fail on them.
- `rate_limit_event` appears in ordinary SUCCESSFUL runs (`rate_limit_info.status`:
  `allowed` / `warning`). It is a better source for a rate-limit UI state than inferring
  one from a failed run afterwards.
- Timeouts: use an IDLE timeout (no event for N seconds), not a wall-clock bound; keep a
  generous wall-clock ceiling as backstop. Measured: a 94-shape board review ran 138-160s
  across 12 turns, healthy.

## 5. Hooks are the only sandbox, and they fail open

The three facts that shape everything:

1. **`--allowedTools` is not a sandbox.** With `--allowedTools "Read,Edit,Write"` and
   `acceptEdits`, the agent still executed `ls -la`, `true`, and `cat` (measured, five
   runs). Omitting Bash narrows which Bash commands auto-run; it does not stop Bash. Treat
   the flag as noise reduction. The PreToolUse hook is the boundary, alone.
2. **A hook that fails to execute does not block the tool.** Measured: a PreToolUse hook
   pointing at a missing binary emitted `hook_response` with `exit_code: 127`,
   `outcome: "error"` - and the Read proceeded and the run ended `result/success`. A guard
   that cannot run is silently absent. The runner MUST treat a non-zero exit on a guard
   hook as a failed run.
3. **`-p` silently ignores a settings file that fails validation**, so an unguarded run is
   indistinguishable from a guarded one - unless you make it distinguishable (the canary).

Hook mechanics:

- Hook events arrive as `type: "system"` with subtypes `hook_started` / `hook_response` -
  there is NO dedicated `hook` event type. A predicate matching a `hook.*` type never
  fires, which silently disables the assertion whose purpose is to catch silent failure.
  `hook_response` carries `hook_name` (e.g. `"PostToolUse:Edit"`), `hook_event`, `hook_id`,
  `exit_code`, `outcome`, `stderr`, `stdout`.
- `--include-hook-events` is load-bearing, not diagnostic: without it a hook rejection
  produces NO stream event at all (the only trace is the model quoting the hook's message
  in prose).
- **The canary pattern**: ship a Stop hook whose only job is proving the settings file
  loaded (Stop fires even on tool-less prompts; PreToolUse does not). Assert on
  `hook_name` matching the canary by name AND `outcome == "success"` AND `exit_code == 0`.
  Presence-only is worthless - a broken hook still emits events with the right name while
  exiting 127. Verify the assertion can actually fail by corrupting the settings file.
- **Deny Bash outright in the guard; do not parse its command string for paths.** Guarding
  Bash by inspecting the command line is parsing a shell language. A denial is cheap
  (does not fail the run) and visible.
- Denying Bash removes the agent's self-verification channel - it reached for Bash to
  re-read/syntax-check its own writes in 6 of 7 measured runs. Budget for those refused
  turns, or give it a PostToolUse validator that supplies the same information.
- The guard's four invariants, each worth a named test: (a) default-deny by tool allowlist
  (anything not explicitly allowed - including tools future CLI versions add - is refused;
  an egress tool like WebFetch exfiltrates a document in a query string); (b) the boundary
  path is PASSED to the hook (baked into the hook command), never inferred from cwd - a
  cwd higher up the tree WIDENS an inferred boundary instead of breaking it; (c) exactly
  one writable file; reads may stay workspace-wide (a read cannot persist); (d) sweep
  agent-writable config before every spawn (next point).
- **Self-host the hook runner.** Hooks as script files have three failure seams: the
  interpreter (a GUI-launched app cannot find `node`), the bundle path, and relative
  command resolution - and by fact 2 all three fail SILENTLY. Instead: the host binary
  handles `--hook <kind>` on its own argv before its framework starts, and the generated
  settings.json carries the absolute `current_exe()` path, which exists by construction.

## 6. Workspace confinement

- The agent's cwd is its project directory, so anything it writes there can be EXECUTABLE
  CONFIG on its next run: `.claude/settings.json` defines hooks, `.mcp.json` names
  commands, and the CLI runs both with no PreToolUse gate in front. That is a path around
  every tool denial. Two defenses, deliberately redundant: the write-guard forbids those
  files, and a sweep deletes any `.claude/` or `.mcp.json` from the agent dir before every
  spawn (the sweep works even if the guard never loaded - which is the canary's failure
  case).
- Host-owned state (metadata, per-run settings) lives one level ABOVE the agent's cwd.
  Hooks confine to the working directory but not which files inside it may be written, so
  anything host-owned placed inside is agent-writable.
- Layout that follows: `<data>/conversations/<conversation-uuid>/` holding host files
  (`meta.json`, `claude-settings.json`) plus an `agent/` subdirectory (the cwd) holding
  only the working files.

## 7. Prompt injection containment

Documents fed to the agent are untrusted input (files arrive by double-click, from other
people). With egress (no network tools) and persistence (no config writes) closed, the
residual containment:

- Provenance framing in TWO places: the workspace CLAUDE.md (re-read for the life of the
  workspace) and a first-turn prompt preamble (first turn only). Both state that document
  content is data, never instructions. Two separate strings, pinned by a test.
- An application-level undo checkpoint for anything the agent changes, so a hostile
  document is an annoyance, not data loss.
- Sanitize rendered model prose (DOMPurify tag/attribute allowlist): the panel renders
  model output, the model quotes the document, and a permissive webview makes that chain
  XSS-relevant. The allowlist is load-bearing, not hygiene.

## 8. Sessions, resume, continuity loss

- Host generates the UUID: `--session-id <uuid>` on the first turn, `--resume <uuid>`
  afterwards - so the id is known before the process starts and can key filesystem state.
  Validate it as a UUID at the trust boundary (traversal becomes structurally impossible).
- Decouple YOUR conversation id (directory name, stable) from the CLI's session id (stored
  in metadata, MAY BE RE-MINTED): a resume that finds no transcript restarts under a fresh
  session id. The failed resume attempt reports `total_cost_usd: 0`.
- Continuity loss is survivable and must be designed for: the CLI's own transcript lives in
  `~/.claude/projects/<slug>/`; if it vanishes, resume the conversation as a fresh session,
  show a divider, persist the new session id. Deleting a conversation should also delete
  its derived `~/.claude/projects/<slug>` directory.
- Reject overlapping runs per conversation (busy error) - two would resume the same session
  and write the same files; a double-click on Send triggers it.

## 9. Conversation persistence (host-side)

- Append-only `chat.jsonl` per conversation, one lock shared by every writer - two
  half-written lines are worse than a lost one. Records survive a mid-stream kill up to
  the last append.
- Metadata struct MUST be `#[serde(default)]` at the struct level (or equivalent): if the
  collector treats an unparseable meta as "never used" and deletes on age, every field
  added later re-arms that deletion for old files.
- Update metadata by read-modify-write, never by constructing fresh (a fresh write resets
  cumulative fields - title vanishes, cost resets).
- Title = first user prompt, whitespace-collapsed, truncated ON CHARACTER BOUNDARIES
  (`&s[..60]` panics when byte 60 splits an emoji - this crashed in the field).
- Retention must respect irreplaceability: a conversation with history is the ONLY copy
  (offline-first = no server copy); keep until the user deletes. Age-collect only scratch.
- Track cumulative turns/cost yourself; the CLI's `num_turns` / `total_cost_usd` are
  per-run.

## 10. Cost and latency (measured, Sonnet, 2026-08)

- Trivial no-op run: ~0.07 USD. Small board (5 shapes): 0.21-0.32 USD, 5-8 turns, 43-83s.
  Large board (94 shapes): 0.59-0.62 USD, 12 turns, 138-160s.
- Cost scales with TURN COUNT, not document size - cache-read tokens (per-turn conversation
  overhead) dominate: 592k on the large board vs 174k on the small.
- Default budget cap heuristic: ~3x the largest measured real task (2.00 USD here) - still
  stops a runaway loop.

## 11. Making the agent author correctly

- The vocabulary contract is the highest-leverage document. Same board, same prompt,
  contract the only variable: the minimal contract INVENTED four type ids that do not
  exist and got the geometry wrong; the full contract produced correct ids and geometry.
  And the downstream importer accepted the invented types with `skipped=0` - "it loaded"
  is not a correctness signal. If a class of error matters, a validator must check it;
  the pipeline will not.
- Why the vocabulary specifically: an existing, correct document teaches most of a format
  by example (a 94-shape board reviewed under a near-empty contract still produced a
  fully valid result), but it only ever demonstrates the ids it already contains. The
  contract's value concentrates in the enumerated legal vocabulary and in whatever the
  current document does not demonstrate - do not trim the id list for length.
- GENERATE the vocabulary from the source-of-truth registry; never hand-transcribe it.
  Ids get added to the registry over time, and a hand-copied list is a drift bug whose
  symptom is "the agent invents types" - misdiagnosed as a model problem.
- The contract pays for itself in tokens, not just correctness: the full-contract run was
  cheaper AND shorter than the minimal-contract run that produced a broken result
  (5 turns / 0.21 USD vs 8 turns / 0.24 USD). A repair via the exit-2 loop costs ~0.06
  USD and two extra turns over an unrejected run.
- The exit-2 repair loop works: a PostToolUse hook exiting 2 with a TRUE, SPECIFIC
  complaint got a rejected write repaired within the same run (`[1] REJECT [2] PASS`).
- Validator messages must be accurate: a hook that made a FALSE claim about the file was
  verified by the agent, refused, and flagged as a possibly-broken hook or prompt
  injection. Correct behavior on the agent's part - and it means a sloppy validator
  message doesn't just fail to repair, it burns trust and turns. Two mechanics follow:
  the hook must RE-READ the file from disk itself (the tool payload's view of what was
  written can be stale, and a stale complaint is a false one), and every rejection must
  name the specific offending ids or fields, not a general complaint.
- A validator bug is NOT fail-closed. A wrong or unconditional rejection burns turns at
  ~0.03 USD each without converging, and the run still ends `result/success` - the runner
  cannot infer correctness from exit status. Cap rejections per run.
- Tier validator rules by what a rejection's turn cost buys: reject only what reaches the
  user wrong (invented ids, dangling references, wrong geometry); demote style-hygiene
  rules (defaults written out) to warnings - rejecting there spends a turn for no
  user-visible gain.
- Expect the agent to spend turns verifying its own work; give it a sanctioned channel
  (the validator) rather than only denials.

## 12. Plugins as configuration carriers (measured 2026-08-31)

- Settings enablement is NOT installation. `enabledPlugins: {"x@m": true}` with `x` never
  installed loads nothing, silently: the session reported "LSP server unavailable" while
  `claude plugin list` simply did not show the plugin. `claude plugin install x@m` is a
  separate, required step, and `plugin list` is the ground truth - not the settings file.
- The failure compounds when swapping a built-in for a replacement: enabling the (uninstalled)
  replacement and disabling the official one in a single settings edit leaves ZERO providers.
  Install first, then flip settings.
- `enabledPlugins` precedence is user < project < local, so a project-level `false` overrides
  a user-level `true` - the sanctioned way to swap one plugin for another per repo.
- `extraKnownMarketplaces: {"source": "directory", "path": ...}` registers a local directory
  as a marketplace. Registration is availability only - installation above still applies.
- Some configuration ONLY a plugin can carry: LSP `initializationOptions` are read from a
  plugin manifest and nowhere else (not user or project settings). Measured use: starting
  rust-analyzer with `cargo features=all` after both project- and user-level
  `rust-analyzer.toml` were measured dead - see the claude-code-rust-lsp-setup skill.
- Plugin/config changes load at session start, so the session that edits them can never see
  them. Verify by spawning a fresh headless child in the target repo - `claude -p "<run the
  probing tool and report raw results>"` - which loads config exactly as the next interactive
  session will. This measured both the silent failure above and the fix (0 results before
  install; 137 references across 8 files after).

## 13. Method

- Probe the wire, not the docs: every consequential finding here (hook event shape,
  `--allowedTools` non-sandbox, fail-open hooks, `--setting-sources` semantics, auth exit
  codes) came from running the CLI and reading the NDJSON, and several contradict the
  obvious reading of the flag names.
- Verify assertions can fail: corrupt the settings file and watch the canary assertion
  trip; point a hook at a missing binary and watch presence-only checks pass wrongly.
- Record probe results with dates and CLI versions; the binary self-updates and the wire
  shape is not a contract.
