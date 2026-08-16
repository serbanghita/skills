---
name: tauri-macos
description: Tauri 2 on macOS - hard-won invariants for threading (sync commands run on the main thread; blocking dialogs deadlock), atomic file writes with macOS metadata (copyfile traps, F_FULLFSYNC, birth time), bundle identity, Finder-launch environment, window/app lifecycle, menus, IPC payloads, capabilities, and Developer ID distribution. Load when building or debugging a Tauri desktop app on macOS, especially anything touching dialogs, file persistence, spawning child processes, or app packaging.
---

# Tauri on macOS

Distilled from building CeraPad (`~/work/whiteboard-app`): a Tauri 2 shell with a document
layer, atomic file IO, crash recovery, and a spawned-CLI agent. Every rule here was either
measured on a real machine or extracted from a production incident; the rationale is kept
inline because the rules look like superstition without it.

---

## 1. Threading: the one that causes beach balls

### 1.1 Synchronous Tauri commands run ON THE MAIN THREAD
A `#[tauri::command] pub fn ...` (sync) executes inline in the WebView's protocol handler,
which on macOS is the main thread. This is the single most consequential fact in this file.
Verified by sampling a hung process: main thread inside
`command → blocking_save_file → mpsc::recv → thread::park`.

- Any command that opens a `blocking_*` dialog MUST be `async fn`. The blocking dialog APIs
  show the panel and park the calling thread on a channel until the panel's completion
  callback answers; the callback is delivered by the main run loop. Sync command = the parked
  thread IS the run loop = panel visible, buttons dead, beach ball, unrecoverable without
  kill -9. `async` moves the command to the async runtime's pool, where parking is fine.
- The same applies to any command doing slow blocking work: `F_FULLFSYNC` (a real disk round
  trip), long reads, child-process waits. Make them `async` or the UI stutters/freezes.
- This failure is INVISIBLE in review. The panel still appears (it is shown before the park),
  so the code looks correct and even demos correctly if the answer path is never needed.

### 1.2 The event-shape rule for dialogs
Menu clicks (`on_menu_event`) and `WindowEvent::CloseRequested` are delivered on the main
thread. Never open a dialog from those handlers. Bend every path into:

```text
main thread   emit an event to the frontend, and nothing else
frontend      decide (dirty? save first?) then invoke a command
command       (async) open the dialog, touch the disk
```

### 1.3 Diagnosing a hang
`sample <pid> 3 -file out.txt` on the beach-balled process, then read the
`com.apple.main-thread` stack. It names the exact Rust frames. Do this BEFORE theorizing;
one sample settles what an hour of reasoning about Tauri internals will not.

### 1.4 Main-thread-only APIs
Menus must be built on the main thread - build them in `setup()`. AppKit windows/panels are
main-thread; Tauri's window methods dispatch there for you, but anything reached via `objc2`
directly is your responsibility.

---

## 2. Atomic file writes and macOS metadata

`std::fs::write` truncates then writes: a crash between the two destroys the last good copy.
Every write to a user-owned file goes through temp-sibling + `rename`. But a naive
temp+rename silently destroys six things `fs::write` preserved. Reference implementation:
`~/work/whiteboard-app/src-tauri/src/fsio.rs` (write_atomic, 15 pinned tests).

### 2.1 The six destroyed properties
1. Extended attributes (Finder tags) - rename replaces the inode. Restore with
   `copyfile(from, to, NULL, COPYFILE_ACL | COPYFILE_XATTR)`.
2. Permissions - the temp is created 0666 masked by umask (0644 typically), so replacing a
   0600 file widens it. Copy the mode explicitly with `fs::set_permissions`.
3. Modification time - ONLY if you use `COPYFILE_METADATA`. NEVER use that constant: it
   includes `COPYFILE_STAT`, which carries timestamps and ownership, so every save freezes
   mtime at its original value - Finder's Date Modified stops updating and every mtime-based
   backup tool stops seeing edits. It also copies uid/gid, which fails on files you can
   write but do not own.
4. The symlink itself - `fs::write` writes through a link; `rename` replaces it. Resolve
   with `canonicalize` first (falling back to the literal path for the first-save case) so
   the temp is a sibling of the real file and the rename replaces the real file.
5. Creation date (`st_birthtime`) - resets to the moment of save. Restore with
   `setattrlist` + `ATTR_CMN_CRTIME`, which sets birth time ALONE. No copyfile flag carries
   birth time without dragging mtime and ownership back in.
6. Hard links - NOT restorable, ever. A hard link has no canonical name to resolve; atomic
   replacement is a new inode by construction, so a second name keeps the old content.
   Document it; do not try to fix it.

### 2.2 Ordering inside the write
- Copy the MODE before writing the bytes (an empty 0644 temp leaks nothing; a written one
  leaks everything; chmod does not affect an already-open descriptor).
- Flush AFTER the metadata copy (or the fsync you paid for excludes the xattrs/mode).
- The rename is the commit point: NOTHING after it may fail the write. A post-rename error
  (e.g. directory flush) reported as failure tells the user their save did not happen while
  the file on disk holds it - and leaves dirty flags set. Post-rename steps are best-effort.

### 2.3 Durability is a parameter, not a constant
- macOS `fsync` does NOT reach the platters: `man 2 fsync` says the drive "may not
  physically write the data ... for quite some time". Only `fcntl(fd, F_FULLFSYNC)` is
  honest, and it costs a real disk round trip.
- Two levels: ProcessDeath (no fsync - the page cache outlives the process; right for
  autosave-every-2s and regenerable data) and PowerLoss (F_FULLFSYNC + directory flush;
  right for explicit Cmd+S). Adding the "missing" fsync to the cheap path is a
  pessimisation, not a fix.
- `F_FULLFSYNC` IS accepted on a read-only directory descriptor on APFS (measured), so the
  directory flush can be honest too.
- All of this is Apple-only: put `libc` under
  `[target.'cfg(target_os = "macos")'.dependencies]`. Compile the module everywhere with
  weaker guarantees; Windows has no stdlib route to a directory fsync at all.
- Rust's std discards `close(2)`'s return value: "never partial" holds only if the write
  reported success; a filesystem deferring write-back errors to close (NFS) can still
  publish a short file on the no-fsync path. Say so in the guarantee.

### 2.4 Temp naming and concurrency
- Temp name: hidden, recognisable, per-CALL: `.{file}.cerapad-{pid}-{seq}.tmp`. The
  sequence number matters: a name constant per process lets two concurrent writes share one
  temp - the first rename publishes a splice, the second fails ENOENT. The pid keeps two
  app instances apart.
- Sweep stale temps (they survive SIGKILL - no cleanup runs under one) with an age bound,
  at most once per directory per process run.
- Atomic writes make concurrent saves SAFE, not CORRECT: two writers still race to be last.
  Ordering is a separate mechanism (a frontend promise chain); do not let "atomic" imply it.
- macOS fact: rewriting a file in place does NOT advance the parent directory's mtime
  (measured). Never key "last used" off directory mtime.

---

## 3. App identity

- The bundle identifier keys BOTH the WebView data store (`~/Library/WebKit/<identifier>`)
  and `app_data_dir` (`~/Library/Application Support/<identifier>`). Renaming it silently
  resets localStorage, settings, and every file you persisted. Decide the rename cost
  BEFORE users have data; check the old identifier's directories before touching it.
- `productName` names the bundle (`CeraPad.app`); `mainBinaryName` names the executable
  inside it - without it Activity Monitor shows the lowercase Cargo package name.
- Name the Cargo lib crate with a `_lib` suffix (e.g. `cerapad_lib`): Windows collides
  bin/lib names otherwise, and fixing it later churns every `use`.

---

## 4. The Finder-launch environment

A bundle launched from Finder (or `open -n`, which goes through LaunchServices) does NOT
inherit the login shell environment. `launchctl getenv PATH` is typically empty, so the GUI
default PATH applies: no `~/.local/bin`, no Homebrew, no nvm.

- Spawning a user-installed CLI needs explicit discovery: env-var override first, then a
  candidate list (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`), then
  `$SHELL -lc 'command -v <bin>'` with a timeout (login rc files can hang).
- Store the SYMLINK path, never the resolved versioned target - updaters repoint symlinks.
  Persist only user-supplied overrides; re-resolve auto-discovered paths every launch.
- Interpreters are not reachable either: an `.mjs` helper needs a `node` the bundle cannot
  find, and the failure is silent. The robust pattern: make the app its own helper -
  handle a `--hook <kind>` argv in `main` before Tauri starts, and generate configs
  pointing at `std::env::current_exe()`, which is absolute and exists by construction.
- Testing this REQUIRES `open -n` on a built bundle. `npm run tauri dev` inherits the
  terminal's PATH and cannot reproduce any of it.

---

## 5. Window and app lifecycle

- Closing the window and quitting are SEPARATE paths on macOS: `WindowEvent::CloseRequested`
  vs `RunEvent::ExitRequested` (Cmd+Q). Guard both or Cmd+Q bypasses your unsaved-changes
  check.
- The prevent/emit/force pattern: on the main-thread event, `api.prevent_close()` (or
  `prevent_exit()`) and emit to the frontend; after the frontend's guard clears, close via
  `window.destroy()` - NOT `close()`, which re-raises `CloseRequested` and loops the guard
  forever. Quit via `app.exit(0)`.
- `RunEvent::Opened` (Finder double-click, "Open With") is only reachable from the
  `app.run(callback)` form, not `run(context)`. It can arrive BEFORE the WebView exists:
  queue the paths in state, emit a notification, and have the frontend drain the queue both
  on startup and on the notification - whichever runs first wins, the other finds it empty.
- Tauri 2.x has no `set_document_edited`; reaching `NSWindow.documentEdited` needs `objc2`
  and a raw window handle. A "• " title prefix is the honest cheap version.
- Window title = document name, not app name (the app name is already the first menu-bar
  item).
- `window.addEventListener("blur")` is the reliable "user is leaving" hook in WKWebView
  (Cmd+Tab, Cmd+H, minimise, space switch). Do not rely on `visibilitychange` for those
  gestures without verifying it fires; Tauri's `onFocusChanged` is the supported substitute.

---

## 6. Menus and shortcuts

- Cmd+S / Cmd+O etc. must be MENU ACCELERATORS, not `keydown` listeners - a listener loses
  them whenever focus is in native chrome (panels, sheets).
- If the app has its own undo stack (canvas history), ship CUSTOM Edit>Undo/Redo items:
  the predefined ones route Cmd+Z to NSUndoManager, which knows nothing about your canvas.
- Rebuild the menu on the main thread; snapshot state (clone) before hopping threads rather
  than carrying a lock across the hop.

---

## 7. IPC and the WebView

- `Vec<u8>` serialises over Tauri IPC as a JSON array of numbers: roughly 4 bytes of wire
  per byte of payload. Send binary as base64 strings. On the JS side, build base64 with
  `FileReader.readAsDataURL`, never `btoa(String.fromCharCode(...bytes))` - the spread
  overflows the argument limit on anything big enough to matter.
- Capabilities gate PLUGIN commands invoked from the frontend, in two steps: the plugin
  registered in the builder AND an entry in `capabilities/default.json`. A missing entry is
  a RUNTIME "not allowed" error, not a compile error. But:
  - App-defined `invoke_handler` commands are NOT capability gated at all. Your own command
    surface is open to any script in the WebView; validate accordingly.
  - A plugin used only from Rust (e.g. dialogs opened by commands) needs NO capability
    entry - capabilities gate the frontend's IPC, not Rust calls.
- With `withGlobalTauri: true` + `csp: null`, ANY script in the WebView can invoke your
  commands. The trust boundary is argument validation in Rust: parse ids as UUIDs (making
  path traversal structurally impossible), canonicalize + prefix-check any path you build.
- Tightening the CSP breaks libraries that style via inline `style="..."` attributes unless
  `'unsafe-inline'` is kept for styles. Check before "hardening".
- IPC argument names are a contract: Tauri matches JS camelCase to Rust snake_case by name;
  renaming one side alone is a runtime "invalid args" error no compiler catches.

---

## 8. Child processes

- Make the child a process-group leader (`CommandExt::process_group(0)`, Unix-only) so
  cancellation can kill the whole group, not just the direct child.
- Track children in a registry keyed by your session/conversation id; reject overlapping
  runs for the same key with a distinct busy error (a double-click on Send is enough to
  race).
- A cancel can land while the spawn is being prepared: after spawning, check the cancelled
  flag again - the claim was held before the pid existed.
- Set `stdin(Stdio::null())` explicitly for CLIs that wait on stdin.

---

## 9. Distribution (Developer ID)

- A locally built bundle has no quarantine attribute, so it launches unsigned ON THE BUILD
  MACHINE ONLY. Everywhere else Gatekeeper refuses unsigned/un-notarized apps outright.
  Local success proves nothing about other Macs.
- `tauri build` reports success for a signed-but-unnotarized bundle. The checks that answer
  "does this open on a machine that has never seen it" are `stapler validate` and
  `spctl --assess` - run them post-build, always.
- Preflight your signing env vars: half-set credentials fail LATE and vaguely (an
  `APPLE_ID` with no `APPLE_TEAM_ID` silently notarizes nothing). Prefer the App Store
  Connect API key trio over the Apple ID trio - no password rotation, no 2FA mid-build.
- Hardened runtime is on by default and notarization requires it. WKWebView's JS runs in
  the separate system WebContent process, so the app itself does not JIT - no entitlements
  file needed. If a signed build renders a blank WebView where unsigned did not,
  `com.apple.security.cs.allow-jit` is the first thing to try.
- Hardened runtime does NOT restrict spawning child processes. The App Sandbox DOES: a
  sandboxed child inherits the container, so an app that spawns the user's own tools
  (their CLI, their keychain credentials, their files) cannot ship on the Mac App Store.
  Developer ID is the only channel for that architecture; decide once, write it down.
- `bundle.targets`: prefer an explicit list (e.g. `["app", "dmg"]`) over `"all"` - `"all"`
  adds the updater target, which demands updater config and a signing key you may not have.
  Pass `--bundles app` for local iteration; the `.dmg` is distribution-only.

---

## 10. Dev workflow

- If `devUrl` hardcodes a port, set Vite `strictPort: true` - a stale dev server on that
  port otherwise makes `tauri dev` half-connect instead of failing loudly.
- Launch fresh instances with `open -n` on the built `.app` so you never demo a stale one.
- `npm run tauri dev` and the packaged bundle are DIFFERENT environments (PATH, quarantine,
  LaunchServices). Anything involving discovery, spawning, signing, or file associations
  must be verified from the bundle; dev-mode success is not evidence.
- Blocking dialogs cannot be exercised by any automated test; the threading rule in section
  1 is enforced by review and by a module-doc invariant, so state it where the next dialog
  command will be written, not in a distant doc.
