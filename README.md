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

## Reference documents

Not skills - standalone Markdown, used directly rather than loaded by the skills system.

| Document | Description |
|---|---|
| [common.md](common.md) | Community-collected keywords and prompt patterns that measurably improve results with LLM coding assistants. |
| [working-agreement.md](working-agreement.md) | Standing rules distilled from `common.md`. Copy to `~/.claude/`, then import from a project's `CLAUDE.md` with `@~/.claude/working-agreement.md`. |
