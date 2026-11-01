#!/usr/bin/env node
/** Reviewed coordinator entry point; no builds, downloads, installs, or real user data. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { extractZip as extractZipSafely, inside, forbidden, zipName, linkTarget } from './release-zip.mjs';

// The project is wherever this script's parent directory is — the location assertion
// below still pins the script to a real checkout root (no symlink redirection).
const PROJECT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRATCH_PARENT = path.join(os.homedir(), '.cache');
const SCRATCH = path.join(SCRATCH_PARENT, 'xtracsyscode-sprint');
const MARKER = 'XTRAC_PACKAGE_SMOKE_OK';
const MAX_ENTRIES = 20000;
const MAX_BYTES = 2 * 1024 ** 3;
const deadline = Date.now() + 12 * 60_000;
const active = new Set();
const zipCancellation = new AbortController();
let zipExtractionActive = false;
let interrupted = false;
const report = { startedAt: new Date().toISOString(), passed: false, signedReleaseReady: false, commands: [], bundles: [] };

function checkTime() {
  assert(!interrupted, 'verification interrupted');
  assert(Date.now() < deadline, '12-minute verification deadline exceeded');
}
// Pure regression cases run before any artifacts or subprocesses are touched.
function selfTests() {
  assert(inside('/a/b', '/a/b/c'));
  assert(!inside('/a/b', '/a/bad'));
  assert(!inside('/a/b', '/a/c'));
  assert.equal(zipName('XtracsysCode.app/Contents/'), 'XtracsysCode.app/Contents');
  for (const n of ['/etc/passwd', '../XtracsysCode.app', 'XtracsysCode.app/../bad', 'XtracsysCode.app/._app.asar', 'XtracsysCode.app/.env', 'XtracsysCode.app/a\\b']) assert.throws(() => zipName(n));
  assert.equal(linkTarget('XtracsysCode.app/F/Current', 'A'), 'XtracsysCode.app/F/A');
  assert.throws(() => linkTarget('XtracsysCode.app/a', '../../escape'));
  assert.throws(() => linkTarget('XtracsysCode.app/a', '/Applications'));
}
selfTests();
assert.equal(process.platform, 'darwin', 'macOS only');
assert.equal(process.arch, 'arm64', 'arm64 host required for this launch check');
assert.equal(path.resolve(fileURLToPath(new URL('..', import.meta.url))), PROJECT, 'unexpected script location');
assert.equal(fs.realpathSync(PROJECT), PROJECT, 'project must not redirect through a symlink');
const release = path.join(PROJECT, 'release');
assert.equal(fs.realpathSync(release), release, 'release must not be a symlink');
// Do not trust a launcher to preserve TMPDIR: select the approved home scratch
// explicitly before any subprocess or temporary fixture is created.
if (!fs.existsSync(SCRATCH_PARENT)) fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
const inheritedTmp = SCRATCH_PARENT;
assert.equal(fs.realpathSync(inheritedTmp), inheritedTmp, 'home scratch must not redirect');
process.env.TMPDIR = inheritedTmp;
// Check existing ancestors before creating the sprint scratch directory.
assert.equal(fs.realpathSync(path.dirname(SCRATCH)), path.dirname(SCRATCH));
if (!fs.existsSync(SCRATCH)) fs.mkdirSync(SCRATCH);
assert.equal(fs.realpathSync(SCRATCH), SCRATCH);
const work = fs.mkdtempSync(path.join(SCRATCH, 'mac-verify-'));
const home = path.join(work, 'home');
const tmp = path.join(work, 'tmp');
for (const dir of [home, tmp]) fs.mkdirSync(dir);
const nativeEnv = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, CFFIXED_USER_HOME: home, TMPDIR: inheritedTmp, LANG: 'en_US.UTF-8' };
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const yauzl = require('yauzl'); // Existing electron-builder dependency, never installed here.
let mounted = false;
let safeToRemove = true;
const mountpoint = path.join(work, 'dmg');

function kill(child, signal, group) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
  try { group ? process.kill(-child.pid, signal) : child.kill(signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  zipCancellation.abort(new Error(`verification interrupted: ${signal}`));
  for (const item of active) kill(item.child, 'SIGTERM', item.group);
});

async function run(exe, args, { timeout = 60_000, expectedFailure = false, smoke = false, cleanup = false } = {}) {
  if (!cleanup) checkTime();
  const env = smoke ? { ...nativeEnv, HOME: home, TMPDIR: `${tmp}/`, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local/share'), XTRAC_PACKAGE_SMOKE: '1', XTRAC_PACKAGE_SMOKE_ROOT: work } : nativeEnv;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const item = { child, group: true };
    active.add(item);
    let output = 0, stdout = '', stderr = '', failure;
    let hardTimer;
    const stop = reason => {
      failure ??= reason;
      kill(child, 'SIGTERM', true);
      hardTimer ??= setTimeout(() => kill(child, 'SIGKILL', true), 1500);
    };
    const timer = setTimeout(() => stop('timeout'), cleanup ? timeout : Math.min(timeout, Math.max(1, deadline - Date.now())));
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      output += chunk.length;
      if (output > 1024 ** 2) { stop('output limit'); return; }
      if (key === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    });
    child.on('error', error => { failure = error.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(hardTimer); active.delete(item);
      // Descendants remain in this freshly spawned private group, never a user's app.
      kill(child, 'SIGTERM', true); kill(child, 'SIGKILL', true);
      const record = { tool: path.basename(exe), args, code, signal, failure, stdout: stdout.trim(), stderr: stderr.trim() };
      report.commands.push(record);
      if (failure || signal || (code !== 0 && !expectedFailure)) reject(new Error(`${record.tool}: ${failure || signal || `exit ${code}`}\n${stderr.slice(-2000)}`));
      else resolve(record);
    });
  });
  return result;
}
function realFile(file, base = release) {
  assert(inside(base, file) && fs.realpathSync(file) === file, `redirected file: ${file}`);
  assert(fs.statSync(file).isFile(), `not a file: ${file}`);
  return file;
}
async function hash(file) {
  checkTime();
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) { checkTime(); h.update(chunk); }
  return h.digest('hex');
}
function readSmall(file, base, max = 16 * 1024 ** 2) {
  realFile(file, base);
  assert(fs.statSync(file).size <= max, 'input exceeds bounded read');
  return fs.readFileSync(file);
}
function walk(root, source = false) {
  assert.equal(fs.realpathSync(root), root, 'redirected tree root');
  const result = [];
  let bytes = 0;
  const visit = dir => {
    checkTime();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Ignore source-volume metadata only; packaged payloads must contain none.
      if (source && (entry.name.startsWith('._') || entry.name === '.DS_Store')) continue;
      const file = path.join(dir, entry.name);
      const name = path.relative(root, file).split(path.sep).join('/');
      assert(result.length < MAX_ENTRIES, 'bundle entry limit');
      assert(!forbidden(name), `private/AppleDouble bundle path: ${name}`);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        assert(inside(root, fs.realpathSync(file)), `escaping/dangling bundle link: ${name}`);
        result.push({ name, link: fs.readlinkSync(file) });
      } else if (stat.isDirectory()) { result.push({ name, directory: true }); visit(file); }
      else {
        assert(stat.isFile(), 'unexpected bundle file type');
        bytes += stat.size;
        assert(bytes <= MAX_BYTES, 'bundle size limit');
        result.push({ name, file });
      }
    }
  };
  visit(root);
  return result;
}
async function bundleManifest(root, source = false) {
  const entries = walk(root, source);
  const manifest = {};
  for (const item of entries) {
    if (item.file) manifest[item.name] = await hash(item.file);
    else manifest[item.name] = item.directory ? 'directory' : `symlink:${item.link}`;
  }
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
}
async function extractZip(zip, dest) {
  checkTime();
  zipExtractionActive = true;
  try {
    await extractZipSafely(zip, dest, {
      openZip: (...args) => yauzl.open(...args), checkTime,
      onProgress: progress => { report.zipProgress = progress; },
      signal: zipCancellation.signal,
      timeoutMs: Math.min(60_000, Math.max(1, deadline - Date.now())),
      maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES,
    });
    zipExtractionActive = false;
  } catch (error) {
    // The helper has awaited stream/archive teardown, or explicitly flagged a
    // broken native close / uninterruptible pending open. Never delete that path.
    report.zipTeardownIncomplete = Boolean(error.teardownIncomplete);
    if (!error.teardownIncomplete) zipExtractionActive = false;
    throw error;
  }
}
async function inspectBundle(bundle, label, version) {
  assert.equal(fs.realpathSync(bundle), bundle, 'bundle root is a link');
  const manifest = await bundleManifest(bundle); // Confinement before reading any bundle paths.
  const contents = path.join(bundle, 'Contents');
  const info = JSON.parse((await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')])).stdout);
  assert.equal(info.CFBundleIdentifier, 'com.xtracsys.code');
  assert.equal(info.CFBundleShortVersionString, version);
  assert.equal(info.CFBundleName, 'XtracsysCode');
  assert.equal(info.CFBundleExecutable, 'XtracsysCode');
  assert.equal(info.LSApplicationCategoryType, 'public.app-category.developer-tools');
  assert(info.CFBundleIconFile && path.basename(info.CFBundleIconFile) === info.CFBundleIconFile, 'missing/unsafe bundle icon');
  const iconName = info.CFBundleIconFile.endsWith('.icns') ? info.CFBundleIconFile : `${info.CFBundleIconFile}.icns`;
  const resources = path.join(contents, 'Resources');
  assert.equal(await hash(realFile(path.join(resources, iconName), bundle)), await hash(realFile(path.join(PROJECT, 'build/icon.icns'), PROJECT)), 'branding changed');
  for (const binary of [path.join(contents, 'MacOS', info.CFBundleExecutable), path.join(contents, 'Frameworks/Electron Framework.framework/Versions/A/Electron Framework')]) {
    const description = (await run('/usr/bin/file', ['-b', binary])).stdout;
    assert(/Mach-O/.test(description) && /arm64/.test(description) && !/x86_64/.test(description), 'not a thin arm64 Mach-O');
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.equal(await hash(realFile(path.join(resources, name), bundle)), await hash(realFile(path.join(PROJECT, name), PROJECT)), `missing/stale ${name}`);
  }
  for (const [target, source] of [['LICENSE.electron.txt', 'node_modules/electron/dist/LICENSE'], ['LICENSES.chromium.html', 'node_modules/electron/dist/LICENSES.chromium.html']]) {
    assert.equal(await hash(realFile(path.join(resources, target), bundle)), await hash(realFile(path.join(PROJECT, source), PROJECT)), `missing/stale runtime notice: ${target}`);
  }
  const archive = realFile(path.join(resources, 'app.asar'), bundle);
  const archiveSize = fs.statSync(archive).size;
  assert(archiveSize <= 128 * 1024 ** 2 && archiveSize >= 16, 'ASAR size limit');
  const prefix = Buffer.alloc(8), fd = fs.openSync(archive, 'r');
  try { assert.equal(fs.readSync(fd, prefix, 0, 8, 0), 8); } finally { fs.closeSync(fd); }
  assert.equal(prefix.readUInt32LE(0), 4, 'invalid ASAR size pickle');
  assert(prefix.readUInt32LE(4) <= 16 * 1024 ** 2 && prefix.readUInt32LE(4) <= archiveSize - 8, 'ASAR header limit');
  const asarRead = name => {
    const item = asar.statFile(archive, name, false);
    assert(!item.link && !item.files && !item.unpacked && Number.isSafeInteger(item.size) && item.size <= 16 * 1024 ** 2, 'unsafe/oversize ASAR read');
    return asar.extractFile(archive, name, false);
  };
  const names = asar.listPackage(archive).map(n => n.replace(/^\//, ''));
  assert(names.length <= MAX_ENTRIES);
  for (const name of names) {
    assert(name && !name.includes('\\') && !/[\x00-\x1f\x7f]/.test(name) && name.split('/').every(p => p && p !== '.' && p !== '..'), 'unsafe ASAR path');
    assert(!asar.statFile(archive, name, false).link, 'unexpected ASAR link');
    assert(!forbidden(name) && !name.endsWith('.map'), `unwanted ASAR entry: ${name}`);
    assert(['dist-electron', 'dist-web', 'package.json', 'node_modules', 'LICENSE', 'LICENSE.md', 'LICENSE.txt'].includes(name.split('/')[0]), `unapproved ASAR root: ${name}`);
  }
  const packaged = JSON.parse(asarRead('package.json').toString());
  assert.equal(packaged.version, version);
  assert.equal(packaged.main, 'dist-electron/electron/main.js');
  assert.deepEqual(asarRead('node_modules/marked/LICENSE.md'), readSmall(path.join(PROJECT, 'node_modules/marked/LICENSE.md'), PROJECT), 'marked license missing/stale');
  const main = asarRead(packaged.main).toString();
  assert(main.includes('XTRAC_PACKAGE_SMOKE') && main.includes(MARKER), 'coordinator smoke hook missing; refuse unsafe launch');
  // Confirm all current compiled files/renderer assets, not just an old same-version app.
  for (const dir of ['dist-electron', 'dist-web']) {
    for (const entry of walk(path.join(PROJECT, dir), true)) {
      if (!entry.file || entry.name.endsWith('.map')) continue;
      assert.deepEqual(asarRead(`${dir}/${entry.name}`), readSmall(entry.file, PROJECT), `stale packaged ${dir}/${entry.name}`);
    }
  }
  const expectedSkills = await bundleManifest(path.join(PROJECT, 'bundled-skills'), true);
  assert(Object.keys(expectedSkills).some(n => n.endsWith('/SKILL.md')), 'no bundled skills');
  assert.deepEqual(await bundleManifest(path.join(resources, 'bundled-skills')), expectedSkills, 'missing/stale bundled skills');
  const signing = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], { expectedFailure: true });
  const identity = await run('/usr/bin/codesign', ['--display', '--verbose=4', bundle], { expectedFailure: true });
  const gatekeeper = await run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', bundle], { expectedFailure: true });
  report.bundles.push({ label, info, signingExit: signing.code, signingDetail: identity.stderr, gatekeeperExit: gatekeeper.code, fileCount: Object.keys(manifest).length });
  return manifest;
}
function outputFile(name, data) {
  const file = path.join(release, name);
  if (fs.existsSync(file)) realFile(file);
  fs.writeFileSync(file, data, { flag: 'w' });
}
try {
  const pkg = JSON.parse(readSmall(path.join(PROJECT, 'package.json'), PROJECT));
  assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version), 'unsafe version');
  const dmg = realFile(path.join(release, `XtracsysCode-${pkg.version}-arm64.dmg`));
  const zip = realFile(path.join(release, `XtracsysCode-${pkg.version}-arm64-mac.zip`));
  const app = path.join(release, 'mac-arm64/XtracsysCode.app');
  // Record exact artifact identity up front and again at the end to detect mutation.
  const hashes = new Map();
  for (const artifact of [dmg, zip]) hashes.set(artifact, await hash(artifact));
  await run('/usr/bin/hdiutil', ['verify', dmg], { timeout: 120_000 });
  await run('/usr/bin/unzip', ['-tq', zip], { timeout: 120_000 });
  const baseline = await inspectBundle(app, 'unpacked', pkg.version);
  const unzipRoot = path.join(work, 'zip'); fs.mkdirSync(unzipRoot);
  await extractZip(zip, unzipRoot);
  assert.deepEqual(await inspectBundle(path.join(unzipRoot, 'XtracsysCode.app'), 'zip', pkg.version), baseline, 'ZIP app differs from unpacked app');
  fs.mkdirSync(mountpoint);
  // A failed attach may still mount; always attempt detach once attach begins.
  mounted = true;
  await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountpoint, dmg], { timeout: 90_000 });
  assert.deepEqual(await inspectBundle(path.join(mountpoint, 'XtracsysCode.app'), 'dmg', pkg.version), baseline, 'DMG app differs from unpacked app');
  await run('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 30_000 }); mounted = false;
  // Launch the extracted ZIP payload directly, never open/LaunchServices or /Applications.
  const executable = path.join(unzipRoot, 'XtracsysCode.app/Contents/MacOS/XtracsysCode');
  const smoke = await run(executable, [`--user-data-dir=${path.join(work, 'user-data')}`, '--disable-background-networking', '--disable-component-update'], { timeout: 30_000, smoke: true });
  assert(smoke.stdout.split(/\r?\n/).includes(MARKER), 'missing renderer-ready/quit marker');
  for (const [artifact, digest] of hashes) assert.equal(await hash(artifact), digest, 'artifact changed during verification');
  report.artifacts = [...hashes].map(([file, sha256]) => ({ file: path.basename(file), bytes: fs.statSync(file).size, sha256 }));
  report.smoke = { marker: MARKER, exit: smoke.code, isolated: true, timeoutMs: 30_000 };
  report.limitations = ['Unsigned/unnotarized configuration (identity:null, hardenedRuntime:false).', 'Direct isolated launch is not Gatekeeper acceptance of an internet-downloaded quarantined app.', 'No inference, model download, real settings, or installation tested.', 'The package smoke launch runs the artifact binary on this host with the operator\'s privileges (environment-isolated, not a VM) — run the verifier on a disposable machine for untrusted artifacts.'];
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  if (mounted) {
    try { await run('/usr/bin/hdiutil', ['detach', mountpoint], { timeout: 30_000, cleanup: true }); mounted = false; }
    catch (error) { report.cleanupError = String(error); report.passed = false; process.exitCode = 1; safeToRemove = false; }
  }
  if (active.size || zipExtractionActive || mounted) { safeToRemove = false; report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  if (report.passed) {
    outputFile('SHA256SUMS.txt', report.artifacts.map(a => `${a.sha256}  ${a.file}\n`).join(''));
    outputFile('mac-verification.json', `${JSON.stringify(report, null, 2)}\n`);
  }
  // Failure evidence stays in the private disposable scratch directory, not a success report.
  fs.writeFileSync(path.join(work, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, signedReleaseReady: false, error: report.error, cleanupError: report.cleanupError, evidence: report.passed ? path.join(release, 'mac-verification.json') : path.join(work, 'verification.json'), artifacts: report.artifacts }, null, 2));
  if (report.passed && safeToRemove && fs.realpathSync(work) === work && inside(SCRATCH, work) && path.basename(work).startsWith('mac-verify-')) fs.rmSync(work, { recursive: true, force: true });
}
