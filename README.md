# skills

Reusable [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills).
Each top-level folder is one skill (`<skill-name>/SKILL.md`).

## Usage

Copy (or symlink) a skill folder into a project's `.claude/skills/` directory,
or into `~/.claude/skills/` to make it available in every project.

## Skills

| Skill | Description |
|---|---|
| [multiplayer-concurrent-control](multiplayer-concurrent-control/SKILL.md) | Real-time multiplayer concurrency architecture: always-on invariants (version-aware undo, locking leases, socket preemption, optimistic UI, core/network isolation) plus scale-graduation topics with explicit triggers. |
| [claude-code-orchestration](claude-code-orchestration/SKILL.md) | Driving the Claude Code CLI headless from a host app: auth without API keys, the canonical argv, stream-json taxonomy, hooks as the only sandbox (fail-open, canary), workspace confinement, injection containment, sessions and continuity loss, measured cost. |
| [tauri-macos](tauri-macos/SKILL.md) | Tauri 2 on macOS: threading (sync commands run on the main thread; blocking dialogs deadlock), atomic file writes with macOS metadata, bundle identity, Finder-launch environment, lifecycle, menus, IPC, capabilities, Developer ID distribution. |

## Reference documents

Not skills - standalone Markdown, used directly rather than loaded by the skills system.

| Document | Description |
|---|---|
| [common.md](common.md) | Community-collected keywords and prompt patterns that measurably improve results with LLM coding assistants. |
| [working-agreement.md](working-agreement.md) | Standing rules distilled from `common.md`. Copy to `~/.claude/`, then import from a project's `CLAUDE.md` with `@~/.claude/working-agreement.md`. |
