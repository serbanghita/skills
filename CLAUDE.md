# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A collection of reusable Claude Code skills, published for copying (or symlinking) into a project's `.claude/skills/` directory or into `~/.claude/skills/`. It is Markdown-only: there are no build, test, or lint commands.

## Structure and conventions

- Each top-level folder is one skill and must contain a `SKILL.md` with YAML frontmatter (`name`, `description`). The `name` matches the folder name; the `description` doubles as the skill's load trigger, so it must state both what the skill covers and when to load it.
- When adding or renaming a skill, update the table in `README.md` — it lists every skill with a link to its `SKILL.md` and a one-line description.
- `common.md` is a standalone reference document (community keywords/phrases for LLM coding assistants), not a skill — it has no frontmatter and is not listed in the skills table.
- `working-agreement.md` is a standalone rules file distilled from `common.md`, meant to be copied to `~/.claude/` (or a project) and imported into a project's `CLAUDE.md` via `@path`. Also not a skill. Because it gets imported verbatim as instructions, keep its body free of meta-commentary — usage notes live in the leading HTML comment.
- `.planning/` holds plan documents managed by the `plan` plugin (`/plan:create`, `/plan:critique`); it is working material, not a skill.

## Writing style for skills

Skills in this repo are distilled, opinionated references (invariants, triggers, "never do X" rules) rather than tutorials — see `multiplayer-concurrent-control/SKILL.md` for the house style: numbered invariant sections with MUST/NEVER phrasing and the rationale kept inline.
