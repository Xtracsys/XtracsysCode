/**
 * Deterministic skills-system tests (v5 R3). Plain Node, no test framework, no network.
 * Everything runs in a disposable temp data root — the real ~/XtracsysCode is never touched.
 * Run: node tests/skills.test.mjs   (requires `npm run build:main` first)
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Storage } from "../dist-electron/electron/storage.js";
import { SkillStore, SkillError, SKILLS_LIMITS, validateSkillMd } from "../dist-electron/electron/skills.js";

let passed = 0;
const failures = [];
function ok(cond, label) {
  if (cond) {
    passed++;
  } else {
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
    ok(e instanceof SkillError || e instanceof Error, label);
  }
}

const storage = new Storage(fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-skills-test-")));
const store = new SkillStore(storage);

// --- frontmatter validation ---
const GOOD = `---
name: My Skill
description: Does a useful thing.
version: 1.2.0
scope: global
---

Step one. Step two.`;
ok(validateSkillMd("x", GOOD).name === "My Skill", "frontmatter: parses name");
ok(validateSkillMd("x", GOOD).scope === "global", "frontmatter: default/global scope");

await throws(() => validateSkillMd("x", "no frontmatter here"), "rejects missing frontmatter");
await throws(() => validateSkillMd("x", "---\ndescription: no name\n---\nbody"), "rejects missing name");
await throws(() => validateSkillMd("x", "---\nname: X\n---\n(no description)"), "rejects missing description");
await throws(
  () => validateSkillMd("x", "---\nname: X\ndescription: d\n  orphan: yaml\n---\nbody"),
  "rejects indented lines without a parent key",
);
{
  // Real-world skills (archify) ship one level of nesting + quoted values.
  const nested = validateSkillMd("x", '---\nname: N\ndescription: d\nmetadata:\n  version: "3.0"\n  author: someone\n---\nbody');
  ok(nested.name === "N", "frontmatter: nested block under metadata parses");
}
await throws(
  () => validateSkillMd("x", "---\nname: X\ndescription: d\nscope: everywhere\n---\nbody"),
  "rejects invalid scope",
);
await throws(() => validateSkillMd("x", "---\nname: X\ndescription: d\n---\n"), "rejects empty body");
await throws(
  () => validateSkillMd("x", "---\nname: X\ndescription: d\n---\n" + "x".repeat(SKILLS_LIMITS.maxSkillMdBytes + 10)),
  "rejects oversized SKILL.md",
);

// --- create / list / duplicates ---
const rec = await store.create({ name: "Alpha Skill", description: "First test skill." });
ok(rec.id === "alpha-skill", "create: slugified id");
ok(rec.enabled === false, "create: drafts start disabled");
await store.setEnabled(rec.id, true);
ok(store.get(rec.id)?.enabled === true, "enable: persists");
await throws(() => store.create({ name: "Alpha Skill", description: "dup" }), "create: duplicate id rejected");

// --- catalog + availability scoping ---
ok(store.availableFor("p1").some((s) => s.id === "alpha-skill"), "availability: global enabled skill visible");
await store.setEnabled(rec.id, false);
ok(!store.availableFor("p1").some((s) => s.id === "alpha-skill"), "availability: disabled skill hidden");
await store.setEnabled(rec.id, true);

const projRec = await store.create({ name: "Scoped Skill", description: "Project-only.", scope: "project" });
await store.setScope(projRec.id, "project", "proj-123");
await store.setEnabled(projRec.id, true);
ok(!store.availableFor("other").some((s) => s.id === "scoped-skill"), "availability: project skill hidden from others");
ok(store.availableFor("proj-123").some((s) => s.id === "scoped-skill"), "availability: project skill visible to its project");

const cat = store.catalogBlock(store.availableFor("proj-123"));
ok(cat?.includes("alpha-skill") && cat.includes("scoped-skill"), "catalog block lists available skills");

// --- import roundtrip ---
const importSrc = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-skill-src-"));
fs.writeFileSync(path.join(importSrc, "SKILL.md"), GOOD);
fs.mkdirSync(path.join(importSrc, "references"));
fs.writeFileSync(path.join(importSrc, "references", "notes.md"), "reference material");
const imported = await store.importFrom(importSrc);
ok(imported.id === "my-skill", "import: slugified from frontmatter name");
const importRealPath = await fsp.realpath(importSrc);
ok(imported.source === "imported" && imported.sourcePath === importRealPath, "import: source recorded (realpath)");
ok(fs.existsSync(path.join(storage.root, "skills", "my-skill", "references", "notes.md")), "import: reference files copied");
await throws(() => store.importFrom(importSrc), "import: duplicate id rejected");

// removal removes ONLY the app-managed copy
await store.remove("my-skill");
ok(!fs.existsSync(path.join(storage.root, "skills", "my-skill")), "remove: app copy deleted");
ok(fs.existsSync(path.join(importSrc, "SKILL.md")), "remove: source folder untouched");

// --- import rejections ---
await throws(() => store.importFrom(fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-noskill-"))), "import: folder without SKILL.md rejected");

const evilSrc = fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-skill-evil-"));
fs.writeFileSync(path.join(evilSrc, "SKILL.md"), GOOD);
let symlinkEscapeOk = true;
if (process.platform !== "win32") {
  // Windows symlink creation needs privileges; the copy logic skips symlinks elsewhere.
  fs.symlinkSync(path.join(os.tmpdir(), "outside-target"), path.join(evilSrc, "escape"));
  try {
    await store.importFrom(evilSrc);
    symlinkEscapeOk = false;
  } catch {
    symlinkEscapeOk = true;
  }
}
ok(symlinkEscapeOk, "import: symlink escape rejected");
ok(!fs.existsSync(path.join(storage.root, "skills", "my-skill-2")), "import: partial copy cleaned after rejection");

// --- path validation on read/write ---
await throws(() => store.writeFile(rec.id, "../evil.txt", "nope"), "writeFile: traversal path rejected");
await throws(() => store.readFile(rec.id, "../../settings.json"), "readFile: traversal path rejected");
await store.writeFile(rec.id, "references/nested.md", "ok content");
ok(fs.existsSync(path.join(storage.root, "skills", "alpha-skill", "references", "nested.md")), "writeFile: in-folder writes work");

// --- persistence across "restart" (fresh instance over the same storage) ---
const store2 = new SkillStore(storage);
ok(store2.list().some((s) => s.id === "alpha-skill"), "persistence: registry survives a fresh instance");

// --- adoptUnregistered (bundled scaffold path) ---
const bundleDir = path.join(storage.root, "skills", "hand-dropped");
fs.mkdirSync(bundleDir, { recursive: true });
fs.writeFileSync(path.join(bundleDir, "SKILL.md"), GOOD);
const adopted = await store2.adoptUnregistered(["hand-dropped"]);
ok(adopted.adopted.includes("hand-dropped"), "adopt: unregistered folder registered");
ok(store2.get("hand-dropped")?.enabled === true, "adopt: bundled ids start enabled");

// --- bounds: max skills ---
const tinyStorage = new Storage(fs.mkdtempSync(path.join(os.tmpdir(), "xtrac-skills-cap-")));
const tinyStore = new SkillStore(tinyStorage);
// Lower the ceiling by filling the registry document directly to the cap.
await tinyStorage.saveDoc("skills.json", Array.from({ length: SKILLS_LIMITS.maxSkills }, (_, i) => ({
  id: `pad-${i}`, name: `P${i}`, description: "pad", version: "1", scope: "global", projectId: null,
  enabled: false, source: "created", createdAt: 0, updatedAt: 0, sizeBytes: 1,
})));
await throws(() => tinyStore.create({ name: "One Too Many", description: "over cap" }), "bounds: max skill count enforced");

// --- skill instructions loading is bounded ---
await store.writeFile(rec.id, "SKILL.md", GOOD + "\n" + "detail ".repeat(2000));
const body = await store.loadInstructions(rec.id);
ok(body.length <= SKILLS_LIMITS.maxPromptCharsPerSkill, "loadInstructions: prompt injection bounded");

console.log(`\nskills.test: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
