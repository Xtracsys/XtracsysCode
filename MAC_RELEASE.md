# macOS build and verification

XtracsysCode ships an arm64 DMG and ZIP. Published downloads and checksums are
available from [GitHub Releases](https://github.com/Xtracsys/XtracsysCode/releases/latest).
The macOS app is ad-hoc signed and is not notarized. A checksum confirms file
integrity; it does not establish Developer ID authentication or Gatekeeper acceptance.

## Build from source

Use the Node version and dependency setup in CONTRIBUTING.md. From a clean checkout:

```sh
npm ci
npm run typecheck
npm test
npm run dist
```

`npm run dist:dir` creates the unpacked app. `npm run dist` creates the DMG and ZIP
under `release/`. The packaging hook strips AppleDouble files, configures Electron
fuses, and re-seals the macOS app with an ad-hoc signature. ASAR integrity validation
is disabled until a supported signed-release configuration is introduced.

## Verify an exact build

Review `scripts/release-verify.mjs` before running it on a trusted local build:

```sh
node scripts/release-verify.mjs
```

The verifier checks archive structure, notices, architecture, bundled resources,
compiled-source freshness, and matching app payloads. It launches the ZIP's app in
a disposable data root, checks renderer/preload initialization, and requires normal
exit. It does not run live inference or use existing user data. Native subprocesses,
archive sizes and execution time are bounded.

A successful run writes `release/mac-verification.json` and `release/SHA256SUMS.txt`
for those exact files. Old receipts do not validate a later build: compare hashes.
Signing and Gatekeeper results are reported separately from the package smoke test.
The verifier is intended for macOS arm64. Windows/Linux acceptance is described in
VERIFY_PLATFORM.md.
