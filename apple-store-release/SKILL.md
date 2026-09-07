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

### 3.3b A 2.1.0 "App Completeness" rejection is a seven-item form — answer it as one

Measured 2026-08-28/30. Build 2 carried reviewer notes that answered three of the seven items
in prose and was rejected under 2.1.0 the next day. Build 4 answered all seven **under their own
numbered headings, in the request's order, including every item whose honest answer is
"none"**, with a silent screen recording attached (launch → core flow → About dialog, one take,
no cuts, ~4 min, 1080p30 at 13 MB). Approved one day after resubmission with the binary
otherwise unchanged in substance. The reviewer is scanning for seven answers; "not addressed"
and "not applicable" look identical unless the second is written down.

Two portal details on the way there: an unreleased app's Version field is editable, so a
rejected 1.0.0 record can become 1.0.1 without a new version; and picking a build in the Build
section persists only after the page's Save — read the version's build back through the API
before pressing Resubmit.

### 3.3c Released, "available in all territories", and a 404 on every EU storefront

Measured 2026-08-30, minutes after the first release. Non-EU storefronts (`us`, `gb`, `ca`,
`au`, `ch`, `jp`) served the product page; every EU one (`ro`, `de`, `it`, `es`, `nl`, `ie`)
returned 404, and the Mac App Store app said "not available in your country or region". The
availability record claimed all territories. Cause: no **Digital Services Act trader
declaration** on the account. Apple lists an app in the EU only after the developer declares
trader or non-trader status (App Store Connect ▸ Business ▸ Digital Services Act); traders
supply address, phone and email that Apple verifies and displays on EU product pages. Nothing
in the version state, the review, or the availability API flags it — probe the storefronts per
country with `curl -o /dev/null -w '%{http_code}'` on `apps.apple.com/<cc>/app/<slug>/id<id>`
after every first release, EU and non-EU side by side.

### 3.4 Two SKUs from one target directory lose each other's `.dmg`

Measured 2026-08-28. Tauri's dmg bundler empties `bundle/dmg/` before writing, so building the
free SKU right after Pro deleted `CeraPad Pro_1.0.1_universal.dmg` with no message; the `.app`
bundles survive only because their names differ under `bundle/macos/`. If more than one product
builds from one `target/`, have the release script copy each notarized image to a directory the
pipeline never clears (`src-tauri/target/releases/`), validate the copy with `stapler`, and
upload from there. A verification loop that globs `*.dmg` in the bundle directory is not evidence
that both images exist — it will happily report the one that is left.

### 3.5 A locally installed `.pkg` relocates onto any dev bundle Spotlight can see

Measured 2026-08-28. `productbuild --component` emits `<relocate><bundle id="…"/></relocate>`
in `PackageInfo` (not the `relocatable="false"` attribute beside it, which is a package-level
flag). Installer then asks the installing user's Spotlight for an existing bundle with that id
and upgrades *that* in place: the receipt says `/Applications`, nothing appears there, and a build
directory bundle silently becomes the Store-signed universal binary. The App Store never installs
this way, so do not rewrite the packaging step to fix it. Make the source tree unreadable from
the installing account instead (`chmod 700` on the work directory — every local account is in
`staff`, and a `755` project directory is visible to all of them), which is also what a clean
demo-recording account needs.

### 3.6 Timing, and what notarization is not

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

### 4.2 Hosting the notarized file: the traps are in the pointer, not the bytes

Measured while publishing CeraPad 1.1.1 from a public GitHub releases repository, 2026-09-07.
Once notarization is done the remaining failures are all about how people reach the file.

- **A stapled ticket survives a plain `cp`.** The staple is written into the image, not into
  filesystem metadata, so copying a finished `.dmg` out of the bundler's directory - which you
  must do if two SKUs share a target tree - keeps it valid. Verify the copy rather than assuming
  it: `stapler validate` on the destination costs nothing.
- **Generate the checksum sidecar AFTER any rename.** `shasum -a 256` writes the filename into
  its output and `shasum -c` compares it, so a sidecar made before the rename fails for every
  downloader while verifying perfectly where it was made.
- **A "latest" redirect resolves per ASSET, not per release.** Version-less asset names behind a
  `releases/latest/download/<name>` URL are what let a download page hardcode a link forever -
  but the newest release becomes "latest" for every asset name at once, and one that does not
  carry a given asset simply 404s rather than falling back to an older release that does. Since
  macOS and Windows builds come off different machines, a single-platform release silently
  breaks the other platform's download unless its asset is re-attached to the new tag.
- **That redirect skips prereleases**, which cuts both ways. It is the clean way to publish an
  interim single-platform build without disturbing live links; it is also why flagging a real
  release as a prerelease makes every download link serve the previous version, with no error
  anywhere.
- **A page that prints one version for two platforms is lying about one of them** as soon as the
  platforms stop shipping together. Either carry the other build forward and say in the release
  notes which build each file is, or split the constant. Decide before publishing, because the
  tag is public.

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

### 8.2 Pre-answer what the bundle can answer; two of the blockers are `Info.plist` keys

Both of these are server-side rules with no local equivalent. The archive signs, verifies and
packages perfectly without them, and only Apple's ingestion pass has the rule — so **budget at
least one round trip per new submission surface**, and move each rejection into your own
preflight as you learn it so the same one never costs two.

- **`LSApplicationCategoryType`.** Missing it is rejection **90242**, arriving by email minutes
  after the upload tool has already reported success. Note that in Tauri this is the *top level*
  `bundle.category`, not one of the `bundle.macOS.*` keys, which is easy to miss while
  configuring everything else under `macOS`. **The value must match the category chosen in App
  Store Connect.**
- **`ITSAppUsesNonExemptEncryption`.** Without it every delivery lands in the Add Build dialog
  marked "Missing Compliance" and waits on a manual click before it can be attached to a version.
  With it, the question is settled for every build that carries it. Answer it from the code, not
  from intuition — the honest question is whether the binary *makes network requests at all*, and
  a dependency declared in the manifest but compiled out of that SKU does not count. A
  `com.apple.security.network.client` entitlement is not evidence either: a WKWebView needs it to
  serve *bundled local* content under the sandbox.
- **A second SKU does not inherit either answer.** If the paid build carries a network client or
  a crypto licence check, the compliance question has to be answered again for that binary.

**Uploading the archive is not the same as it being accepted.** Transporter validates structure
and resolves the bundle id to the app record, then reports success; the real verdict is the email.

**In Tauri specifically, `bundle.macOS.infoPlist` is a path to a plist file, not an inline
object** — the object form fails schema validation. Name that file something other than
`Info.plist`, because Tauri *also* auto-merges any file with exactly that name sitting beside
`tauri.conf.json`; using it leaves two mechanisms doing one job with the invisible one winning.

### 8.3 App Privacy is a portal form, it is not scriptable, and it must be published

The last thing between a fully configured version and **Add for Review** is usually:

> Before you can submit this app for review, an Admin must provide information about the app's
> privacy practices in the App Privacy section.

The App Store Connect API cannot write it. Measured 2026-08-27 with an **Admin**-role key, both
relationships the documentation implies are absent from the app resource:

```
/v1/apps/<id>/appDataUsages             -> 404 "The relationship 'appDataUsages' does not exist"
/v1/apps/<id>/appDataUsagesPublishState -> 404 "The relationship 'appDataUsagesPublishState' does not exist"
```

So it is **App Privacy** in the sidebar — app-level, not on the version page — Get Started, then
**Publish**. Saving a draft does not clear the banner.

Two things make a "Data Not Collected" answer defensible rather than optimistic:

- **Apple defines *collect* as transmitting data off the device.** Files the app writes on the
  user's own machine are not collection. Say no when that is what is true.
- **The App Privacy card, the listing description, the reviewer notes and the privacy policy at
  the URL Apple fetches must all agree.** A policy describing accounts or analytics beside a
  "Data Not Collected" card is a contradiction a reviewer will find, and the policy is the one of
  the four that tends to be written first and reviewed last.

### 8.4 Expect a 2.1.0 "App Completeness" rejection, and answer it as a form

A first submission of a new app is very likely to come back rejected under **2.1.0 Performance:
App Completeness** with a seven-point request for information: a screen recording, the devices
and OS tested on, function and target audience, setup and access instructions, external services
used, regional differences, and any regulated industry or protected third-party material.

**This is a form letter, not a critique of the notes you wrote.** It is sent whether or not your
reviewer notes already covered some of the points in prose — that has been observed directly on
a submission whose notes answered points 3, 4 and 5 clearly. The reviewer is scanning for seven
answers, and cannot distinguish "this app has no external services" from "the submitter did not
address external services". The second reading is the safe one for them.

So write the notes **in Apple's order, under Apple's numbered headings**, and answer every point
explicitly — above all the ones whose honest answer is "none". For a local, offline, no-account
app that will be six of the seven. Six paragraphs saying "none" feels absurd and is the entire
content of the request.

Consequences worth planning for:

- **The screen recording cannot be written, only made.** Real hardware, current OS, opening on
  the app being launched, walking the typical path, no cuts. Budget a person and an hour. Keep a
  shot list in the repo beside the listing copy so the recording is reproducible per version and
  per store — Microsoft's certification notes ask for substantially the same seven things.
- **Point 7 rewards an actual audit.** Enumerate every bundled third-party asset and its licence
  before answering. Attribution-required licences (CC-BY for icon and emoji sets is the common
  one) need a surface you can name. A licence banner preserved inside the shipped bundle
  satisfies the licence; a visible About-window credit is the answer a reviewer can verify. Know
  which of the two is in the build actually under review — a notes claim about an About dialog
  that postdates the uploaded build is a false statement to Apple, not a rounding error.
- **A rejection resets only the review.** Metadata, screenshots, categories, age rating and the
  published App Privacy all survive; the version goes to `REJECTED`, the submission to
  `UNRESOLVED_ISSUES`, and the notes field stays editable in place. Resubmit is a portal button.
- **Turnaround is fast.** The rejection above arrived one day after submission. Have the answers
  drafted before you submit, not after.

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
