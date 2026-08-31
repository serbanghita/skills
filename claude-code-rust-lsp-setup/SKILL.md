---
name: claude-code-rust-lsp-setup
description: Making Claude Code's rust-analyzer LSP see feature-gated Rust code - why cfg-inactive modules silently vanish from hover/references, why rust-analyzer.toml [cargo] features is a dead path, and a setup procedure that installs a local plugin passing the features via initializationOptions. Load when LSP results in a Rust repo look incomplete (references missing from feature-gated files), when setting up Claude Code code intelligence for a crate whose default feature set is narrower than its source tree, or when an LSP query returns empty right after a session starts.
---

# Claude Code + rust-analyzer on feature-gated crates

Distilled from CeraPad (`~/work/whiteboard-app`, `src-tauri` with `default = []` and an
`agent` feature gating six modules). Everything here was measured on rust-analyzer
`bb3bbbd9e4 2026-08-16` driven over raw JSON-RPC, with `RA_LOG` transcripts and
`rust-analyzer/analyzerStatus` dumps; upstream references are quoted from source, not docs.

---

## 1. The failure modes (know these before trusting any LSP answer)

### 1.1 Feature-gated code is invisible, and the failure is silent
rust-analyzer evaluates `#[cfg]` while building the module tree (the def map). A module
behind an inactive feature is not analyzed weaker — it is **not collected at all**: no item
in it exists to the semantic layer, so hover, go-to-definition and find-references inside it
return nothing, and a find-references on a shared symbol **silently omits every gated file**.
The result is well-formed and smaller, never red. In CeraPad, `Provider` showed 53
references in 2 files while grep found ~87 more across six `#[cfg(feature = "agent")]`
modules — `analyzerStatus` for those files says "Does not belong to any crate".
`#[cfg(test)]` is NOT affected (the `test` cfg is enabled by default).

- NEVER treat an LSP reference list in a feature-gated crate as complete unless you know
  the server was started with those features enabled.
- The check: `rust-analyzer/analyzerStatus` with the file's URI — the crate's
  `Enabled cfgs` must list `feature=<name>`.

### 1.2 `rust-analyzer.toml` `[cargo] features` is a dead path — do not reach for it
A project-root (or user-level) `rust-analyzer.toml` with `[cargo] features = [...]` is
parsed, stored, logged (`updating ra-toml workspace config`), and even triggers a workspace
re-fetch — which then **ignores it**: `reload.rs::fetch_workspaces` reads
`self.config.cargo(None)`, and with no source root the ratoml `workspace` layer (keyed by
`SourceRootId`) is never consulted. Upstream: rust-lang/rust-analyzer#18114 (open). The
user-level file fared no better in measurement (`user_config: None`). Symptoms of this trap:
config visibly loaded in logs, features still absent from `Enabled cfgs`.

### 1.3 The only working carrier is client `initializationOptions`, and that means a plugin
`initializationOptions: {"cargo": {"features": "all"}}` at `initialize` time works (measured:
hover in a gated module resolves ~10 s after spawn). In Claude Code, LSP servers are
**plugin-only**: `lspServers` supports `initializationOptions`, but only in a plugin's
manifest — not in user or project `settings.json`. The official `rust-analyzer-lsp` plugin
passes none and has no config surface. Hence the setup below: a local plugin that does.
Prefer `"features": "all"` — it is project-agnostic (the standard VS Code
`rust-analyzer.cargo.features: "all"` idiom) and analysis-only; build commands are unaffected.

### 1.4 The cold-start race: an empty first answer is not an answer
rust-analyzer's `initialize` returns before it has a project. `cargo metadata`, the crate
graph and the proc-macro server load asynchronously (~3 s on a mid-size crate; cache priming
a few seconds more). A request in that window is answered **immediately and empty** — a
well-formed "no results", not an error (measured: hover answered in 2 ms with null at t=0,
correctly at t=11 s). Claude Code's LSP tool does not wait this out.

- NEVER conclude "no references" from the first LSP query after a session or server start.
  Re-issue the query; trust it only when a control query on a known symbol succeeds.

---

## 2. Setup: install the local plugin (idempotent — safe to re-run on any machine)

**Step 0 — preconditions.** `rust-analyzer` must be on PATH. The target repo must be a Rust
project whose `[features]` make this worth doing (a `default` set narrower than the tree).
If not, stop and say so. If `~/.claude/local-plugins` already exists, diff before touching —
it is user-owned once created; NEVER overwrite silently.

**Step 1 — materialize the marketplace.** Create `~/.claude/local-plugins/` containing
`.claude-plugin/marketplace.json` (plus an empty `plugins/rust-analyzer-all-features/`
source dir with a one-line README):

```json
{
  "name": "local-plugins",
  "description": "Locally generated Claude Code plugins (created by the claude-code-rust-lsp-setup skill).",
  "owner": { "name": "<user>" },
  "plugins": [
    {
      "name": "rust-analyzer-all-features",
      "description": "rust-analyzer started with cargo features=all so feature-gated code is analyzed",
      "source": "./plugins/rust-analyzer-all-features",
      "lspServers": {
        "rust-analyzer": {
          "command": "rust-analyzer",
          "extensionToLanguage": { ".rs": "rust" },
          "initializationOptions": { "cargo": { "features": "all" } }
        }
      }
    }
  ]
}
```

**Step 2 — register the marketplace once**, in user settings (`~/.claude/settings.json`),
skipping if already present:

```json
"extraKnownMarketplaces": {
  "local-plugins": { "source": { "source": "directory", "path": "<home>/.claude/local-plugins" } }
}
```

**Step 3 — enable per project**, in the repo's `.claude/settings.json` `enabledPlugins`:

```json
"rust-analyzer-all-features@local-plugins": true,
"rust-analyzer-lsp@claude-plugins-official": false
```

The disable line is load-bearing: two enabled servers claiming `.rs` is undefined behavior.
Disable the official plugin wherever the local one is enabled (project level if the user
enables it per project, user level if globally).

**Step 4 — verify, in a fresh session** (a running LSP server never re-reads config, and the
harness forwards no file-change notifications). Run find-references on a symbol defined in
always-active code but used in gated code, and compare the file list against
`grep -rl <symbol>`; or check `Enabled cfgs` via `analyzerStatus`. Mind §1.4 while doing it.

---

## 3. Debugging when it still looks wrong

- `RA_LOG="rust_analyzer=debug"` and read stderr: `initial config`, `Processing
  rust-analyzer.toml`, `did fetch workspaces`, `switch_workspaces` tell you what config the
  fetch actually used.
- `rust-analyzer/analyzerStatus` (custom LSP request, takes a `textDocument`) is the ground
  truth: crate membership, `Enabled cfgs`, `Potential cfgs`, and the config layers as the
  server sees them.
- "Does not belong to any crate" for a file that plainly is in the tree = its module is
  cfg-inactive (§1.1) — a features problem, not an indexing one.
- A gated `github`-style feature pulling network deps: `features = "all"` compiles their
  metadata for analysis only; if that ever fails on a platform (e.g. `ring` without MSVC
  headers), generate the plugin with an explicit feature list instead of `"all"`.
