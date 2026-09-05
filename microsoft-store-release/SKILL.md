---
name: microsoft-store-release
description: Shipping a desktop app to the Microsoft Store as MSIX - Partner Center registration and the verification waits, the publisher segment in Package/Identity/Name that is permanent for the life of the ACCOUNT, product-type choices that cannot be converted, transcribing assigned identity values into AppxManifest, packaging with makeappx when the toolchain has no MSIX target, runFullTrust and what the packaged container does to child processes and file paths, WACK and certification, and what each update costs. Load when registering in Partner Center, reserving a name, building or validating an MSIX, or planning a Store submission or update. Also: test-signing a package for local install, running
WACK under elevation and reading its tests rather than its verdict, and keeping the exact bytes you
uploaded.
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
- **"Publisher IDs" on Legal info is a section heading, not a field.** The blank space beside it
  reads as an empty value and is not one; the real identifiers are the rows underneath it. It was
  mistaken for pending review twice here before that was established.

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

**Check the apps list before reserving anything.** A second product cannot hold a name the first
already holds, and the failure mode of trying is a "name unavailable" message against your own
reservation, which reads like someone else took it.

Record the Store ID and dashboard URL the reservation produces; you will need them for every later
step - **and re-read the Store ID from the dashboard after any deletion, because it does not
survive one.** A deleted draft's ID redirects to `product/NotFound`; a dead one sat in this
project's docs for a week because two files recorded it and only one was re-read. Record identity
values in exactly one place.

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
  is not blocked on someone re-finding the page. Better, keep them in ONE place the packaging
  script substitutes into the manifest, with the manifest carrying placeholders and the script
  refusing to pack if any survive - a forgotten value is then a build failure rather than a
  rejected upload.
- **The Package Family Name's hash suffix is derived from the publisher**, so every product on the
  account carries the same one. **The Package SID is not**: it is assigned, it differs per product,
  and it appears on the product identity page only once a submission exists. Predict neither it nor
  a second product's identity name from the first.

---

## 5. Packaging MSIX when your toolchain has no MSIX target

Tauri emits no MSIX. Package the built binaries directly: a checked-in `AppxManifest.xml` carrying
placeholders for the assigned identity values, and a release script that stages the file set into a
directory and calls `makeappx pack /d` on it. Deterministic and CI-able, unlike the MSIX Packaging
Tool GUI.

**Stage a directory; do not hand-maintain a mapping file.** A mapping file is a second list of what
belongs in the package, and the failure mode of the two lists disagreeing is a package that
installs and then does not start. A directory is also something you can look at before packing it.

- **Derive the file set; do not assert it.** Build once on Windows, inspect the release target
  directory AND one throwaway installer bundle's install tree, and have the script stage from that
  verified list. Whether the exe is self-contained or needs a runtime loader DLL beside it is a
  toolchain question, not a documentation question. A wrong file set installs cleanly and fails at
  launch on a clean VM.
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
  certification. Sections 5.1 to 5.3 are that, the elevation it drags in, and WACK - all measured
  rather than planned.

### 5.1 Test-signing, and the two builds that overwrite each other

You need TWO packages per release and they are not interchangeable: a **signed** one to install
and smoke-test locally, and the **unsigned** one that goes to Partner Center (the Store signs it
during certification). Most packaging scripts write both to the same output path, so **build the
unsigned upload package LAST and do not touch it afterwards** - WACK reads it, and it is the file
that goes up.

- **Trusting the cert is a separate step from having it.** The self-signed certificate must be
  imported into `Cert:\LocalMachine\TrustedPeople` (elevated), not merely present in
  `CurrentUser\My`, or `Add-AppxPackage` refuses the package as untrusted with `0x800B0109`. Its
  subject must match the manifest `Publisher` exactly.
- **If signtool reports "The specified PFX password is not correct", do not regenerate the
  certificate.** Re-export the `.pfx` from the certificate still sitting in `CurrentUser\My`,
  under a password you choose. The thumbprint is unchanged, so the elevated `TrustedPeople` import
  does NOT need repeating; regenerating from scratch would mean redoing it for nothing.
- Have the script print **different messages** for "the password variable is unset" and "signtool
  failed". That distinction is what tells you the variable was populated and simply wrong, which
  is the case above.
- Nothing shipped is signed with this certificate, so it carries no history worth preserving and
  is disposable once its private key is gone as well.
- **Uninstall the test-signed package before the clean-machine check.** A Store-signed package
  installs badly over a differently-signed one of the same identity. Removal wants a
  PackageFullName, which is a different string from the Package Family Name your docs record, so
  pipe it rather than naming it: `Get-AppxPackage <Identity.Name> | Remove-AppxPackage`.
- **Delete stale packages before building.** A packer that deletes only the filename it is about
  to write leaves every earlier version sitting in the folder you later browse for the upload.
  That is how the wrong file goes to the Store.

### 5.2 One elevated terminal, and what that costs

WACK needs elevation (5.3), and a script that builds, packs and then validates in one pass means
the build runs elevated too. Splitting it - build unprivileged, WACK by hand - loses the guards
the script earned, so take the trade: run the whole release from one Administrator terminal and
expect the build output directory to end up Administrator-owned. **Launch the app itself from the
Start menu**, not from that terminal, so smoke tests, screenshots and recordings show an ordinary
user-level process.

Two Windows-shell traps that cost a release run each here:

- **An npm script that calls `powershell` runs Windows PowerShell 5.1**, whatever edition the
  terminal is. Anything whose default differs between editions has to be pinned. Write a hash, or
  any value read back days later, with `Set-Content -Encoding ascii` and never `Out-File`: 5.1
  defaults to UTF-16LE with a BOM and 7 to UTF-8 (measured: 18 bytes against 8).
- **Native tools do not accept the relative, forward-slashed paths every cmdlet takes.** `appcert`
  rejected `"$outDir/wack-report.xml"` with "must be valid path to the report file", which reads
  like a broken directory rather than like relativity. Resolve the directory and join the filename
  onto it; the report itself cannot be resolved, because it does not exist yet.

### 5.3 WACK: it needs elevation, and you read its TESTS, not its verdict

Run WACK **on the exact package you will upload**, never on a rebuild. Then distrust its summary:

- **`OVERALL_RESULT: PASS` coexists with failing tests inside the report.** Measured twice here,
  once hiding a real packaging bug (the unqualified logos were the 2x art). Parse the report:

  ```powershell
  $x = [xml](Get-Content <report>.xml -Raw)
  $x.REPORT.OVERALL_RESULT
  @($x.SelectNodes('//TEST')) | Where-Object { $_.SelectSingleNode('RESULT').InnerText -ne 'PASS' } |
    ForEach-Object { $_.NAME }
  ```

  The `@()` is load-bearing: with exactly one failing test - the normal outcome - the pipeline
  emits a bare `XmlElement`, PowerShell's XML adapter resolves `Count` against that element's own
  children, and under `Set-StrictMode -Version Latest` the whole thing dies AFTER a successful
  WACK run, suppressing the very list it exists to print.
- **From a non-elevated shell, `appcert` prints nothing, writes no report, and leaves
  `$LASTEXITCODE` at 0**, so an exit-code check agrees with it. Test for elevation BEFORE the WACK
  step and refuse with the fix in the message. Otherwise the only thing that catches the run is a
  report-existence check minutes later, under a message that names the symptom rather than the
  cause.
- `appcert` **refuses to overwrite an existing report** and exits non-zero, which for several runs
  here meant no WACK ran at all while the script pointed cheerfully at a stale one. Remove the
  report before running, and check the report is NEWER than the package before trusting it.
- **A missing kit must not be a warning.** If the script only warns when `appcert.exe` is absent,
  a release run reaches its end with the package unverified.
- **Expect "Blocked executables" to fail** for any app that spawns a process or opens a URL. Part
  of it is real API use (`CreateProcessW`, the `ShellExecute` pair), and part is a
  case-insensitive substring scan over the binary's bytes rather than analysis: it reported
  `cmd.exe`, `basH`, `rEG` and `cSI` against a build containing no shell code at all, and **the
  casing of its hits varies between runs on binaries nobody touched** (`Cmd`, `CMd`, `cMD`,
  `basH` across four runs). Write the explanation into the notes for certification before a
  reviewer finds it.
- The rule underneath the three failures above, worth generalising past this tool: **a
  verification step that cannot read its input must refuse rather than agree.** In this project's
  script the exit code was worthless every time and the artifact check did all the work.
- **A step documented as the worse of two options stops being exercised, and then quietly stops
  working.** The WACK results recorded in these docs for weeks came from running `appcert`
  separately by hand, so the script's own WACK block had never once executed, and it carried two
  defects when it finally did.

---

## 6. The packaged container changes runtime behaviour - validate on the INSTALLED package

A dev build proves nothing about a Store install. Every one of these is a container effect that
only appears after installation:

- **`C:\Program Files\WindowsApps\` has restrictive ACLs**, so anything that re-executes the
  app's own absolute exe path (a hook, a helper, a self-invoked subcommand) is at risk: a normal
  process cannot traverse that directory. **Measured here: it works.** `BUILTIN\Users` holds
  `ReadAndExecute` on the packaged exe and an ordinary process ran it, so the re-exec that a
  security hook depends on survived the container. Verify it anyway on your own package - if it
  fails, a security canary turns it into a permanently dead feature that works fine in dev.
  **Plan B, not needed here but named: expose an app-execution `Alias` in the manifest and invoke
  that instead of the raw WindowsApps path.**
- **AppData virtualization is real and it is invisible to the process.** Measured: settings,
  recent-file lists, snapshots and the WebView2 store all landed under
  `%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\<app id>\` while the process still read
  `APPDATA=C:\Users\<u>\AppData\Roaming`. So **`unvirtualizedResources` was not needed**: no code
  has to know. Do not add it preemptively.
- **What virtualization DOES break is shipping one product through two channels.** A Store install
  and a direct download do not share a data directory, so a user moving between them finds no
  recent files, no settings and no crash snapshots, silently. Three ways out, all of them a
  decision rather than a fix: declare
  `<desktop6:FileSystemWriteVirtualization>disabled</...>` (shares the data, gives up the
  container's clean uninstall); migrate on first run (one-directional, diverges afterwards); or
  accept it and say so in the listing. Decide it before both channels have users.
- **`%USERPROFILE%` is NOT virtualized**, which is what makes a bring-your-own-credential design
  survive the container: a child process spawned under package identity still read the user's own
  `~\.claude` and reported a logged-in CLI. If your app delegates to a tool that authenticates
  from the user's home directory, this is the check that decides whether the Store is viable at
  all - make it early.
- Re-run the platform's own risky paths inside the container: file open by double-click, single
  instance, cancellation/process teardown, atomic saves onto sync-backed folders.

Checklist for one clean Windows 11 VM with the installed package: launch, file association from
Explorer, one full end-to-end run of the app's headline feature, and confirmation that data
written lands where every consumer expects it. Two things that only the packaged build can prove,
and that had never been exercised here before the first submission: **opening a document by
double-click from Explorer**, and **a link in the app opening the default browser**.

After the listing is live, repeat it against the Store-installed package:

```powershell
Get-AppxPackage <Identity.Name> | Format-List Name,Version,SignatureKind,PackageFullName
```

`SignatureKind` must read **Store**, not Developer, and the bare cmdlet's default view does not
print it. **A second local account is not a clean machine**: the test certificate is trusted
machine-wide and the app is already installed under another user. Use a VM or a machine that has
never seen the app.

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
- **Send the simpler SKU through certification first.** It is the cheaper pass, and whatever the
  tester asks about the parts both SKUs share gets answered once, before the harder SKU's own
  questions are on the table.

---

### 3.1 Read the dashboard before reserving; the status column tells you how far a product got

Measured 2026-09-03: a recollection that only the paid SKU had been registered was wrong - both
products were in the apps list, the free one reserved five weeks earlier. Reserving is cheap but
the name is held by your own draft, so a second attempt fails with a "name unavailable" that
looks like a conflict with a stranger. The apps list and each product's identity page are the
record; docs written from memory are not.

The Status column encodes the submission state, and the two idle values are not the same thing:

| Status | Meaning |
|---|---|
| **Not started** | reserved, no submission draft ever created; the overview page offers "Start submission" |
| **Not submitted** | a draft exists (its Pricing and availability has usually been visited - the Markets column fills in) but nothing was sent to certification |

When two SKUs share an account, ship the free or simpler one first: the shared parts of the
package (the WACK "Blocked executables" line, the manifest, the file association) get their
certification questions answered once, before the harder SKU's own questions are added on top.

## 8. Submission checklist

- Listing description states any external dependency plainly (here: the app requires the user's
  own installed CLI), so certification testers understand a preflight screen rather than filing
  it as a failure.
- **Write the notes for certification as NUMBERED points, before the submission exists.** Every
  awkward thing a reviewer will hit gets a point: the external dependency, the one process the app
  launches, the WACK failure from 5.3, the restricted-capability justification. A certification
  question is then answered by pointing at a point, rather than re-improvised under time pressure
  into wording that contradicts the listing.
- **Never write a promise into a submission that the submission might not keep.** "Attached to
  this submission" is a claim about a portal field nobody has tested yet; describe the artifact
  and offer it on request instead, which is true under either ending.
- **A restricted capability such as `runFullTrust` makes Partner Center demand a written
  justification** at submission time. It is not conditional and it is not the place to compose
  prose; paste the prepared point.
- **Upload validation runs on the packages page and you must wait for it there.** Identity
  mismatches (section 4) fail at that moment, not days later at certification - which is the whole
  value of not navigating away.
- The submission shows a per-section status and **Submit stays disabled until every section reads
  complete**, so save each section before moving to the next.
- Screenshots: accepted **1366x768 through 3840x2160**, unresized - a capture from a scaled or
  cropped image is refused. Take them from the INSTALLED package, so the window chrome and title
  bar are the shipping ones, not a dev build's.
- A trailer field takes a video: an 88 MB, 2:32 MP4 was accepted (2026-09). If you record a
  walkthrough for the reviewer, **use the Snipping Tool's video mode, not Xbox Game Bar** - Game
  Bar records a single focused app window and cannot capture File Explorer, Settings or the
  desktop, which a shot list proving file handling always needs.
- Age rating questionnaire.
- **Privacy policy URL** - publicly reachable with no sign-in, on the product's own domain, and
  stable forever; portals cache it and re-review on change. Required even when the app itself
  collects nothing, because the spawned tooling or the website may.
- WACK pass on the exact uploaded package (section 5.3).
- Certification feedback resolved.
- **Measured turnaround:** a full-trust MSIX whose WACK report carried a failing "Blocked
  executables" test, pre-explained in the notes for certification, was submitted on a
  Thursday and live on the Saturday, two days later. Plan on "a few hours to three business
  days" and expect the short end when the notes answer the questions first.
- **The listing URL is `apps.microsoft.com/detail/<store id>`**, and the id is
  case-insensitive. Partner Center's share button appends `?cid=DevShareMCLPCS&hl=..&gl=..`;
  record the bare form, since the tracking and locale parameters are noise.
- Post-certification: install from the Store on a machine that has never seen the app; verify
  Microsoft's signature and that updates flow through the Store (section 6).

### 8.1 Keep the exact bytes you uploaded

A packaging script repacks the same filename on every run at a given version, so **the bytes that
went to the Store stop existing the next time anyone builds** - and certification takes days, so
that window is exactly when a question about the uploaded package arrives with nothing left to
inspect.

Keep three things together, **outside the build tree**: the `.msix`, its WACK report, and its
SHA-256. Outside, because a clean of the build directory removes everything in it including what
the build tool did not put there, and because a second plausible package sitting in the folder you
upload from is how the wrong file goes up (5.1). **Write the hash to a file, not to the screen**:
it is read back days and one submission later, long past the life of a terminal's scrollback, and
recording the identity of a volatile artifact somewhere equally volatile undoes the point. It is
the one thing that answers "was what failed certification what we tested".

---

## 9. Updating a published app

- **Every update goes through certification.** Direct download does not. Expect the Store build
  to lag the direct one, and do not let that become two divergent versions.
- **Every submission needs a higher version than the last, and `Identity/Version` is four-part
  with the fourth part reserved by the Store.** So a rejected 1.0.1 goes to 1.0.2, never to
  1.0.1.1 - the revision must stay 0. Single-source the version from one file the packaging
  script reads, or the bump becomes a hunt through literals.
- **Package identity is immutable after first publication.** A changed identity is a NEW product
  that existing installs do not upgrade to - which is the real cost behind every naming rule
  above.
- The Store delivers updates, which is a legitimate reason to ship no self-updater at all.
- `PublisherDisplayName` must still match the account's currently approved display name at every
  upload, so a rename in flight blocks updates, not just first submission.
