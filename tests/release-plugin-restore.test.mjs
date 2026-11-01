import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PluginStore } from "../dist-electron/electron/plugins.js";
import { PLUGIN_SOURCE_LIMITS, pluginSourceIdentity } from "../dist-electron/electron/pluginSource.js";
import { Store, commandApprovalDecision } from "../dist-electron/electron/store.js";
import { McpManager } from "../dist-electron/electron/agent/mcp.js";
import { Storage, DEFAULT_SETTINGS, validateBackupTree, sanitizeBackupForRestore, parseTarVerboseListing, validateBackupMembers, swapDataRoot } from "../dist-electron/electron/storage.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { AgentRunner } from "../dist-electron/electron/runner.js";
import { RestoreRecoveryError } from "../dist-electron/electron/restoreBarrier.js";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const exec = promisify(execFile);

// HOME-scoped even when the OS temp dir points at a shared/system location.
const scratch = path.join(os.homedir(), ".cache/xtracsyscode-sprint");
await fsp.mkdir(scratch, { recursive: true });
assert.equal(await fsp.realpath(scratch), scratch, "fixture scratch must not escape through symlinks");
async function fixture(fn) {
  const dir = await fsp.mkdtemp(path.join(scratch, "plugin-restore-"));
  try { await fn(dir); } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}
async function pluginFixture(dir) {
  const src = path.join(dir, "source");
  await fsp.mkdir(src);
  await fsp.writeFile(path.join(src, "plugin.json"), JSON.stringify({ id: "source-plugin", name: "Source", version: "1", description: "fixture", entry: { command: "node", args: ["server.mjs"] } }));
  await fsp.writeFile(path.join(src, "server.mjs"), "// initial entry\n");
  await fsp.writeFile(path.join(src, "helper.mjs"), "export default 1;\n");
  const store = new PluginStore(new Storage(path.join(dir, "data")));
  const rec = await store.importFrom(src);
  const review = store.launchReview(rec.id);
  await store.markReviewed(rec.id, true, review.token);
  await store.setEnabled(rec.id, true);
  return { src, store, rec, review };
}

test("consent binds entry bytes even when size and timestamp do not change", () => fixture(async dir => {
  const { src, store, rec } = await pluginFixture(dir);
  const entry = path.join(src, "server.mjs");
  const before = await fsp.stat(entry);
  await fsp.writeFile(entry, "// changed entry\n");
  assert.equal((await fsp.stat(entry)).size, before.size);
  await fsp.utimes(entry, before.atime, before.mtime);
  assert.equal(store.hasReviewedLaunch(rec.id), false);
  assert.throws(() => store.launchConfig(rec.id), /review|consent/i);
  assert.deepEqual(store.mcpConfigsFor("project"), []);
  assert.equal(store.list()[0].enabled, false, "UI must expose a safe re-enable/review path after source changes");
}));

test("source helper, hidden config, manifest, additions and deletions invalidate consent; re-review works", () => fixture(async dir => {
  const { src, store, rec } = await pluginFixture(dir);
  for (const [name, contents] of [["helper.mjs", "export default 2;"], [".config", "changed"], ["plugin.json", "{}"]]) {
    const token = store.launchReview(rec.id).token;
    await fsp.writeFile(path.join(src, name), contents);
    assert.equal(store.hasReviewedLaunch(rec.id), false, name);
    await assert.rejects(store.markReviewed(rec.id, true, token), /changed/i);
    await assert.rejects(store.setEnabled(rec.id, true), /review/i);
    const current = store.launchReview(rec.id);
    await store.markReviewed(rec.id, true, current.token);
    assert.equal(store.launchConfig(rec.id).cwd, src);
  }
  await fsp.unlink(path.join(src, "helper.mjs"));
  assert.equal(store.hasReviewedLaunch(rec.id), false);
}));

test("symlinks, hard links and bounded source review fail closed", () => fixture(async dir => {
  const { src, store, rec } = await pluginFixture(dir);
  const link = path.join(src, "alias");
  await fsp.symlink(path.join(src, "helper.mjs"), link);
  assert.equal(store.hasReviewedLaunch(rec.id), false);
  assert.throws(() => store.launchReview(rec.id), /link/i);
  await fsp.unlink(link);
  await fsp.link(path.join(src, "helper.mjs"), link);
  assert.throws(() => store.launchReview(rec.id), /link/i);
  await fsp.unlink(link);
  const huge = await fsp.open(path.join(src, "oversized"), "w");
  await huge.truncate(8 * 1024 * 1024 + 1);
  await huge.close();
  assert.throws(() => store.launchReview(rec.id), /limit/i);
}));

test("entry script outside source tree is not reviewable", () => fixture(async dir => {
  const { store, rec } = await pluginFixture(dir);
  await fsp.writeFile(path.join(dir, "outside.mjs"), "// outside review boundary");
  rec.entry.args = ["../outside.mjs"];
  assert.throws(() => store.launchReview(rec.id), /source|boundary|outside/i);
}));

test("versioned Python and Windows runtime names resolve and check the source entry", () => fixture(async dir => {
  const { store, rec } = await pluginFixture(dir);
  for (const command of ["node.exe", "python3.11", "python3.11.exe"]) {
    rec.entry = { command, args: ["missing.mjs"] };
    assert.throws(() => store.launchReview(rec.id), /entry.*unavailable/i, command);
  }
}));

test("import rejects linked manifests before following them", () => fixture(async dir => {
  const src = path.join(dir, "linked-manifest");
  await fsp.mkdir(src);
  await fsp.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ id: "linked-manifest", name: "linked", description: "fixture", entry: { command: "node", args: [] } }));
  await fsp.symlink(path.join(dir, "manifest.json"), path.join(src, "plugin.json"));
  const store = new PluginStore(new Storage(path.join(dir, "data")));
  await assert.rejects(store.importFrom(src), /link|regular|source/i);
}));


test("review identity follows real source location, not a retargetable alias", () => fixture(async dir => {
  const { src, store, rec } = await pluginFixture(dir);
  const alias = path.join(dir, "alias");
  await fsp.symlink(src, alias);
  rec.sourcePath = alias;
  assert.equal(store.hasReviewedLaunch(rec.id), true, "same real source has same identity");
  const replacement = path.join(dir, "replacement");
  await fsp.cp(src, replacement, { recursive: true });
  await fsp.unlink(alias);
  await fsp.symlink(replacement, alias);
  assert.equal(store.hasReviewedLaunch(rec.id), false, "identical bytes at another cwd require review");
  await fsp.unlink(alias);
  assert.throws(() => store.cwdFor(rec), /unavailable/i);
}));

test("source entry-count, depth and aggregate-byte limits are enforced", () => fixture(async dir => {
  const entries = path.join(dir, "entries");
  await fsp.mkdir(entries);
  for (let i = 0; i <= PLUGIN_SOURCE_LIMITS.maxEntries; i++) await fsp.writeFile(path.join(entries, `file-${i}`), "");
  assert.throws(() => pluginSourceIdentity(entries), /too many entries/i);
  const depth = path.join(dir, "depth");
  await fsp.mkdir(path.join(depth, ...Array(PLUGIN_SOURCE_LIMITS.maxDepth + 1).fill("d")), { recursive: true });
  assert.throws(() => pluginSourceIdentity(depth), /depth/i);
  const bytes = path.join(dir, "bytes");
  await fsp.mkdir(bytes);
  for (let i = 0; i < 5; i++) {
    const fd = await fsp.open(path.join(bytes, `file-${i}`), "w");
    try { await fd.truncate(PLUGIN_SOURCE_LIMITS.maxFileBytes); } finally { await fd.close(); }
  }
  assert.throws(() => pluginSourceIdentity(bytes), /byte limit/i);
}));

const chatId = "8f14e45f-ea5b-4f32-a2b1-9b2c4d6e8f10";
const json = (target, value) => fsp.writeFile(target, JSON.stringify(value));
const readJson = async target => JSON.parse(await fsp.readFile(target, "utf8"));
async function restoreFixture(dir) {
  const payload = path.join(dir, "payload");
  const source = path.join(payload, "Data");
  await fsp.mkdir(path.join(source, "chats"), { recursive: true });
  await fsp.mkdir(path.join(source, "archive"));
  const sentinel = path.join(dir, "EXECUTED");
  const command = process.execPath;
  const args = ["-e", `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')`];
  await json(path.join(source, "settings.json"), { ...DEFAULT_SETTINGS, dataRoot: source, approvalMode: "auto" });
  await json(path.join(source, "projects.json"), [{ id: "project", name: "untrusted", cwd: dir, mcps: [{ name: "injected", command, args }], settings: { approvalMode: "auto" }, rules: { commands: ["*"], writeScopes: ["**"] } }]);
  await json(path.join(source, "tasks.json"), [{ id: "task", name: "scheduled", prompt: "execute", projectId: "project", intervalMinutes: 1, lastRunAt: null, lastStatus: null }]);
  for (const [folder, id] of [["chats", chatId], ["archive", `${chatId}-1700000000000`]]) {
    await json(path.join(source, folder, `${id}.json`), { id: chatId, messages: [], timeline: [], approvalMode: "auto" });
  }
  await json(path.join(source, "plugins.json"), [{ id: "imported-plugin", name: "injected", version: "1", description: "fixture", entry: { command, args }, tools: [], capabilities: [], enabled: true, reviewed: true, reviewedLaunchHash: "untrusted", projectId: null, sourcePath: dir, createdAt: 1, updatedAt: 1 }]);
  const root = path.join(dir, "Data");
  await fsp.mkdir(root);
  await fsp.writeFile(path.join(root, "ORIGINAL"), "old data");
  return { payload, source, root, sentinel };
}
async function nativeArchive(dir, payload) {
  const archive = path.join(dir, "backup.tar.gz");
  await exec("tar", ["-czf", archive, "-C", payload, "Data"], { timeout: 10_000, env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return archive;
}
async function stagedRestore(dir, archive, root, rename) {
  const { stdout } = await exec("tar", ["-tvzf", archive], { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  validateBackupMembers(parseTarVerboseListing(stdout), path.basename(root));
  const staging = path.join(dir, "Data.restore");
  const backup = path.join(dir, "Data.backup");
  await fsp.mkdir(staging);
  try {
    await exec("tar", ["-xzf", archive, "-C", staging, "--strip-components", "1", "--no-same-owner"], { timeout: 10_000 });
    await validateBackupTree(staging);
    await sanitizeBackupForRestore(staging);
    return await swapDataRoot(root, staging, backup, rename);
  } finally { await fsp.rm(staging, { recursive: true, force: true }); }
}

test("native tar staged restore clears every executable consent and retains original backup", () => fixture(async dir => {
  const { payload, root, sentinel } = await restoreFixture(dir);
  const archive = await nativeArchive(dir, payload);
  const backup = await stagedRestore(dir, archive, root);
  assert.equal(await fsp.readFile(path.join(backup, "ORIGINAL"), "utf8"), "old data");
  assert.equal((await readJson(path.join(root, "settings.json"))).approvalMode, "ask");
  const [project] = await readJson(path.join(root, "projects.json"));
  assert.deepEqual(project.mcps, []);
  assert.equal(project.settings.approvalMode, "ask");
  assert.deepEqual(project.rules, { commands: [], writeScopes: [] }, "imported allow-always rules must not bypass Ask");
  assert.equal((await readJson(path.join(root, "tasks.json")))[0].intervalMinutes, null);
  for (const [folder, id] of [["chats", chatId], ["archive", `${chatId}-1700000000000`]]) {
    assert.equal((await readJson(path.join(root, folder, `${id}.json`))).approvalMode, "ask");
  }
  const registry = await readJson(path.join(root, "plugins.json"));
  assert.equal(registry[0].enabled, false);
  assert.equal(registry[0].reviewed, false);
  assert.equal(registry[0].reviewedLaunchHash, undefined);
  const restoredStorage = new Storage(root);
  const restoredStore = new Store(restoredStorage);
  const pluginConfigs = new PluginStore(restoredStorage).mcpConfigsFor("project");
  assert.deepEqual(pluginConfigs, []);
  assert.equal(restoredStore.getChat(chatId).approvalMode, "ask");
  assert.equal(restoredStore.listTasks().some(task => task.intervalMinutes > 0), false);
  assert.equal(commandApprovalDecision(restoredStore.listProjects()[0].rules.commands, "node fixture.mjs"), "ask");
  const mcps = new McpManager();
  try {
    assert.deepEqual(await mcps.start([...restoredStore.listProjects()[0].mcps, ...pluginConfigs], dir), []);
    assert.deepEqual(mcps.listTools(), []);
  } finally { await mcps.stopAll(); }
  assert.equal(fs.existsSync(sentinel), false, "restore must never spawn imported commands");
}));


test("malformed staged documents never replace the active root", () => fixture(async dir => {
  const { payload, source, root } = await restoreFixture(dir);
  for (const [file, value] of [["plugins.json", [{}]], ["tasks.json", [null]], ["projects.json", [null]], ["settings.json", { version: 99 }]]) {
    const target = path.join(source, file);
    const original = await fsp.readFile(target);
    await json(target, value);
    const archive = await nativeArchive(dir, payload);
    await assert.rejects(stagedRestore(dir, archive, root), /schema|validation|invalid/i, file);
    assert.equal(await fsp.readFile(path.join(root, "ORIGINAL"), "utf8"), "old data");
    assert.equal(fs.existsSync(path.join(dir, "Data.restore")), false);
    await fsp.writeFile(target, original);
  }
}));

test("invalid gzip and malformed JSON never replace the active root", () => fixture(async dir => {
  const { payload, source, root } = await restoreFixture(dir);
  const invalid = path.join(dir, "invalid.tar.gz");
  await fsp.writeFile(invalid, "not a gzip archive");
  await assert.rejects(stagedRestore(dir, invalid, root));
  await fsp.writeFile(path.join(source, "settings.json"), "{not json");
  await assert.rejects(stagedRestore(dir, await nativeArchive(dir, payload), root), /JSON|position|property/i);
  assert.equal(await fsp.readFile(path.join(root, "ORIGINAL"), "utf8"), "old data");
  assert.equal(fs.existsSync(path.join(dir, "Data.restore")), false);
}));

test("native tar symlink and hardlink members are rejected without extraction", () => fixture(async dir => {
  const { payload, source, root, sentinel } = await restoreFixture(dir);
  const link = path.join(source, "link");
  await fsp.symlink(root, link);
  await assert.rejects(stagedRestore(dir, await nativeArchive(dir, payload), root), /link|unsafe/i);
  await fsp.unlink(link);
  await fsp.link(path.join(source, "settings.json"), link);
  await assert.rejects(stagedRestore(dir, await nativeArchive(dir, payload), root), /link|unsafe/i);
  assert.equal(fs.existsSync(path.join(dir, "Data.restore")), false);
  assert.equal(fs.existsSync(sentinel), false);
}));

test("rollback after native staged extraction preserves original and cleans staging", () => fixture(async dir => {
  const { payload, root } = await restoreFixture(dir);
  let calls = 0;
  const rename = async (from, to) => {
    if (++calls === 2) throw new Error("injected second rename failure");
    await fsp.rename(from, to);
  };
  await assert.rejects(stagedRestore(dir, await nativeArchive(dir, payload), root, rename), /injected/);
  assert.equal(calls, 3, "rollback rename executed");
  assert.equal(await fsp.readFile(path.join(root, "ORIGINAL"), "utf8"), "old data");
  assert.equal(fs.existsSync(path.join(dir, "Data.restore")), false);
  assert.equal(fs.existsSync(path.join(dir, "Data.backup")), false);
}));

test("restore swap never overwrites a dangling backup symlink", () => fixture(async dir => {
  const root = path.join(dir, "Data");
  const stage = path.join(dir, "Data.restore");
  const backup = path.join(dir, "Data.backup");
  await fsp.mkdir(root);
  await fsp.mkdir(stage);
  await fsp.symlink(path.join(dir, "missing"), backup);
  let renames = 0;
  await assert.rejects(swapDataRoot(root, stage, backup, async (from, to) => { renames++; await fsp.rename(from, to); }));
  assert.equal(renames, 0, "existing link must be rejected before any rename");
  assert.equal((await fsp.lstat(backup)).isSymbolicLink(), true);
}));

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test("control: an ungated native restore is overwritten by a detached old settings writer", () => fixture(async dir => {
  const { payload, root } = await restoreFixture(dir);
  const archive = await nativeArchive(dir, payload);
  const storage = new Storage(root);
  const reached = deferred(), release = deferred();
  const writeFile = fsp.writeFile;
  fsp.writeFile = async (file, ...args) => {
    if (path.dirname(file) === root && path.basename(file).startsWith(".settings.json.")) {
      reached.resolve(); await release.promise;
    }
    return writeFile(file, ...args);
  };
  const oldWrite = storage.saveSettings({ approvalMode: "auto" });
  try {
    await reached.promise;
    // Deliberately omit exclusive admission to reproduce the review finding.
    await stagedRestore(dir, archive, root);
    assert.equal((await readJson(path.join(root, "settings.json"))).approvalMode, "ask");
    release.resolve(); await oldWrite;
    assert.equal((await readJson(path.join(root, "settings.json"))).approvalMode, "auto", "old memory overwrote the sanitized imported document");
  } finally { release.resolve(); await oldWrite; fsp.writeFile = writeFile; }
}));

test("restore refuses an accepted detached settings write before it can overwrite sanitized state", () => fixture(async dir => {
  const { payload, root } = await restoreFixture(dir);
  const archive = await nativeArchive(dir, payload);
  const storage = new Storage(root);
  const reachedRename = deferred();
  const release = deferred();
  const rename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (to === path.join(root, "settings.json")) {
      reachedRename.resolve();
      await release.promise;
    }
    return rename(from, to);
  };
  const acceptedWrite = storage.saveSettings({ approvalMode: "auto" });
  try {
    await reachedRename.promise;
    // Baseline executes the same staged/native path without an admission barrier.
    const restore = () => stagedRestore(dir, archive, root);
    await assert.rejects(storage.restoreBarrier ? storage.restoreBarrier.restore(restore) : restore(), /busy|drain|wait/i);
  } finally {
    release.resolve();
    await acceptedWrite.catch(() => undefined);
    fsp.rename = rename;
  }
  assert.equal((await readJson(path.join(root, "settings.json"))).approvalMode, "auto", "already accepted write must finish, not be dropped");
  assert.equal(await fsp.readFile(path.join(root, "ORIGINAL"), "utf8"), "old data");
}));

test("turn shutdown remains busy after runner status becomes idle and queued turns drain", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const store = new Store(storage);
  const chat = await store.createChat({ projectId: "p", cwd: dir, title: "turn", approvalMode: "ask", model: "fixture" });
  const runner = new AgentRunner(storage, store, { request: async () => false }, () => {});
  const streaming = deferred(), finishStream = deferred(), stopping = deferred(), finishStop = deferred(), idle = deferred();
  let streams = 0, stops = 0;
  runner.makeProvider = () => ({ streamChat: async () => {
    if (++streams === 1) { streaming.resolve(); await finishStream.promise; }
    return { finishReason: "stop" };
  } });
  runner.onIdle = () => idle.resolve();
  const stopAll = McpManager.prototype.stopAll;
  McpManager.prototype.stopAll = async function() {
    if (++stops === 1) { stopping.resolve(); await finishStop.promise; }
    return [];
  };
  const turn = runner.runTurn(chat, "first");
  try {
    await streaming.promise;
    assert.equal(runner.sendOrQueue(chat, "second"), "queued");
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /busy|drain/i);
    finishStream.resolve();
    await stopping.promise;
    assert.equal(runner.isRunning(chat.id), false, "reproduces status-idle / shutdown-still-pending gap");
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /busy|drain/i);
    finishStop.resolve();
    await turn;
    await idle.promise;
    // The detached queue wrapper releases its token in the following microtask.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(streams, 2, "accepted queued work must not be discarded");
    await storage.restoreBarrier.restore(async () => {});
    await assert.rejects(runner.runTurn(chat, "late"), /restore|restart/i);
    assert.throws(() => runner.sendOrQueue(chat, "late"), /restore|restart/i);
  } finally {
    finishStream.resolve(); finishStop.resolve();
    await turn.catch(() => undefined);
    McpManager.prototype.stopAll = stopAll;
  }
}));

test("detached transcript persistence and launch cleanup are restore work even without IPC", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const store = new Store(storage);
  const chat = await store.createChat({ projectId: "p", cwd: dir, title: "write", approvalMode: "ask", model: "" });
  const reached = deferred(), release = deferred();
  const writeFile = fsp.writeFile;
  fsp.writeFile = async (file, ...args) => {
    if (file === storage.chatMd(chat.id)) { reached.resolve(); await release.promise; }
    return writeFile(file, ...args);
  };
  const write = store.writeTranscript(chat, () => "accepted transcript");
  try {
    await reached.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /busy|drain/i);
  } finally { release.resolve(); await write; fsp.writeFile = writeFile; }
  assert.equal(await fsp.readFile(storage.chatMd(chat.id), "utf8"), "accepted transcript");
  const reading = deferred(), finishRead = deferred();
  const readdir = fsp.readdir;
  fsp.readdir = async (dir, ...args) => {
    if (dir === storage.dir("tmp")) { reading.resolve(); await finishRead.promise; }
    return readdir(dir, ...args);
  };
  const cleanup = storage.cleanup();
  try {
    await reading.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /busy|drain/i);
  } finally { finishRead.resolve(); await cleanup; fsp.readdir = readdir; }
}));

async function mainHarness(storage, extra = {}) {
  const main = await fsp.readFile(new URL("../electron/main.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("main.ts", main, ts.ScriptTarget.Latest, true);
  const names = ["handleIpc", "registerIpc", "sessionAdd", "sessionSetActive", "sessionRemoveWindow", "reopenChatWindows", "scheduledBackup", "startScheduler", "runTask", "runTaskNow", "ensureBundledSkills"];
  const functions = names.map(name => {
    const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(node, `integration function ${name} must exist`);
    return node.getText(ast);
  }).join("\n");
  const handlers = new Map(), timers = [];
  const context = {
    storage, store: new Store(storage), fs, fsp, path, randomUUID: () => crypto.randomUUID(), createHash,
    require, console, send: () => {}, notify: () => {}, __dirname: path.dirname(new URL("../electron/main.ts", import.meta.url).pathname),
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    isTrustedIpcSender: () => true, packageSmokeIpc: () => null, packageSmoke: null,
    isValidChatId: id => id === chatId, requireChatId: id => id,
    parseTarVerboseListing, validateBackupMembers, validateBackupTree, sanitizeBackupForRestore, swapDataRoot, RestoreRecoveryError,
    tarBin: () => "tar", skillsDir: s => s.dir("skills"),
    app: { relaunch() {}, exit() {} }, mainWindow: null,
    setInterval: fn => { timers.push(fn); },
    ...extra,
  };
  vm.runInNewContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  context.registerIpc();
  return { context, timers, main, invoke: (channel, ...args) => handlers.get(channel)({}, ...args) };
}

test("actual import IPC excludes a second import, mutable IPC, session/window writes and scheduler until relaunch", () => fixture(async dir => {
  const { payload, root } = await restoreFixture(dir);
  const archive = await nativeArchive(dir, payload);
  const storage = new Storage(root);
  let launches = 0, exits = 0, taskRuns = 0;
  const { context, invoke, timers, main } = await mainHarness(storage, {
    app: { relaunch: () => { launches++; }, exit: () => { exits++; } },
    runner: { runTurn: async () => { taskRuns++; }, isRunning: () => false },
  });
  storage.settings.session = { openChats: [chatId, chatId] };
  const before = JSON.stringify(storage.settings);
  const restoring = invoke("data:import", { archivePath: archive });
  await assert.rejects(Promise.resolve().then(() => invoke("data:import", { archivePath: archive })), /restore|restart/i);
  await assert.rejects(Promise.resolve().then(() => invoke("settings:set", { approvalMode: "auto" })), /restore|restart/i);
  context.sessionRemoveWindow(chatId);
  context.sessionSetActive(chatId);
  context.startScheduler();
  timers[0]();
  await context.scheduledBackup();
  assert.equal(JSON.stringify(storage.settings), before, "native window callbacks must not mutate frozen settings");
  await restoring;
  assert.equal(launches, 1); assert.equal(exits, 1); assert.equal(taskRuns, 0);
  assert.equal(storage.restoreBarrier.blocked, true, "barrier must survive relaunch returning");
  await assert.rejects(storage.saveSettings({ approvalMode: "auto" }), /restore|restart/i);
  assert.equal((await readJson(path.join(root, "settings.json"))).approvalMode, "ask");
  // Integration guard: launch adoption must join the same barrier, not an untracked void promise.
  assert.match(main, /restoreBarrier\.run\("launch skill adoption"/);
}));

test("actual import recovers after validation, swap and relaunch errors only once original root is back", () => fixture(async dir => {
  const { payload, root } = await restoreFixture(dir);
  const archive = await nativeArchive(dir, payload);
  const storage = new Storage(root);
  const { invoke } = await mainHarness(storage, { app: { relaunch() { throw new Error("injected relaunch failure"); }, exit() {} } });
  await assert.rejects(invoke("data:import", { archivePath: path.join(dir, "missing.tar.gz") }), /ENOENT/);
  assert.equal(storage.restoreBarrier.blocked, false);
  const rename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (from.includes(".restore-") && to === root) throw new Error("injected swap failure");
    return rename(from, to);
  };
  try { await assert.rejects(invoke("data:import", { archivePath: archive }), /injected swap/); }
  finally { fsp.rename = rename; }
  assert.equal(storage.restoreBarrier.blocked, false);
  assert.equal(await fsp.readFile(path.join(root, "ORIGINAL"), "utf8"), "old data");
  await assert.rejects(invoke("data:import", { archivePath: archive }), /injected relaunch/);
  assert.equal(storage.restoreBarrier.blocked, false);
  assert.equal(await fsp.readFile(path.join(root, "ORIGINAL"), "utf8"), "old data");
  await storage.saveSettings({ approvalMode: "ask" });
}));

test("unconfirmed rollback stays frozen even when staging cleanup also fails", () => fixture(async dir => {
  const { payload, root } = await restoreFixture(dir);
  const archive = await nativeArchive(dir, payload);
  const storage = new Storage(root);
  const cleanupErrors = [];
  const { invoke } = await mainHarness(storage, { console: { error: message => cleanupErrors.push(message) } });
  const rename = fsp.rename, rm = fsp.rm;
  fsp.rename = async (from, to) => {
    if (to === root) throw new Error("injected replacement/rollback failure");
    return rename(from, to);
  };
  fsp.rm = async (target, options) => {
    if (target.startsWith(`${root}.restore-`)) throw new Error("injected cleanup failure");
    return rm(target, options);
  };
  try {
    await assert.rejects(invoke("data:import", { archivePath: archive }), /rollback failed/i);
    assert.equal(storage.restoreBarrier.blocked, true);
    await assert.rejects(storage.saveSettings(), /restore|restart/i);
    assert.match(cleanupErrors[0], /staging cleanup failed.*injected cleanup failure/i);
  } finally { fsp.rename = rename; fsp.rm = rm; }
}));

test("unconfirmed MCP shutdown prevents restore after a turn promise settles", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const store = new Store(storage);
  const chat = await store.createChat({ projectId: "p", cwd: dir, title: "shutdown", approvalMode: "ask", model: "fixture" });
  const runner = new AgentRunner(storage, store, { request: async () => false }, () => {});
  runner.makeProvider = () => ({ streamChat: async () => ({ finishReason: "stop" }) });
  const stopAll = McpManager.prototype.stopAll;
  McpManager.prototype.stopAll = async () => ["fixture process termination unconfirmed"];
  try { await runner.runTurn(chat, "first"); }
  finally { McpManager.prototype.stopAll = stopAll; }
  await assert.rejects(storage.restoreBarrier.restore(async () => {}), /shutdown|termination|cleanup/i);
}));

test("whole IPC awaits before its first write are counted and accepted writes finish", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const { context, invoke } = await mainHarness(storage);
  const entered = deferred(), finish = deferred();
  context.handleIpc("test:pending-dialog", async () => {
    entered.resolve(); await finish.promise;
    await storage.saveSettings({ model: "accepted-before-restore" });
  });
  const work = invoke("test:pending-dialog");
  try {
    await entered.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /IPC test:pending-dialog/);
  } finally { finish.resolve(); await work; }
  assert.equal((await readJson(path.join(storage.root, "settings.json"))).model, "accepted-before-restore");
}));

test("scheduled backup stays busy through tar, pruning and final settings persistence", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const { context } = await mainHarness(storage);
  storage.settings.backups = { daily: true, keep: 2 };
  const tar = deferred(), finishTar = deferred(), pruning = deferred(), finishPruning = deferred();
  context.backupNow = async () => { tar.resolve(); await finishTar.promise; };
  context.pruneBackups = async () => { pruning.resolve(); await finishPruning.promise; };
  const backup = context.scheduledBackup();
  try {
    await tar.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /scheduled backup/);
    finishTar.resolve(); await pruning.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /scheduled backup/);
  } finally { finishTar.resolve(); finishPruning.resolve(); await backup; }
  assert.equal(typeof (await readJson(path.join(storage.root, "settings.json"))).backups.lastRun, "number");
}));

test("scheduled task remains busy through post-turn persistence and launch adoption is counted", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const { context } = await mainHarness(storage, { runner: { isRunning: () => false, runTurn: async () => "done", notice: () => {} } });
  await context.store.createChat({ projectId: "p", cwd: dir, title: "task", approvalMode: "ask", model: "" });
  const saving = deferred(), finishSaving = deferred();
  const saveTask = context.store.saveTask.bind(context.store);
  context.store.saveTask = async task => { saving.resolve(); await finishSaving.promise; return saveTask(task); };
  const task = context.runTask({ id: "t", projectId: "p", name: "task", prompt: "fixture", lastRunAt: null, lastStatus: null, intervalMinutes: 1 });
  try {
    await saving.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /task execution/);
  } finally { finishSaving.resolve(); await task; }
  assert.equal((await readJson(path.join(storage.root, "tasks.json")))[0].lastStatus, "ok");

  const adoption = deferred(), finishAdoption = deferred(), saved = deferred();
  context.app.isPackaged = true;
  context.process = { resourcesPath: dir };
  context.skillStore = { adoptUnregistered: async () => {
    adoption.resolve(); await finishAdoption.promise;
    await storage.saveDoc("skills.json", []);
    saved.resolve(); return { adopted: [], invalid: [] };
  } };
  context.ensureBundledSkills();
  try {
    await adoption.promise;
    await assert.rejects(storage.restoreBarrier.restore(async () => {}), /launch skill adoption/);
  } finally { finishAdoption.resolve(); await saved.promise; }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await readJson(path.join(storage.root, "skills.json")), []);
  await storage.restoreBarrier.restore(async () => {});
}));

test("command timeout cannot admit restore while child termination is unconfirmed", () => fixture(async dir => {
  const storage = new Storage(path.join(dir, "Data"));
  const store = new Store(storage);
  const chat = await store.createChat({ projectId: "p", cwd: dir, title: "timeout", approvalMode: "auto", model: "fixture" });
  const tools = require("../dist-electron/electron/agent/tools.js");
  const defaultTools = tools.defaultTools;
  tools.defaultTools = () => [{ spec: { name: "run_command", description: "fixture", parameters: {} }, readOnly: false, execute: async () => ({ ok: false, output: "fixture timed out\n[exit code: 124]" }) }];
  const runner = new AgentRunner(storage, store, { request: async () => false }, () => {});
  let call = 0;
  runner.makeProvider = () => ({ streamChat: async (_request, callbacks) => {
    if (++call === 1) callbacks.onToolCall({ id: "timeout", name: "run_command", args: { command: "fixture" } });
    return { finishReason: "stop" };
  } });
  try { await runner.runTurn(chat, "fixture"); }
  finally { tools.defaultTools = defaultTools; }
  await assert.rejects(storage.restoreBarrier.restore(async () => {}), /command|termination|cleanup/i);
}));

test("sanitization rejects a linked staging root without changing its target", () => fixture(async dir => {
  const { source } = await restoreFixture(dir);
  const link = path.join(dir, "linked-stage");
  await fsp.symlink(source, link);
  await assert.rejects(sanitizeBackupForRestore(link), /plain|link|directory/i);
  assert.equal((await readJson(path.join(source, "settings.json"))).approvalMode, "auto");
}));
