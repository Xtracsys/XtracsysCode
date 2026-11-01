/**
 * Deterministic plugin-system tests (v5 R6): manifest validation, disabled-by-default,
 * review gating, scoping, removal, and a REAL stdio MCP roundtrip with the bundled
 * example plugin. Plain Node, temp data root, no network.
 * Run: node tests/plugins.test.mjs   (requires `npm run build:main` first)
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Storage } from "../dist-electron/electron/storage.js";
import { PluginStore, PluginError } from "../dist-electron/electron/plugins.js";
import { McpManager } from "../dist-electron/electron/agent/mcp.js";

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) passed++;
  else {
    failures.push(label);
    console.error("FAIL:", label);
  }
}
async function throws(fn, label) {
  try {
    await fn();
    failures.push(label + " (did not throw)");
    console.error("FAIL:", label, "(did not throw)");
  } catch (e) {
    ok(e instanceof PluginError || e instanceof Error, label);
  }
}

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const storage = new Storage(fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugins-test-")));
const store = new PluginStore(storage);

// --- import the real first-party example plugin ---
const exampleSrc = path.join(repoRoot, "plugins", "example-text-formatter");
ok(fs.existsSync(path.join(exampleSrc, "plugin.json")), "fixture: example plugin exists");
const rec = await store.importFrom(exampleSrc);
ok(rec.enabled === false, "import: plugin starts DISABLED");
ok(rec.reviewed === false, "import: plugin unreviewed");
ok(rec.sourcePath === exampleSrc, "import: source path recorded");
ok(fs.existsSync(path.join(storage.root, "plugins", "example-text-formatter", "plugin.json")), "import: manifest copied to app store");

// --- validation rejections ---
const bad1 = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugin-bad1-"));
await throws(() => store.importFrom(bad1), "import: folder without plugin.json rejected");

const bad2 = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugin-bad2-"));
fs.writeFileSync(path.join(bad2, "plugin.json"), JSON.stringify({ id: "x", name: "No Description" }));
await throws(() => store.importFrom(bad2), "manifest: missing description rejected");

const bad3 = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugin-bad3-"));
fs.writeFileSync(
  path.join(bad3, "plugin.json"),
  JSON.stringify({ id: "Bad ID!", name: "X", description: "d", entry: { command: "node", args: [] } }),
);
await throws(() => store.importFrom(bad3), "manifest: invalid id rejected");

const bad4 = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugin-bad4-"));
fs.writeFileSync(
  path.join(bad4, "plugin.json"),
  JSON.stringify({ id: "remote-plugin", name: "X", description: "d", entry: { command: "https://evil.example/x", args: [] } }),
);
await throws(() => store.importFrom(bad4), "manifest: remote-source command rejected");

const bad5 = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugin-bad5-"));
fs.writeFileSync(path.join(bad5, "plugin.json"), "{ not json");
await throws(() => store.importFrom(bad5), "manifest: malformed JSON rejected");

// --- enable gating and consent-bound launch identity ---
await throws(() => store.setEnabled(rec.id, true), "enable: refused before review");
await throws(() => store.markReviewed(rec.id, false, ""), "review: explicit consent required");
await throws(() => store.launchConfig(rec.id), "launch: unreviewed plugin cannot resolve for execution");
const review = store.launchReview(rec.id);
const reviewed = await store.markReviewed(rec.id, true, review.token);
ok(reviewed.reviewed && store.hasReviewedLaunch(rec.id), "review: consent binds a valid reviewed launch");
const launch = store.launchConfig(rec.id);
const conflictingProject = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-plugin-project-cwd-"));
fs.writeFileSync(path.join(conflictingProject, "server.mjs"), "process.exit(99);\n");
ok(launch.cwd === store.cwdFor(rec) && fs.realpathSync(launch.cwd) === launch.cwd && launch.args[0] === fs.realpathSync(path.join(exampleSrc, "server.mjs")), "launch: reviewed command and script resolve to source cwd");
const originalCommand = rec.entry.command;
const staleReviewToken = store.launchReview(rec.id).token;
rec.entry.command = `${originalCommand}-tampered`;
ok(!store.hasReviewedLaunch(rec.id), "review: command mutation invalidates prior consent");
await throws(() => store.launchConfig(rec.id), "launch: changed command blocked pending review");
await throws(() => store.markReviewed(rec.id, true, staleReviewToken), "review: launch changes during consent require a new review");
rec.entry.command = originalCommand;
ok(store.hasReviewedLaunch(rec.id), "review: restoring exact command restores matching consent");
const enabled = await store.setEnabled(rec.id, true);
ok(enabled.enabled === true && enabled.reviewed === true, "enable: works after exact launch review");

// --- transport roundtrip: REAL spawn, initialize, tools/list, tools/call, stop ---
const mcps = new McpManager();
const errors = await mcps.start([launch], conflictingProject);
ok(errors.length === 0, "roundtrip: server starts cleanly" + (errors[0] ? ` (${errors[0]})` : ""));
const tools = mcps.listTools();
ok(tools.some((t) => t.name === "slugify") && tools.some((t) => t.name === "upper"), "roundtrip: declared tools discovered");
const call = await mcps.callTool(rec.id, "slugify", { text: "Hello Plugin World" });
ok(call.ok && call.output === "hello-plugin-world", "roundtrip: tools/call returns formatted text (" + call.output + ")");
await mcps.stopAll();
await fsp.rm(conflictingProject, { recursive: true, force: true });

// disabled plugins contribute no configs
await store.setEnabled(rec.id, false);
ok(store.mcpConfigsFor("any-project").length === 0, "disabled: contributes no MCP configs");
await store.setEnabled(rec.id, true);
const runtimeConfigs = store.mcpConfigsFor("any-project");
ok(runtimeConfigs.length === 1 && JSON.stringify(runtimeConfigs[0]) === JSON.stringify(launch), "runtime: same reviewed command, args, and cwd used for plugin test and agent runs");

// --- scoping ---
await store.setScope(rec.id, "proj-9");
ok(store.mcpConfigsFor("other").length === 0, "scope: other projects excluded");
ok(store.mcpConfigsFor("proj-9").length === 1, "scope: matching project included");
await store.setScope(rec.id, null);

// --- removal keeps the original source ---
await store.remove(rec.id);
ok(!fs.existsSync(path.join(storage.root, "plugins", "example-text-formatter")), "remove: app-managed manifest deleted");
ok(fs.existsSync(path.join(exampleSrc, "plugin.json")), "remove: original plugin folder untouched");

console.log(`\nplugins.test: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
