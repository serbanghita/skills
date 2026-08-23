---
name: apple-store-release
description: Shipping a macOS app through Apple - choosing between the Mac App Store and Developer ID, certificates and the missing G2 intermediate, notarization and stapling (including the .dmg Tauri never submits), Gatekeeper verification that actually proves anything, the App Sandbox retrofit the Store demands, naming and bundle-identifier permanence, listing requirements, anti-steering rules, and what every update costs. Load when preparing, signing, notarizing, submitting or updating a Mac app, when creating Apple certificates, or when deciding whether an app can be on the Mac App Store at all.
---

# Releasing a Mac app through Apple

Distilled from shipping CeraPad (`~/work/whiteboard-app`): a Tauri 2 desktop app, Developer ID
signed and notarized 2026-08-22, whose free SKU is a Mac App Store candidate and whose paid SKU
can never be one. Every rule was measured on a real release or extracted from a real rejection.
Build-level Tauri/macOS rules live in the `tauri-macos` skill; this file is the release channel.

Two facts frame everything below:

- **Apple's rules move and this file does not.** Guideline numbers, anti-steering rules and
  notarization behaviour all changed within the life of this project. Date-stamp every
  measurement you add, and re-verify guideline text before you build a business decision on it.
- **Nothing local proves anything.** The build machine is the one environment where a broken
  release works perfectly. Every check that matters answers "does this open on a machine that
  has never seen it".

---

## 1. Choose the channel before you write any packaging code

There are two Apple channels and they are not variants of one pipeline. They need different
certificates, different entitlements, different artifacts and different review costs.

| | Mac App Store | Developer ID (direct download) |
|---|---|---|
| Sandbox | REQUIRED | not required |
| Certificates | Apple Distribution + Mac Installer Distribution + provisioning profile | Developer ID Application |
| Artifact | `.pkg` | `.app` + `.dmg`, notarized and stapled |
| Review | every update | none |
| Payments | Apple's, with its cut and its anti-steering rules | yours |

### 1.1 The App Sandbox decides the channel, not preference

**A sandboxed child process inherits the parent's container.** So an app that spawns the user's
own tools - their CLI, their keychain credentials, their project files - cannot function under
the sandbox, and therefore cannot ship on the Mac App Store at any price. This is architecture,
not a limitation to work around.

Hardened runtime does NOT restrict spawning children; only the sandbox does. Do not conflate
them: a Developer ID app with hardened runtime spawns freely, which is why that channel exists
for this class of app.

Decide once, write the decision down where the next person will argue with it, and stop
re-litigating it.

### 1.2 If one feature blocks the Store, compile it out rather than arguing with the sandbox

The productive question is never "can the sandbox be widened". It is "can the un-sandboxable
feature be removed cleanly enough that the remainder is a candidate". A build feature flag,
**off by default**, gives you two SKUs from one tree.

- Make the sandboxable build the DEFAULT, so the feature that cannot be sandboxed is the one
  you have to ask for. A forgotten flag then fails toward the safe artifact.
- Every layer of the split (native feature flag, frontend define, bundle config overlay) must be
  selected by ONE argument, or a build can be produced with one layer missing.
- **Sell the split on the absence of the code path, never on binary size.** Measured here: the
  agent host was 5,911 lines of Rust and under 6% of the binary (~590 KB). The number that
  matters is zero marker strings for the spawn path in the free binary.
- Verify the split by grepping the BUILT artifact - binary strings and the bundled JS - not by
  reading the source. A frontend guard on a nullable value (`if (binder)`) leaves the entire
  gated IPC surface in the bundle, because a bundler cannot fold a runtime null. Only a
  compile-time literal (`if (__AGENT__ && binder)`) drops it.
- Gate the check so the bundle's NAME and CONTENTS must agree, and understand which direction
  the failure runs: a Store-bound bundle carrying the excluded feature is the case that matters.

---

## 2. Certificates: the traps are all before the first build

### 2.1 The portal ships the leaf WITHOUT the intermediate

A freshly downloaded Developer ID certificate looks correct in Keychain Access and is unusable.

```
security find-identity -v -p codesigning   ->  0 valid identities found
security find-identity    -p codesigning   ->  1) ... "Developer ID Application: Name (TEAM)"
```

Listed but never *valid*. Being listed already proves the private key is paired, so **do not go
re-exporting `.p12` files** - that is the wrong instinct and it wastes an afternoon.

**`security verify-cert` is a false negative here.** It reports success because it may consult
the system trust store. `codesign` cannot, and gives the real answer:

```
Warning: unable to build chain to self-signed root for signer "Developer ID Application: ..."
errSecInternalComponent
```

Fix, after confirming the subject is `CN=Developer ID Certification Authority, OU=G2` and that
it matches the leaf's issuer:

```bash
curl -fsSL -o DeveloperIDG2CA.cer https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
security import DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db
```

It chains to `Apple Root CA`, already in the system trust store, so no root install is needed.

### 2.2 Two other causes of "0 valid" to rule out

- **Not yet valid.** `notBefore` is UTC. A cert minted minutes ago is invalid until the clock
  passes it. Compare `openssl x509 -noout -dates` against `date -u`, never against local time.
- **The identity string is not what you typed.** Apple regenerates the subject from the account:
  a CSR with `CN=Serban Ghita` came back as
  `Developer ID Application: Gheorghe-Serban Ghita (56HTRX3D84)` - the account's legal name.
  Copy the string `find-identity` prints. Never retype it; a signing-identity preflight that
  matches literally will reject an approximation.

### 2.3 CSR fields

- **CA Email Address: leave blank.** It only feeds the "Emailed to the CA" flow, and you are
  choosing "Saved to disk".
- 2048-bit RSA. Verify before uploading:
  `openssl req -in X.certSigningRequest -noout -subject -verify`.
- **Generate it on the machine that will build.** The private key stays in that login keychain;
  a cert downloaded anywhere else is useless without it.
- Developer ID certs need the Account Holder role, are capped at 5 per account, and have no
  self-service revocation. Do not mint spares to experiment with.

### 2.4 Different channel, different certificate, and your scripts must know

A release script that hard-fails any identity not beginning with `Developer ID Application:` is
correct for direct distribution and blocks a Store build outright (which needs Apple
Distribution). Make the identity gate channel-aware in the same edit that introduces the second
channel, not twice.

---

## 3. Notarization and stapling

### 3.1 Preflight the credentials; the failure is late and vague

Half-set credentials fail deep inside the bundler with little to say - an `APPLE_ID` with no
`APPLE_TEAM_ID` silently notarizes nothing. Check all three of whichever trio you use before
building, where the error message can be useful.

**Prefer the App Store Connect API key trio** (key id, issuer UUID, `.p8` path) over the Apple
ID trio (email, app-specific password, team id): no password rotation, no 2FA mid-build.

The key must be a **team** key with the Developer role. Individual keys have no issuer UUID and
`notarytool` cannot use them.

### 3.2 Hardened runtime is mandatory; entitlements usually are not

Notarization is refused without hardened runtime. For a WKWebView app no entitlements file is
needed: the JavaScript runs in the separate system `WebContent` process, so the app itself does
not JIT, and hardened runtime does not restrict spawning children. If a signed build renders a
blank view where an unsigned one did not, `com.apple.security.cs.allow-jit` is the first thing
to try.

### 3.3 Your bundler probably does not notarize the `.dmg`

Measured on the first real release. Tauri notarizes and staples the `.app`, then builds the
image FROM it and only *signs* the image. Apple never sees the `.dmg`, and **a downloaded
`.dmg` is assessed on mount, before anyone reaches the app inside**:

```
CeraPad Pro.app  ->  accepted   source=Notarized Developer ID
CeraPad Pro.dmg  ->  rejected   source=Unnotarized Developer ID
```

Every downloader would have been stopped at the disk image while the app within it was flawless.
Submit and staple each distributed container yourself. Do not remove that step as redundant.

### 3.4 Timing, and what notarization is not

- **The first notarization took 50 minutes; the second, same machine and credentials, under
  one.** That is Apple warming up a new team, not a property of the app. Do not budget an hour
  per release and do not treat a slow first submission as a fault. Escalate past ~2 hours,
  quoting the submission id.
- **Notarization creates no App Store Connect record.** An empty Apps list is correct. There is
  no web dashboard; `xcrun notarytool history` is the only view.
- `notarytool info <id>` is the progress check. `notarytool log <id>` exists only once a
  submission reaches Accepted or Invalid.
- **The ticket binds to that exact binary.** Any rebuild - including a rebuild of identical
  source - means notarizing again. There is no "notarize the version".

---

## 4. Verification: what actually proves the release works

`tauri build` (and its equivalents) reports SUCCESS for a signed-but-unnotarized bundle. The
build tool is not a verifier. Run these post-build, every time, and fail the script on them:

```bash
xcrun stapler validate "App.app"                     # a ticket is attached; works offline
spctl --assess --type execute -vvv "App.app"         # the verdict a stranger's Mac reaches
xcrun stapler validate "App.dmg"
spctl --assess --type open --context context:primary-signature -vvv "App.dmg"
codesign --verify --deep --strict --verbose=2 "App.app"
codesign -dvv "App.app" 2>&1 | grep -c 'flags=.*runtime'   # hardened runtime still on
lipo -archs "App.app/Contents/MacOS/App"                   # universal: x86_64 AND arm64
```

Anything other than `source=Notarized Developer ID` means a warning dialog or a refusal.

### 4.1 Quarantine is why local testing lies

Gatekeeper's full check only fires on a file carrying `com.apple.quarantine`, which browsers,
Mail and AirDrop set on download. Nothing you build or copy locally has it.

- A locally built bundle launches unsigned **on the build machine only**.
- **Another local user account proves nothing** - it will happily launch a broken build.

In ascending order of conclusiveness:

1. `stapler validate` + `spctl --assess`. Independent of quarantine, which is exactly why they
   beat a launch test.
2. Simulate the download:
   ```bash
   xattr -w com.apple.quarantine "0083;00000000;Safari;" "App.app"
   open "App.app"
   xattr -dr com.apple.quarantine "App.app"
   ```
3. Download the `.dmg` through a browser on a different Mac. Only this exercises the whole chain.

macOS caches Gatekeeper assessments per app, so a repeat run can pass for the wrong reason.

---

## 5. The release script is a guard, so test the guards

### 5.1 NEVER write `producer | grep -q` under `set -o pipefail`

`grep -q` exits on its FIRST match while the producer is still writing; the producer takes
SIGPIPE, the pipeline reports **141**, and a MATCH reads as a FAILURE.

The direction of failure is why this deserves a rule. It bit twice in one script: the hardened
runtime check rejected a bundle that had it (visible, annoying), and the SKU check silently
answered "no agent" for every binary - **passing exactly the build it exists to reject**, the
one that must not reach the App Store. It only ever raised a false alarm on the safe input, so
building only that SKU would have kept it green forever while protecting nothing.

Checks that "work" are a race, not an exception: `lipo -archs` prints one short line and
finishes before grep exits. Capture first and grep a here-string, or use `grep -c`, which reads
stdin to the end:

```bash
MARKERS=$(strings -a "$BIN" | grep -c -e "marker-one" -e "marker-two" || true)
[[ "$MARKERS" -gt 0 ]] || die "..."
```

`|| true` because `grep -c` exits 1 on zero matches, which `set -e` treats as fatal rather than
as the answer.

**A guard verified only on the input it passes has not been verified.** Test every release guard
in both directions.

### 5.2 macOS ships bash 3.2

Expanding an empty array under `set -u` is an unbound-variable error there, so
`"${BUILD_ARGS[@]}"` fails on exactly the default (no-extra-args) path. Use
`${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}`.

---

## 6. If you do go to the Mac App Store: what it actually costs

The sandbox retrofit, not the packaging. Answer these before committing, cheapest-risk-first,
and stop if the answer is bad. All of it was scoped and none of it is free:

1. **Recent files break.** A user-picked file is granted for that launch only, so persisted
   absolute paths are permission-denied after a relaunch. You need
   `com.apple.security.files.bookmarks.app-scope`, security-scoped bookmarks, a format change to
   the recents file, and NSURL FFI - no Tauri plugin does this.
   - `tauri-plugin-opener` does NOT help: it hands the path to *another* app. Worse, under the
     sandbox it would still appear to work while your own process still cannot read the file.
   - `tauri-plugin-persisted-scope` persists Tauri's allowlist, not the kernel's grant. The
     sandbox denies the read regardless.
   - Bookmarks force an index-to-entry lookup, which reverses the common design of baking the
     path into the menu item id. Decide the replacement, and handle the staleness hazard the
     old design existed to avoid. A stale bookmark (file moved or deleted) is an ORDINARY state:
     clean absence, never a panic or a blocked startup.
   - **Bookmark creation requires the entitlement, and `cargo test` runs an unsigned, unentitled
     binary.** Settle this before designing the module: keep serialisation and staleness logic
     pure and testable, and put the FFI call behind a thin seam exercised only in a signed build.
2. **Atomic writes are unverified under the sandbox.** A Save panel grants the containing
   directory, but Open-then-Save on an existing file may grant only the FILE, which refuses the
   temp-sibling write. If so, the fallback (stage in the container, copy back) is not atomic
   replacement and gives up the guarantee. That trade is a product decision, not an
   implementation detail.
3. **There is a third file-access path people forget.** Besides panels and recents, a
   double-clicked document arrives from Launch Services, is queued, and is read LATER by the
   frontend - a deferred read of a grant with a different lifetime. Test it explicitly, from a
   directory never granted.
4. **Tauri has no Mac App Store target.** No `.pkg`, no embedded provisioning profile, no
   `3rd Party Mac Developer Installer` step. Expect `productbuild` plus a re-sign as a second
   script after the build.
5. **Entitlements per SKU: point at different plist files; do not try to null out an inherited
   key.** A config overlay is a merge patch, and whether the CLI implements RFC 7386 removal
   semantics is unverified. A plain value overwrite sidesteps the question. A sandboxed build of
   the wrong SKU still launches and still draws - it only fails at the feature - so this failure
   is silent and needs a release-script guard.

Verify the entitlement that shipped, never the one you configured:
`codesign -d --entitlements - "App.app"`.

---

## 7. Names and identifiers are permanent in ways that surprise people

- **No price or descriptive words in the app name** (Review Guideline 2.3.7 at time of writing;
  re-check before submission). "Free", "Lite", "Pro-Trial" are the category. The honesty belongs
  in the store SUBTITLE, which is editable and is where buyers look for price.
- "Lite" reads as *crippled* to someone who has never seen the other SKU - which describes every
  visitor to a store listing. Give the plain name to the free tier: it carries the installs and
  the search traffic, so it is where brand accumulates.
- **The bundle identifier keys the WebView data store (`~/Library/WebKit/<id>`) and
  `app_data_dir` (`~/Library/Application Support/<id>`).** Changing it starts users from blank
  storage. Before any rename, LOOK at those directories rather than reasoning about them - here
  the check was free because the directory held only WebKit's own tracking databases and every
  real setting lived in files.
- **That check stops being free the day the app ships.** After first publication a changed
  identifier is a different app that existing installs do not upgrade to.
- Two SKUs exporting the same document UTI means Launch Services picks the handler when both are
  installed. Probably right - a document type is one type - but it makes "Open With" the only
  steering mechanism, which is a support question rather than a bug to discover later.

---

## 8. Listing and submission

- **Privacy policy URL is mandatory even when the app collects nothing**, and it is required at
  developer-portal signup, not just at submission. It must be publicly reachable with no
  sign-in, on the product's own domain, and **stable forever** - portals cache it and re-review
  on change.
  - If the policy is a route in a client-rendered SPA, an automated checker that fetches without
    executing JS sees a near-empty document. Have a static-HTML fallback ready.
  - Write it from the schema and the server config, not from memory. Understating what is stored
    is worse than having no policy during a verification review.
- App Privacy questionnaire: "Data Not Collected" throughout, when true, is both honest and a
  selling point.
- The listing must state any external dependency plainly - here, that the app requires the
  user's own installed CLI. Reviewers hit the preflight screen and need to know it is expected.
- Also expect: screenshots at required sizes, category, age rating, support URL.

### 8.1 Anti-steering: do not design the funnel around a link-out

Apple restricts steering users to outside purchases (Guideline 3.1.x). The US position changed
after the 2025 injunction and the EU position moves under the DMA, so the rules differ by
storefront and are actively shifting. **Verify against current text before designing anything
around it, and do not make the business depend on it.**

The structure that survives any version of these rules:

- **The website is the top of the funnel; the store is a distribution and trust channel.**
- The free build may *describe* the paid one (comparison page on your site, a mention in listing
  copy) without an in-app button pointing outward.
- Do not ship an in-app "Upgrade" button in the store build until the rule for that storefront
  is confirmed in writing. It is the single most likely rejection.

---

## 9. Updating a shipped app

- **Every update is a fresh notarization.** Tickets bind to the binary, so there is no shortcut
  for a rebuild of identical source.
- **Store updates go through review; direct downloads do not.** If you ship both channels,
  expect the store build to lag, and do not let that become two divergent versions.
- Never change the bundle identifier post-launch (section 7). Never change the reserved product
  name to something with a price word in it.
- **Skip the self-updater unless you have decided to run one.** In Tauri, `bundle.targets: "all"`
  quietly adds the updater target, which then demands `plugins.updater` config and a signing key.
  List targets explicitly (`["app", "dmg"]`).
- Re-run the full verification block (section 4) on every release. The one time it is skipped is
  the release where the `.dmg` is unnotarized.
