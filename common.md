# Community-driven keywords & phrases for LLM coding assistants

Special keywords and prompt patterns collected from community practice that measurably improve
results when coding, testing, and reviewing code with LLMs like Claude Code.

**Type legend:**
- 🔑 **Harness trigger** — a literal string the tooling recognizes (or historically recognized).
- 💬 **Instruction pattern** — not a magic token; it works because it's an unambiguous instruction.

## Keyword reference table

| Keyword / Phrase | Type | Category | What it does | Why it works |
|---|---|---|---|---|
| `think` / `think hard` / `think harder` / `ultrathink` | 🔑 Harness trigger | Reasoning budget | In earlier Claude Code versions, literal string triggers that allocated escalating extended-thinking budgets. Newer versions manage thinking automatically, but the lore persists. | The most famous "secret keyword" in community lore — it actually was a token-level trigger. |
| `ultracode` | 🔑 Harness trigger | Orchestration | Opts into multi-agent workflow orchestration (in setups that support it). | Explicit opt-in keyword the harness checks for. |
| "Perform an adversarial review — actively try to refute each finding" | 💬 Instruction | Verification | Flips review from listing issues to disproving them. | False-positive rate drops noticeably; the model must argue against its own findings. |
| "Prove it" / "Show me the failing test first" | 💬 Instruction | Verification | Forces evidence over assertion. | Counters the default failure mode: plausible-but-unverified claims. |
| "Don't tell me it's fixed until you've run the tests and shown me the output" | 💬 Instruction | Verification | Requires demonstrated test runs before claiming success. | Blocks premature "it's fixed" declarations. |
| "Assume your previous answer is wrong. Find the flaw." | 💬 Instruction | Verification | Fresh-eyes re-check without ending the session. | Breaks anchoring on the previous answer. |
| "Grade your confidence per claim and only report CONFIRMED items" | 💬 Instruction | Verification | Filters output down to high-confidence findings. | Forces self-assessment instead of uniform confidence. |
| "Make a plan first. Do not write any code yet." | 💬 Instruction | Planning | Separates design from implementation. Plan Mode (Shift+Tab) enforces the same thing at the harness level. | Prevents the model from coding before the approach is agreed. |
| Plan → critique → execute | 💬 Instruction | Planning | Write a plan, critique it (adversarially, or from a fresh session/subagent), then execute the revised version. `.planning/` folders institutionalize this. | The critique step catches wrong-direction work before any code exists. |
| "Ask me clarifying questions before starting" | 💬 Instruction | Planning | Surfaces ambiguity up front. | Cheap, and dramatically reduces wrong-direction work. |
| Writer/reviewer split | 💬 Instruction | Multi-instance | One session (or subagent) writes code; a separate one with no shared context reviews it. | Independence is the point — the reviewer isn't anchored on the writer's rationalizations. |
| Judge panels | 💬 Instruction | Multi-instance | Generate N independent solutions, then have a judge compare and synthesize. | Works well for design decisions with a wide solution space. |
| Subagent fan-out for research | 💬 Instruction | Multi-instance | "Spawn agents to each investigate one subsystem, then synthesize." | Keeps the main context clean of file dumps. |
| "Write the tests first, confirm they fail, then implement until they pass. **Don't modify the tests.**" | 💬 Instruction | TDD / loops | Classic TDD loop with an anti-reward-hacking clause. | The "don't modify the tests" clause at the end is the load-bearing part. |
| Loop-until-dry: "keep looking for bugs until two consecutive passes find nothing new" | 💬 Instruction | TDD / loops | Termination condition based on convergence, not a fixed count. | Beats "find the bugs" for coverage. |
| `CLAUDE.md` as institutional memory | 💬 Convention | Context hygiene | Encode invariants, gotchas, and "never do X" rules there. Corrections you make once should graduate into it. | The single most effective community practice — persists knowledge across sessions. |
| "Re-read CLAUDE.md / the relevant doc before touching this area" | 💬 Instruction | Context hygiene | Refreshes key context in long sessions. | Early context may have been compacted away. |
| `/clear` between unrelated tasks | 🔑 Harness trigger | Context hygiene | Resets the conversation context. | Prevents context bleed between unrelated tasks. |
| "No yapping" / "Only output code" | 💬 Instruction | Output Formatting | Suppresses conversational filler and explanatory text. | Saves tokens and reading time when the user just needs the implementation. |
| "Explain like a senior engineer" | 💬 Instruction | Persona / Tone | Elevates the technical depth and skips basic definitions. | Shifts the model's output towards more advanced, concise technical discussion. |
| "List all affected files before proceeding" | 💬 Instruction | Planning / Impact | Forces an upfront assessment of dependencies. | Prevents diving into one file while silently breaking imports in another. |
| "Check for edge cases specific to X" | 💬 Instruction | Verification | Directs attention to a specific class of bugs (e.g., concurrency, null values). | Models perform better when specifically prompted to look for known problem domains rather than generic "find bugs". |
| "Do not truncate code in your response" | 💬 Instruction | Output Formatting | Prevents the model from using `// ... rest of code ...` comments. | Essential when copy-pasting code or when automated tools expect complete file contents. |
| "Be brief" / "Concise responses only" | 💬 Instruction | Output Formatting | Forces the model to get straight to the point without excessive exposition. | Reduces cognitive load and saves reading time when background explanation isn't needed. |
| "No em dashes" / "Use plain dashes only (-)" | 💬 Instruction | Output Formatting | Prevents the model from using typographical em dashes (—). | Prevents formatting issues in environments or terminals that do not handle special unicode characters well. |
| "No emojis" / "Do not use icons" | 💬 Instruction | Output Formatting | Completely strips emojis and decorative icons from the response. | Essential for writing professional documentation, commit messages, or code comments where emojis are inappropriate. |
| "When writing commit messages, NEVER auto-add agent name as co-author" | 💬 Instruction | Git / Version Control | Prevents the LLM from appending a `Co-authored-by` trailer with its own name. | Keeps git history clean and prevents unwanted metadata in commits. |
