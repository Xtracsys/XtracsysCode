# macOS arm64 release preparation

## Status and boundaries

This configuration prepares **unsigned, unnotarized test artifacts**, not a signed/public-release-ready application. `mac.identity: null` and `hardenedRuntime: false` are intentional. No signing identity, Developer ID, notarization, or Gatekeeper acceptance is implied. A successful direct launch is not a test of opening an internet-downloaded quarantined app.

Do not remove quarantine, disable Gatekeeper, use `--no-sandbox`, change privileges, install in `/Applications`, or overwrite real application settings. Do not publish these artifacts under this sprint approval.

## Coordinator prerequisites

1. Integrate and review all source changes and `THIRD_PARTY_NOTICES.md`; finish the focused tests, full tests, typecheck, and build before packaging. Do not build concurrently with source agents.
2. Review `scripts/release-verify.mjs`, especially its process handling, ZIP extraction, mount/detach, and smoke environment. It uses existing `@electron/asar` and `yauzl` from electron-builder's installed dependencies; it performs no installs or network requests.
3. Implement and review the **package-smoke contract below in coordinator-owned main/renderer code**. The verifier refuses to launch a package without both the mode name and marker in its compiled main module.
4. Use the inherited `TMPDIR` under the home scratch parent (`~/.cache`). Disposable verification state is created only below `~/.cache/xtracsyscode-sprint/mac-verify-*`. The script requires the exact approved checkout, nonredirected project/release/scratch roots, macOS, and an arm64 host.
5. Existing `build/icon.icns` is retained and its bytes are checked in the resulting bundles. Required resource inputs: root `LICENSE`, root `THIRD_PARTY_NOTICES.md`, `bundled-skills/`, and the installed Electron distribution's `LICENSE` and `LICENSES.chromium.html`. The runtime's complete notices are copied as `LICENSE.electron.txt` and `LICENSES.chromium.html`. The verifier also checks the packaged marked license against `node_modules/marked/LICENSE.md`.

### Existing exFAT builder prerequisite

The current installed `app-builder-lib/out/asar/integrity.js` already has a local change that skips `._*.asar` during integrity computation. That computation occurs **before** `afterPack` (see `platformPackager.js`), so the cleanup hook alone cannot fix that earlier upstream bug. This sprint preserves the existing dependency state and does not modify dependencies or disable ASAR integrity. A clean/unpatched dependency installation on exFAT remains a portability limitation; if `readAsarHeader` fails on an AppleDouble shadow, stop and report the blocker rather than silently patching installed dependencies or weakening integrity. No dependency installation is approved here.

## Required isolated package-smoke contract

**Do not run the existing `XTRAC_E2E=1` path.** `runE2E()` discovers real backends, performs inference, and runs tools with automatic approval. Even the normal first-run WelcomeWizard probes backends (`web/src/components/WelcomeWizard.tsx`). Disposable HOME by itself does not prevent that activity.

The verifier launches the ZIP payload's executable directly with a minimal environment, not `open`/LaunchServices:

- `XTRAC_PACKAGE_SMOKE=1`
- `XTRAC_PACKAGE_SMOKE_ROOT=<fresh mac-verify-* directory>`
- `HOME` and `CFFIXED_USER_HOME` point at `<root>/home`
- `TMPDIR=<root>/tmp/`; XDG config/cache/data also point inside that home
- `--user-data-dir=<root>/user-data`
- `--disable-background-networking --disable-component-update` (not a substitute for the application-level guards)
- No inherited `XTRAC_E2E`, `XTRAC_DEV`, provider credentials, Node injection flags, or user environment.

Coordinator implementation checklist:

1. Before `requestSingleInstanceLock()` and before any persistence, recognize smoke mode with the strict comparison `process.env.XTRAC_PACKAGE_SMOKE === '1'`. Validate the real smoke root is a newly created directory beneath the sprint scratch tree; reject missing/redirected roots and conflicting E2E/dev modes. Redirect Electron home, userData/sessionData, cache, logs, crash dumps, and temporary paths inside it before they are used. Require the supplied `--user-data-dir` to match. This prevents the smoke instance contacting an existing normal instance or relying on macOS's real Application Support location.
2. In `whenReady`, construct `Storage` with an explicit `<root>/data` root, never the default. Initialize the normal local storage/preload/renderer path, but skip scheduler, scheduled backup, periodic jobs, MCP/plugin execution, and `runE2E` entirely. Keep the packaged renderer and normal sandbox/security settings.
3. Block all model discovery, pulls, inference, external navigation, and execution IPC in this mode, including `backends:models` returning empty arrays with no provider call. The wizard otherwise probes automatically. Constrain file-browse IPC to the disposable home or suppress the wizard for smoke. Deny nonlocal/file renderer requests; no network is needed.
4. Register load/crash failure handlers **before** loading the window. On successful packaged renderer readiness, verify the root element contains rendered UI and the preload API/init handshake works. Emit exactly one stdout line `XTRAC_PACKAGE_SMOKE_OK` only after those assertions, then flush stdout and call normal `app.quit()`. Do not emit the marker immediately upon process start or from a timeout. On load/render/init failure, exit nonzero without the marker. Use a short internal watchdog (for example 20 seconds).

A suggested hook location is `createWindow`'s existing `did-finish-load` handler, with a bounded awaited renderer/init check, and the smoke branch in `whenReady` immediately before normal scheduler/backup setup. Only the coordinator edits main/renderer code. The external verifier requires **both exact marker and natural exit 0 within 30 seconds**; timeout survival is a failure. It stops only its freshly spawned process/private process group, never `pkill`/`killall` or a user instance.

## Build and verify (coordinator only)

Run these already-approved commands serially from `the project checkout`, after source integration and review:

```sh
npm run dist:dir
npm run dist
node scripts/release-verify.mjs
```

The existing scripts target macOS DMG/ZIP; configuration explicitly selects arm64. The verifier deliberately expects:

- `release/mac-arm64/XtracsysCode.app`
- `release/XtracsysCode-<package-version>-arm64.dmg`
- `release/XtracsysCode-<package-version>-arm64-mac.zip`

If official Electron/builder packaging assets are missing from existing caches, the approved network scope is HTTPS to `github.com`, `api.github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, and `electronjs.org` only. No package installs/upgrades, model downloads, or arbitrary app traffic.

## Verification outputs and failure handling

The script runs pure path/link regression assertions first, then:

- `hdiutil verify` and `unzip -tq`, each bounded to 120 seconds.
- Safe, size/entry-limited ZIP extraction into disposable scratch; reject traversal, duplicates, encrypted entries, external links, private paths, AppleDouble, and unsupported file types. Internal framework links are created only after all regular files.
- Metadata checks with `plutil`; thin arm64 main/framework checks with `file`; ASAR inclusion/compiled-source freshness checks; complete project/Electron/marked notices, bundled skills, and icon checks.
- Full byte/link/path manifests compared across the unpacked, ZIP, and **read-only mounted DMG** app bundles. The DMG mountpoint is inside disposable scratch, not `/Volumes`; detach is attempted in `finally`, without force.
- Read-only `codesign --verify`, `codesign --display`, and `spctl --assess` statuses, recorded for every bundle. Nonzero unsigned/Gatekeeper results are evidence/limitations, not silently treated as a signed-release pass.
- The isolated launch/renderer-ready/quit check described above.
- Node SHA-256 hashing of exactly this version's two Mac artifacts, before and after verification; old releases/Windows/Linux outputs are not included.

Each native subprocess has a timeout and 1 MiB output limit; overall work has a 12-minute deadline, 20,000-entry/2 GiB bundle limits, and a 128 MiB ASAR cap. No real projects/settings are used.

On success: `release/SHA256SUMS.txt` and `release/mac-verification.json` describe the exact artifacts and limitations; disposable state is removed. `signedReleaseReady` remains false. On failure: exit nonzero and print the path of a retained scratch `verification.json`; do not generate a new success manifest. Existing manifests can be stale: only a successful current command and its matching timestamps/hashes count. If detach fails, leave scratch intact and report the mountpoint; never force-unmount or recursively delete a mounted filesystem. No persistent QA process should remain.

## Coordinator verification receipt

The final integrated arm64 DMG/ZIP build exited 0 using explicit approved home TMPDIR. `node scripts/release-verify.mjs` exited 0 with `passed:true`, `signedReleaseReady:false`; see `release/mac-verification.json` and `release/SHA256SUMS.txt`.

- DMG and ZIP integrity passed; unpacked/ZIP/read-only-DMG bundles matched byte-for-byte (214 manifest entries each).
- Project/Electron/Chromium/Marked notices, bundled skills, compiled sources, architecture and retained icon passed resource checks.
- The extracted ZIP executable loaded actual React UI and sandboxed preload, completed its isolated state handshake, printed `XTRAC_PACKAGE_SMOKE_OK` and exited naturally with code 0; no inference or real user data was used.
- Code-signature verification and Gatekeeper assessment both returned 1. These are local-test artifacts, not Developer-ID-signed or notarized releases. No quarantine removal or protection bypass occurred.
- DMG: `XtracsysCode-0.5.0-arm64.dmg`, 101605077 bytes, SHA-256 `23a9f413c982409c2bb21656ddad8332411ac5c2c8a29575ac32b2ffa5956787`.
- ZIP: `XtracsysCode-0.5.0-arm64-mac.zip`, 106984655 bytes, SHA-256 `69b5296bf91bb07c6510d844deb3ef78f1b7bbed82df5d8b3cd766fa749f1b2b`.

Initial attempts exposed unsupported smoke persistence paths and legacy yauzl stream-close behavior; these were corrected and regression-tested before the passing verifier run. ZIP extraction now aborts/tears down through a single bounded path, with failed evidence retained on incomplete cleanup. The app's restore barrier is distinct from the package smoke and has production-function/native-tar regressions; actual user-driven restore/relaunch remains untested. No client installation, internet-downloaded Gatekeeper acceptance, live inference, commit/push or publication is established.
