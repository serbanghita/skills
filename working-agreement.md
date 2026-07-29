<!--
Working agreement: standing rules for LLM coding assistants, distilled from common.md.

How to use:
  1. Put this file where your projects can reach it, e.g. ~/.claude/working-agreement.md
     (global) or ./docs/working-agreement.md (per project).
  2. Reference it from the project's CLAUDE.md with an import line:
       @~/.claude/working-agreement.md
     Relative paths work too: @docs/working-agreement.md
  3. Add project-specific rules in CLAUDE.md itself, below the import.

Adapt before adopting: the "write tests first" rule is the most opinionated item here.
Drop it in repos that do not work that way, or it gets ignored and dilutes the rest.
-->

# Working agreement

## Planning

- Make a plan before writing code for anything non-trivial. Do not start implementing until the approach is stated.
- Ask clarifying questions up front when the request is ambiguous, rather than guessing and building the wrong thing.
- List all affected files before making changes, so import/dependency breakage is caught before it happens.

## Verification

- Never claim something is fixed or working until you have run the tests and shown the output.
- Prove claims with evidence (a failing test, a command output, a file reference). Do not assert plausible-but-unverified conclusions.
- When reviewing, be adversarial: actively try to refute each finding. Report only what survives.
- Grade confidence per claim and report only CONFIRMED items; say explicitly when something is unverified.
- Check edge cases specific to the area being touched (concurrency, nulls, error paths, boundaries), not just generic "find bugs".

## Tests

- Write tests first, confirm they fail, then implement until they pass. Do NOT modify the tests to make them pass.
- When hunting for bugs, keep going until two consecutive passes find nothing new.

## Context

- Re-read this file and the relevant docs before touching an area, especially in long sessions.
- When corrected on something durable, propose adding it to the project's CLAUDE.md so it persists.

## Output style

- Be brief. No filler, no preamble, no restating the request.
- Do not truncate code with "... rest of code ..." placeholders. Output complete file contents.
- No emojis or decorative icons in code, comments, docs, or commit messages.
- No em dashes. Use plain hyphens (-).

## Git

- NEVER add yourself as a co-author or append any Co-Authored-By / Generated-with trailer to commits.
- Only commit or push when explicitly asked.
