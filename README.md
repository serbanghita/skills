# skills

Reusable [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills).
Each top-level folder is one skill (`<skill-name>/SKILL.md`).

## Usage

Claude Code discovers skills one folder at a time: `~/.claude/skills/<skill-name>/SKILL.md`
makes a skill available in every project, `<project>/.claude/skills/<skill-name>/SKILL.md`
in just that one.

Link the skills you want individually. Do not point `~/.claude/skills` itself at this
repo - that replaces the whole directory and hides every other skill already in it.

macOS / Linux:

```sh
ln -s "$PWD/tauri-macos" ~/.claude/skills/tauri-macos
```

Windows PowerShell (needs Developer Mode or an elevated shell):

```powershell
New-Item -ItemType SymbolicLink -Path "$HOME\.claude\skills\tauri-macos" -Target "$PWD\tauri-macos"
```

Windows without either - a directory junction behaves identically for a local path and
needs no privileges:

```cmd
mklink /J "%USERPROFILE%\.claude\skills\tauri-macos" "%CD%\tauri-macos"
```

Repeat per skill, or link them all at once from a clone of this repo:

```sh
for d in */; do
  [ -f "$d/SKILL.md" ] && ln -sfn "$PWD/${d%/}" ~/.claude/skills/"${d%/}"
done
```

```powershell
Get-ChildItem -Directory | Where-Object { Test-Path "$($_.FullName)\SKILL.md" } | ForEach-Object {
  New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\skills\$($_.Name)" -Target $_.FullName
}
```

Symlinks keep the skills current with `git pull`. Copying the folders works too, but then
every update has to be re-copied.

## Skills

| Skill | Description |
|---|---|
| [multiplayer-concurrent-control](multiplayer-concurrent-control/SKILL.md) | Real-time multiplayer concurrency architecture: always-on invariants (version-aware undo, locking leases, socket preemption, optimistic UI, core/network isolation) plus scale-graduation topics with explicit triggers. |
| [claude-code-orchestration](claude-code-orchestration/SKILL.md) | Driving the Claude Code CLI headless from a host app: auth without API keys, the canonical argv, stream-json taxonomy, hooks as the only sandbox (fail-open, canary), workspace confinement, injection containment, sessions and continuity loss, measured cost. |
| [tauri-macos](tauri-macos/SKILL.md) | Tauri 2 on macOS: threading (sync commands run on the main thread; blocking dialogs deadlock), atomic file writes with macOS metadata, bundle identity, Finder-launch environment, lifecycle, menus, IPC, capabilities, Developer ID distribution. |
| [apple-store-release](apple-store-release/SKILL.md) | Shipping a Mac app through Apple: Mac App Store vs Developer ID, certificates and the missing G2 intermediate, notarization and stapling (including the .dmg the bundler skips), Gatekeeper verification, the sandbox retrofit, naming/identifier permanence, listing and anti-steering rules, update cost. |
| [microsoft-store-release](microsoft-store-release/SKILL.md) | Shipping a desktop app to the Microsoft Store as MSIX: Partner Center registration and verification waits, the permanent publisher segment, assigned identity values, makeappx packaging with no MSIX target, runFullTrust and packaged-container effects, WACK and certification, update cost. |
| [claude-code-statusline](claude-code-statusline/SKILL.md) | Writing a correct Claude Code status line: which numbers the stdin payload already provides (cost, context percentage) vs. the one it doesn't, the per-content-block duplication that makes naive transcript summing over-count 2x, why `jq` is the wrong dependency and git-bash is the real shell on Windows, and the silent degradation that makes a broken status line look finished. Ships a working node implementation. |

## Reference documents

Not skills - standalone Markdown, used directly rather than loaded by the skills system.

| Document | Description |
|---|---|
| [common.md](common.md) | Community-collected keywords and prompt patterns that measurably improve results with LLM coding assistants. |
| [working-agreement.md](working-agreement.md) | Standing rules distilled from `common.md`. Copy to `~/.claude/`, then import from a project's `CLAUDE.md` with `@~/.claude/working-agreement.md`. |
