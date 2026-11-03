import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { electronExecutable } = require("../scripts/afterPack.js");

assert.equal(typeof electronExecutable, "function", "afterPack exposes its executable resolver");

const appOutDir = path.resolve("release", "linux-unpacked");
assert.equal(
  electronExecutable({
    appOutDir,
    electronPlatformName: "linux",
    packager: { appInfo: { productFilename: "XtracsysCode" }, executableName: "xtracsyscode" },
  }),
  path.join(appOutDir, "xtracsyscode"),
  "Linux fuses target the electron-builder executableName",
);

assert.equal(
  electronExecutable({
    appOutDir,
    electronPlatformName: "win32",
    packager: { appInfo: { productFilename: "XtracsysCode" }, executableName: "xtracsyscode" },
  }),
  path.join(appOutDir, "XtracsysCode.exe"),
  "Windows fuses target the product executable",
);

console.log("after-pack: executable paths passed");
