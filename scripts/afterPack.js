/**
 * Preserve the exFAT cleanup hook: remove only generated AppleDouble/.DS_Store
 * files before installer creation. Never follow links or silently ignore errors.
 * Note: builder computes ASAR integrity BEFORE afterPack; see MAC_RELEASE.md.
 *
 * Also flips the Electron security fuses on the packaged binary (see SECURITY_AUDIT
 * M8): RunAsNode / NodeOptions / node-cli-inspect off, cookie encryption on, app
 * loads only from ASAR. ASAR *integrity validation* is deliberately NOT enabled
 * here — on macOS/Windows it only enforces against a real code signature, and this
 * project ships unsigned (identity: null). Enable it together with signing.
 */
const fs = require("node:fs");
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function strip(dir, root) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.name.startsWith("._") || entry.name === ".DS_Store") {
      if (entry.isDirectory()) throw new Error(`afterPack: unexpected junk directory: ${file}`);
      fs.unlinkSync(file); // Unlink a link itself, never its target.
      removed++;
    } else if (entry.isSymbolicLink()) {
      if (!inside(root, fs.realpathSync(file))) throw new Error(`afterPack: escaping symlink: ${file}`);
    } else if (entry.isDirectory()) {
      removed += strip(file, root);
    }
  }
  return removed;
}

function electronExecutable(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const product = packager.appInfo.productFilename;
  if (electronPlatformName === "darwin") {
    return path.join(appOutDir, `${product}.app`, "Contents", "MacOS", product);
  }
  if (electronPlatformName === "win32") {
    return path.join(appOutDir, `${product}.exe`);
  }
  if (electronPlatformName === "linux") {
    // electron-builder uses LinuxPackager.executableName on Linux, which may be
    // normalized from productName (for example, XtracsysCode -> xtracsyscode).
    return path.join(appOutDir, packager.executableName);
  }
  throw new Error(`afterPack: unsupported platform for Electron fuses: ${electronPlatformName}`);
}

exports.electronExecutable = electronExecutable;

exports.default = async function afterPack(context) {
  const project = fs.realpathSync(path.join(__dirname, ".."));
  const release = path.join(project, "release");
  if (fs.realpathSync(release) !== release) throw new Error("afterPack: release must not be a symlink");
  const output = fs.realpathSync(context.appOutDir);
  if (output === release || !inside(release, output)) throw new Error("afterPack: output must be inside project release/");
  const n = strip(output, output);
  if (n > 0) console.log(`afterPack: stripped ${n} AppleDouble/.DS_Store junk files from ${output}`);

  const exe = electronExecutable(context);
  if (!fs.existsSync(exe)) throw new Error(`afterPack: electron binary not found for fuses: ${exe}`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    // Run the bundled binary as Node (ELECTRON_RUN_AS_NODE) must not be possible.
    [FuseV1Options.RunAsNode]: false,
    // Encrypt Chromium cookies with the OS credential store.
    [FuseV1Options.EnableCookieEncryption]: true,
    // NODE_OPTIONS / --inspect must not reach the packaged runtime.
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    // The app code loads only from app.asar.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log(`afterPack: security fuses flipped on ${exe}`);

  // flipFuses rewrote the main executable — that invalidates the ad-hoc seal
  // electron-builder applied to the bundle, and on Apple Silicon the kernel SIGKILLs
  // an executable whose signature does not match (silent, no output). Re-seal the
  // bundle ad-hoc after flipping. This is also why the junk strip runs before this:
  // AppleDouble shadows on exFAT make codesign fail on subcomponents.
  if (context.electronPlatformName === "darwin") {
    strip(output, output);
    const appPath = path.join(output, `${context.packager.appInfo.productFilename}.app`);
    const { execFileSync } = require("node:child_process");
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
    console.log(`afterPack: re-sealed ad-hoc signature on ${appPath}`);
  }
};
