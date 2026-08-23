# Review @common.md to add special keywords or phrases and review the existing ones

Improve `common.md` — the community-driven reference of keywords and prompt patterns for LLM coding assistants. The work has three parts: audit the existing entries for accuracy, expand the collection with new community-sourced keywords/phrases, and add tool-specific sections for the assistants I actively use.

## Chapter 1 — Review existing entries

- Verify each of the current ~27 entries for accuracy as of mid-2026:
  - Is the "Type" classification correct (🔑 Harness trigger vs 💬 Instruction pattern)?
  - Is the "What it does" description still true in current tool versions (e.g. `think`/`ultrathink` behavior changed across Claude Code versions)?
  - Are any entries obsolete, duplicated, or misleading? Flag or annotate rather than silently delete.
- Tighten wording where the "Why it works" column is vague or unsubstantiated.
- Keep the table format and type legend consistent.

## Chapter 2 — Add new general keywords & phrases

- Research and add community-practiced keywords/phrases missing from the table, sourced from community practice (blog posts, Reddit/HN threads, official docs, awesome-lists).
- Candidate categories to expand: verification, planning, context hygiene, output formatting, multi-instance workflows, TDD/loops, git/version control.
- Each new entry must follow the existing table schema: Keyword/Phrase, Type, Category, What it does, Why it works.
- Prefer entries with a clear mechanism ("why it works") over folklore with no observable effect.

## Chapter 3 — LLM/tool-specific instruction sections

Add dedicated sections (one per tool) covering keywords, slash commands, config files, and prompt patterns specific to each assistant. I'm interested in these three:

### 3.1 Claude Code (Anthropic)

- Harness triggers and conventions: `CLAUDE.md`, `/clear`, `/compact`, Plan Mode, `ultracode`, thinking keywords history, hooks, subagents, skills/slash commands, `.claude/settings.json` permissions.
- Which magic keywords are real harness triggers today vs deprecated lore.

### 3.2 Google Antigravity / Gemini (AGY)

- Gemini-specific instruction files and conventions (e.g. `GEMINI.md`, `AGENTS.md` support), Antigravity agent workflows, artifacts/walkthroughs, and any literal trigger keywords the harness recognizes.
- Prompt patterns that work notably better or worse with Gemini models compared to Claude.

### 3.3 GitHub Copilot

- Copilot-specific configuration: `.github/copilot-instructions.md`, path-scoped `*.instructions.md`, prompt files, Copilot Chat slash commands (`/fix`, `/tests`, `/explain`), agent mode conventions, `AGENTS.md` support.
- Which instruction patterns Copilot actually honors vs ignores.

### Cross-tool notes

- Note where a convention is portable across all three tools (e.g. `AGENTS.md`) vs tool-specific.
- Keep the same table schema per tool section so entries stay comparable.

## Constraints

- Single file: everything stays in `common.md`.
- Every entry must be classified with the existing type legend (🔑 vs 💬); add a new type only if genuinely needed (e.g. ⚙️ config-file convention).
- No fabricated keywords — if a "magic token" can't be traced to docs or credible community reports, leave it out or mark it as unverified lore.
