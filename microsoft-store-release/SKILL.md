---
name: microsoft-store-release
description: Shipping a desktop app to the Microsoft Store as MSIX - Partner Center registration and the verification waits, the publisher segment in Package/Identity/Name that is permanent for the life of the ACCOUNT, product-type choices that cannot be converted, transcribing assigned identity values into AppxManifest, packaging with makeappx when the toolchain has no MSIX target, runFullTrust and what the packaged container does to child processes and file paths, WACK and certification, and what each update costs. Load when registering in Partner Center, reserving a name, building or validating an MSIX, or planning a Store submission or update.
---

# Releasing a desktop app on the Microsoft Store (MSIX)

Distilled from taking CeraPad (`~/work/whiteboard-app`) to Partner Center: a Tauri 2 desktop app
packaged as MSIX for Windows 11. The account, name reservation and identity work are DONE and
measured; the packaging chapters are planned against verified constraints. Windows-side app code
rules (job objects, `.cmd` spawning, path casing) are a separate concern - this is the store.

Framing fact: **Microsoft signs the package during certification**, so no code-signing
certificate is purchased for this channel. That removes the OV-certificate question entirely for
Store builds - but not for a direct download, which still needs a cert or eats SmartScreen
warnings.

---

## 1. Do the account and name work FIRST; it is slow and it blocks packaging

Registration, identity verification and name reservation are independent of all code and take
days. The manifest cannot be written until Partner Center has assigned identity values, so any
plan that schedules registration late has its packaging chapter blocking on a step scheduled
after it.

- Register the individual developer account through the current flow (measured 2026-08:
  https://storedeveloper.microsoft.com, **fee waived on that path only** - the classic Partner
  Center signup charges the one-time ~$19).
- Expect blockers that look like faults and are not. One account sat in "a deactivated state"
  for a day before support cleared it.
- Confirm account type and status under **Account settings > Legal info > Developer**.

### 1.1 Renaming the publisher display name puts the account back through verification

Typically 3-5 days. While it is pending, **the Publisher IDs block on Legal info shows empty -
that is review state, not a stale page**, and refreshing will not clear it. Status lives on the
**Verification Summary** page, linked from the banner at the top of Legal info; Legal info itself
only updates after review lands.

**Do not package or upload while a rename is pending.** A package whose `PublisherDisplayName`
does not match the account's currently-APPROVED name fails upload validation.

---

## 2. The publisher segment in the package identity is permanent, and it belongs to the ACCOUNT

This is the single most expensive thing to learn late, and it was measured the hard way:
**deleting and re-reserving the product does not change it.** The submission was deleted several
times on 2026-08-21 and `35187Galli.CeraPad` came back unchanged every time.

The reason is that Partner Center keeps **two** names:

| | Set when | Changeable | Where it appears |
|---|---|---|---|
| **Publisher Name** | account registration | NEVER | the `35187Galli` segment of every package identity the account will ever issue |
| **Publisher display name** | any time | yes, at the cost of re-verification | the store listing |

Renaming the second does not touch the first, and a newly reserved product **inherits the same
frozen publisher segment**, so re-reservation is churn with no effect. Microsoft's own wording:
"the app identity name will continue to show the first name reserved", and once an app is
created its Package Identity "can no longer be changed".

**The only thing that removes it is a new Partner Center account** registered with the desired
publisher name from the outset - which also means re-verification and moving every name
reservation between accounts.

Before paying that: the segment is **not user-facing**. The listing shows the publisher *display*
name and the reserved product name. The identity name surfaces only in the Package Family Name,
the `C:\Program Files\WindowsApps\<Publisher>.<Name>_...` install path, and `Get-AppxPackage`
output. Weigh a new account against that, not against a listing users read.

**Also: the Seller ID is NOT the package-name prefix.** They are different per-publisher values
(here: Seller ID 53795700 versus the `35187` prefix) and are the pair most likely to be
substituted for each other.

---

## 3. Reserve the name under the right product type - the types are not convertible

"MSIX or PWA app" and "EXE or MSI app" are distinct product families. A name reserved under the
wrong one must be deleted and re-reserved under the right one; there is no conversion. (Done
here: the first reservation on 2026-08-19 was an EXE/MSI product, deleted and re-created as
MSIX.) Deleting a draft is safe **before first publication** and the only lever that exists at
all - after publication, identity is frozen for good.

Record the Store ID and dashboard URL the reservation produces; you will need them for every
later step.

### 3.1 No price words in the reserved name

Same rule as Apple's Guideline 2.3.7, and **more expensive here**: `Package/Identity/Name` is
permanent after first publication, so a price word is baked into an immutable identifier forever
and the only escape is a new product that existing installs do not upgrade to. Put the price
honesty in the editable store subtitle instead.

---

## 4. Identity values are ASSIGNED, not chosen

Three values from **Partner Center > Product > Product identity** go verbatim into the manifest:

```
Package/Identity/Name:                    <PublisherSegment>.<ProductName>
Package/Identity/Publisher:               CN=<GUID>
Package/Properties/PublisherDisplayName:  <account's current approved display name>
```

- `makeappx` packs whatever the manifest says; **certification rejects any package whose identity
  does not match what Partner Center assigned.** The manifest is a transcription of that page and
  never a place to edit a name.
- Only `PublisherDisplayName` tracks the account and changes with a rename (section 1.1). The
  other two are fixed.
- Store them in the project's publishing doc as soon as they are assigned, so the packaging step
  is not blocked on someone re-finding the page.

---

## 5. Packaging MSIX when your toolchain has no MSIX target

Tauri emits no MSIX. Package the built binaries directly: a checked-in `AppxManifest.xml` plus a
mapping file, assembled with `makeappx pack` from a release script. Deterministic and CI-able,
unlike the MSIX Packaging Tool GUI.

- **Derive the file set; do not assert it.** Build once on Windows, inspect the release target
  directory AND one throwaway installer bundle's install tree, and have the script GENERATE the
  mapping from that verified list. Whether the exe is self-contained or needs a runtime loader
  DLL beside it is a toolchain question, not a documentation question. A wrong mapping installs
  cleanly and fails at launch on a clean VM.
- **Do not configure an installer target you do not ship.** If the MSIX takes binaries, an NSIS
  target ships nowhere: its WebView2 install mode configures an installer nobody runs, its
  publisher metadata is overridden by the manifest, and its file-association registry writes are
  superseded by the manifest's FTA. Build with `--no-bundle` and keep one throwaway installer
  build as a discovery step only.
- **`runFullTrust` is the capability that makes this channel viable for apps macOS cannot ship.**
  It permits spawning child processes, so the App Sandbox constraint that confines such an app to
  Developer ID on macOS has NO Windows equivalent. Both SKUs can ship here.
- Windows 11 target (`MinVersion 10.0.22000.0`) means WebView2 ships with the OS - no bundled
  WebView2 installer in the package.
- Declare file-type associations in the manifest, not in the toolchain's bundler config.
- **Icons: generate scale-qualified and targetsize variants** (`Square44x44Logo.scale-*.png`,
  `targetsize-*` taskbar variants). A flat `Square*Logo.png` set may pack fine and then draw
  blurry or fail certification asset checks.
- **Local testing needs a self-signed cert**, because the Store-signed package only exists after
  certification. Install the self-signed `.msix` on a clean Windows 11 VM.
- Run **WACK (Windows App Certification Kit) on the exact package you will upload**, not on a
  rebuild.

---

## 6. The packaged container changes runtime behaviour - validate on the INSTALLED package

A dev build proves nothing about a Store install. Every one of these is a container effect that
only appears after installation:

- **`C:\Program Files\WindowsApps\` has restrictive ACLs.** Anything that re-executes the app's
  own absolute exe path (a hook, a helper, a self-invoked subcommand) is at risk: a normal
  process cannot traverse that directory. A child of the packaged app should inherit the package
  context, but this is exactly the assumption that fails only on the installed package - and if
  it fails, a security canary turns it into a permanently dead feature that works fine in dev.
  **Named plan B: expose an app-execution `Alias` in the manifest and invoke that instead of the
  raw WindowsApps path.**
- **AppData virtualization** can redirect anything the app or its child processes write. Confirm
  where recents, snapshots, settings and any workspace actually land; if they are virtualized and
  a consumer cares, add `unvirtualizedResources` to the manifest and retest. Decide this from
  measurement, not preemptively.
- Re-run the platform's own risky paths inside the container: file open by double-click, single
  instance, cancellation/process teardown, atomic saves onto sync-backed folders.

Checklist for one clean Windows 11 VM with the installed package: launch, file association from
Explorer, one full end-to-end run of the app's headline feature, and confirmation that data
written lands where every consumer expects it.

---

## 7. The Store as a commercial channel

- **Microsoft signs during certification** - no code-signing certificate to buy for this channel.
- **15% cut, and Microsoft handles VAT and sales tax.** That nets about the same as a merchant of
  record, which makes the Store the administratively CHEAPER channel, not merely the more
  discoverable one.
- **A Store purchase IS the entitlement**, so paid Store listings need no licence mechanism. But
  if you also sell direct, you now have **two entitlement paths** and the app must accept either
  without asking the user which they hold.
- A second SKU needs its own product reservation, and inherits the same frozen publisher segment
  (section 2). There is no per-product naming convention left to decide.

---

## 8. Submission checklist

- Listing description states any external dependency plainly (here: the app requires the user's
  own installed CLI), so certification testers understand a preflight screen rather than filing
  it as a failure.
- Screenshots.
- Age rating questionnaire.
- **Privacy policy URL** - publicly reachable with no sign-in, on the product's own domain, and
  stable forever; portals cache it and re-review on change. Required even when the app itself
  collects nothing, because the spawned tooling or the website may.
- WACK pass on the exact uploaded package.
- Certification feedback resolved.
- Post-certification: install from the Store on a machine that has never seen the app; verify
  Microsoft's signature and that updates flow through the Store.

---

## 9. Updating a published app

- **Every update goes through certification.** Direct download does not. Expect the Store build
  to lag the direct one, and do not let that become two divergent versions.
- **Package identity is immutable after first publication.** A changed identity is a NEW product
  that existing installs do not upgrade to - which is the real cost behind every naming rule
  above.
- The Store delivers updates, which is a legitimate reason to ship no self-updater at all.
- `PublisherDisplayName` must still match the account's currently approved display name at every
  upload, so a rename in flight blocks updates, not just first submission.
