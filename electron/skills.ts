/**
 * Local skills (v5 Phase B).
 *
 * A skill is reusable INSTRUCTIONS plus optional reference/template files. It is not
 * executable code and grants no permissions: SKILL.md text is injected into the system
 * prompt only for chats that explicitly select the skill, and everything else in the
 * folder is inert data. Scripts are never run by the skills system.
 *
 * Layout (app-managed copies under the data root):
 *   <root>/skills/<id>/SKILL.md      — YAML frontmatter (name, description, version,
 *                                      scope) + Markdown instructions
 *   <root>/skills/<id>/references/   — loaded explicitly, stay inside the folder
 *   <root>/skills/<id>/templates/    — inert templates
 *   <root>/skills/<id>/scripts/      — inert assets unless separately invoked via an
 *                                      approved run_command by the user/agent
 *   <root>/skills.json               — registry (id, scope, enabled, source, sizes)
 *
 * Bounds (documented in the wiki + USER_GUIDE): max 100 skills, 1 MB per file,
 * 25 MB per imported folder, prompt injection ≤ 8 KB per skill, catalog block ≤ 4 KB.
 * Symlinks that escape the source folder are rejected on import; skill content is
 * treated as untrusted, lower-priority instructions — it cannot override safety
 * policy, approve tools, or access files outside the data root.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Storage } from "./storage";

export const SKILLS_LIMITS = {
  maxSkills: 100,
  // Per-file cap inside a skill folder. Raised 256 KB → 1 MB in v5.1: real-world
  // skills (e.g. archify) ship large HTML/JS templates and validator bundles.
  maxSkillMdBytes: 1024 * 1024,
  // Whole-folder import cap. Raised 5 MB → 25 MB for the same reason; still keeps
  // the catalog bounded (100 skills × 25 MB worst case is caught by the total-catalog
  // expectation that users curate, and cleanup/reporting make usage visible).
  maxImportBytes: 25 * 1024 * 1024,
  maxPromptCharsPerSkill: 8_000,
  maxCatalogChars: 4_000,
  maxSelectedPerChat: 3,
};

export type SkillScope = "global" | "project";

export interface SkillRecord {
  id: string; // folder name + identity, e.g. "skill-builder"
  name: string;
  description: string;
  version: string;
  scope: SkillScope;
  /** When scope=project, only chats in this project id see the skill. */
  projectId: string | null;
  enabled: boolean;
  /** bundled = shipped with the app; imported = copied from a folder; created = made in-app. */
  source: "bundled" | "imported" | "created";
  /** Where an imported skill came from (informational; removal never touches it). */
  sourcePath?: string;
  createdAt: number;
  updatedAt: number;
  sizeBytes: number;
}

export class SkillError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function skillsDir(storage: Storage): string {
  return path.join(storage.root, "skills");
}

export function skillFolder(storage: Storage, id: string): string {
  return path.join(skillsDir(storage), id);
}

/** Frontmatter: the first `---` block. Supports simple `key: value` lines plus ONE
 *  level of nesting under a parent key (e.g. `metadata:` with indented children,
 *  flattened to `metadata.version`), matching what real-world skills ship. Deeper
 *  indentation, tabs, and lists are rejected rather than silently mis-parsed. */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) throw new SkillError("SKILL.md must start with a --- frontmatter block.");
  const end = text.indexOf("\n---", 3);
  if (end < 0) throw new SkillError("Frontmatter block is not closed (missing a second ---).");
  const block = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\s*\n/, "");
  const meta: Record<string, string> = {};
  let parent: string | null = null;
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    if (/^\t/.test(line)) throw new SkillError(`Tab-indented frontmatter is not supported: ${line.trim().slice(0, 60)}`);
    const indented = line.startsWith(" ");
    const m = line.trim().match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) throw new SkillError(`Unsupported frontmatter line (use simple "key: value"): ${line.trim().slice(0, 60)}`);
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (indented) {
      if (!parent) throw new SkillError(`Indented frontmatter line without a parent key: ${line.trim().slice(0, 60)}`);
      meta[`${parent}.${key}`] = value;
      continue;
    }
    parent = value === "" ? key : null;
    meta[key] = value;
  }
  return { meta, body };
}

/** Validate a SKILL.md's frontmatter into a partial record. Throws SkillError with actionable messages. */
export function validateSkillMd(id: string, raw: string): { name: string; description: string; version: string; scope: SkillScope; body: string } {
  if (Buffer.byteLength(raw, "utf8") > SKILLS_LIMITS.maxSkillMdBytes) {
    throw new SkillError(`SKILL.md is too large (max ${SKILLS_LIMITS.maxSkillMdBytes / 1024} KB). Keep bulky material in references/ or templates/.`);
  }
  const { meta, body } = parseFrontmatter(raw);
  const name = meta.name ?? "";
  const description = meta.description ?? "";
  if (!name || !/^.{1,80}$/.test(name)) throw new SkillError("Frontmatter needs a name (1–80 chars).");
  if (!description) throw new SkillError("Frontmatter needs a description (shown in the skill catalog).");
  if (description.length > 1024) throw new SkillError("description is too long (max 1024 chars).");
  const version = (meta.version ?? "1.0.0").slice(0, 40);
  const scopeRaw = (meta.scope ?? "global").toLowerCase();
  if (scopeRaw !== "global" && scopeRaw !== "project") {
    throw new SkillError(`scope must be "global" or "project" (got "${scopeRaw}").`);
  }
  if (!body.trim()) throw new SkillError("SKILL.md has no instructions after the frontmatter.");
  return { name, description, version, scope: scopeRaw as SkillScope, body };
}

/** Slugify a display name into a valid id. */
export function slugify(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || "skill";
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += dirSize(p);
      else total += fs.statSync(p).size;
    }
  } catch {
    /* ignore unreadable entries */
  }
  return total;
}

/** Reject any symlink inside a skill folder that resolves outside it (import and
 *  adoption must agree on this; readFile/writeFile additionally lstat their target). */
async function assertNoEscapingSymlinks(folder: string): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith("._") || e.name === ".DS_Store") continue;
    const p = path.join(folder, e.name);
    if (e.isSymbolicLink()) {
      const target = await fsp.realpath(p).catch(() => null);
      if (!target || !(target === folder || target.startsWith(folder + path.sep))) {
        throw new SkillError(`Refused: "${e.name}" is a symlink pointing outside the skill folder.`);
      }
    } else if (e.isDirectory()) {
      await assertNoEscapingSymlinks(p);
    }
  }
}

/** Recursively copy a skill folder, refusing symlinks that escape the source tree. */
async function copySkillTree(src: string, dest: string): Promise<number> {
  let copied = 0;
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith("._") || e.name === ".DS_Store") continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isSymbolicLink()) {
      const target = await fsp.realpath(s).catch(() => null);
      const outside = !target || !(target === src || target.startsWith(src + path.sep));
      if (outside) throw new SkillError(`Refused: "${e.name}" is a symlink pointing outside the skill folder.`);
      await fsp.symlink(path.relative(path.dirname(d), target!), d).catch(() => {});
      continue;
    }
    if (e.isDirectory()) {
      copied += await copySkillTree(s, d);
    } else if (e.isFile()) {
      const st = await fsp.stat(s);
      if (st.size > SKILLS_LIMITS.maxSkillMdBytes) {
        throw new SkillError(`Refused: "${e.name}" is larger than the ${SKILLS_LIMITS.maxSkillMdBytes / 1024} KB per-file limit.`);
      }
      await fsp.copyFile(s, d);
      copied += st.size;
    }
  }
  return copied;
}

export class SkillStore {
  constructor(private storage: Storage) {}

  private get registry(): SkillRecord[] {
    if (!this._cache) this._cache = this.storage.loadDoc<SkillRecord[]>("skills.json", []);
    return this._cache;
  }
  private _cache: SkillRecord[] | null = null;
  private invalidate() {
    this._cache = null;
  }

  list(): SkillRecord[] {
    return [...this.registry].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): SkillRecord | null {
    return this.registry.find((s) => s.id === id) ?? null;
  }

  /** Validate an id coming from the renderer before any filesystem use: it must match
   *  ID_RE (no path separators, no "..") AND name a registered skill. This is the
   *  bound that keeps skill-folder reads/writes from escaping the data root even if a
   *  caller skips the IPC-layer check. */
  private requireRegisteredId(id: string): SkillRecord {
    if (!ID_RE.test(id)) throw new SkillError(`Invalid skill id "${id.slice(0, 64)}" (lowercase letters, digits, - and _ only).`);
    const rec = this.get(id);
    if (!rec) throw new SkillError("Unknown skill: " + id);
    return rec;
  }

  private async save(records: SkillRecord[]): Promise<void> {
    this._cache = records;
    await this.storage.saveDoc("skills.json", records);
  }

  /** Register a folder that already exists under skills/<id>/ with a valid SKILL.md. */
  private async register(
    id: string,
    meta: { name: string; description: string; version: string; scope: SkillScope },
    source: SkillRecord["source"],
    sourcePath?: string,
  ): Promise<SkillRecord> {
    const records = this.registry;
    if (records.length >= SKILLS_LIMITS.maxSkills) {
      throw new SkillError(`Skill catalog is full (max ${SKILLS_LIMITS.maxSkills}). Remove one first.`);
    }
    if (records.some((s) => s.id === id)) {
      throw new SkillError(`A skill with id "${id}" already exists. Remove it first or rename the new one.`);
    }
    if (!ID_RE.test(id)) throw new SkillError(`Invalid skill id "${id}" (lowercase letters, digits, - and _ only).`);
    const size = dirSize(skillFolder(this.storage, id));
    const rec: SkillRecord = {
      id,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      scope: meta.scope,
      projectId: null,
      enabled: source === "bundled",
      source,
      sourcePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sizeBytes: size,
    };
    records.push(rec);
    await this.save(records);
    return rec;
  }

  /** Import (copy) a skill folder from anywhere on disk. Removal later removes only the copy. */
  async importFrom(sourcePath: string): Promise<SkillRecord> {
    const src = path.resolve(sourcePath);
    let mdPath = path.join(src, "SKILL.md");
    if (!fs.existsSync(mdPath) && fs.existsSync(path.join(src, "skill.md"))) mdPath = path.join(src, "skill.md");
    if (!fs.existsSync(mdPath)) throw new SkillError("That folder has no SKILL.md — a skill needs SKILL.md with name/description frontmatter.");
    const raw = await fsp.readFile(mdPath, "utf8");
    const meta = validateSkillMd("import", raw);
    const srcReal = await fsp.realpath(src);
    const id = slugify(meta.name || path.basename(srcReal));
    const dest = skillFolder(this.storage, id);
    if (fs.existsSync(dest)) throw new SkillError(`A skill with id "${id}" already exists. Remove it first or rename the new one.`);
    let bytes = 0;
    try {
      bytes = await copySkillTree(srcReal, dest);
    } catch (e) {
      await fsp.rm(dest, { recursive: true, force: true });
      throw e;
    }
    if (bytes > SKILLS_LIMITS.maxImportBytes) {
      await fsp.rm(dest, { recursive: true, force: true });
      throw new SkillError(`Skill folder is too large (${(bytes / 1048576).toFixed(1)} MB; max ${SKILLS_LIMITS.maxImportBytes / 1048576} MB).`);
    }
    // Re-validate from the copied file so what's on disk is what was validated.
    const copied = await fsp.readFile(path.join(dest, path.basename(mdPath)), "utf8");
    const meta2 = validateSkillMd(id, copied);
    return this.register(id, meta2, "imported", srcReal);
  }

  /** Create a new skill in-app (draft body editable later via writeSkillFile). */
  async create(opts: { name: string; description: string; version?: string; scope?: SkillScope; body?: string }): Promise<SkillRecord> {
    const id = slugify(opts.name);
    if (!ID_RE.test(id)) throw new SkillError("Name must start with a letter or digit and use letters, digits, - or _.");
    const dest = skillFolder(this.storage, id);
    if (fs.existsSync(dest)) throw new SkillError(`A skill with id "${id}" already exists.`);
    // Newlines would let a value like "x\n---" close the frontmatter block early and
    // inject attacker-chosen body text; collapse them so file and registry agree.
    const name = opts.name.slice(0, 80).replace(/[\r\n]+/g, " ").trim() || id;
    const version = (opts.version || "0.1.0").slice(0, 40).replace(/[\r\n]+/g, " ").trim();
    const description = (opts.description || "No description yet.").replace(/\s*\n\s*/g, " ").slice(0, 1024);
    const frontmatter = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `version: ${version}`,
      `scope: ${opts.scope === "project" ? "project" : "global"}`,
      "---",
      "",
    ].join("\n");
    await fsp.mkdir(dest, { recursive: true });
    await fsp.writeFile(path.join(dest, "SKILL.md"), frontmatter + (opts.body ?? "") + "\n", "utf8");
    return this.register(id, {
      name,
      description,
      version,
      scope: opts.scope === "project" ? "project" : "global",
    }, "created");
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillRecord> {
    const records = this.registry;
    const rec = records.find((s) => s.id === id);
    if (!rec) throw new SkillError("Unknown skill: " + id);
    rec.enabled = enabled;
    rec.updatedAt = Date.now();
    await this.save(records);
    return rec;
  }

  /** Project scope assignment (only meaningful when scope=project). */
  async setScope(id: string, scope: SkillScope, projectId: string | null): Promise<SkillRecord> {
    const records = this.registry;
    const rec = records.find((s) => s.id === id);
    if (!rec) throw new SkillError("Unknown skill: " + id);
    rec.scope = scope;
    rec.projectId = scope === "project" ? projectId : null;
    rec.updatedAt = Date.now();
    await this.save(records);
    return rec;
  }

  /** Remove the app-managed copy only — imported sources on disk are never touched. */
  async remove(id: string): Promise<void> {
    const records = this.registry.filter((s) => s.id !== id);
    if (records.length === this.registry.length) throw new SkillError("Unknown skill: " + id);
    await this.save(records);
    await fsp.rm(skillFolder(this.storage, id), { recursive: true, force: true });
  }

  /** Export: copy the skill folder to a user-chosen destination (never moves the original). */
  async exportTo(id: string, destDir: string): Promise<string> {
    const rec = this.get(id);
    if (!rec) throw new SkillError("Unknown skill: " + id);
    const src = skillFolder(this.storage, id);
    if (!fs.existsSync(src)) throw new SkillError("Skill folder is missing on disk.");
    const dest = path.join(destDir, id);
    if (fs.existsSync(dest)) throw new SkillError(`"${dest}" already exists.`);
    await copySkillTree(await fsp.realpath(src), dest);
    return dest;
  }

  /** Read one file inside the skill folder (id- and path-validated, symlinks rejected). */
  async readFile(id: string, rel: string): Promise<string> {
    this.requireRegisteredId(id);
    const folder = await fsp.realpath(skillFolder(this.storage, id)).catch(() => {
      throw new SkillError("Skill folder is missing on disk — remove and re-import the skill.");
    });
    const target = path.resolve(folder, rel);
    if (target !== folder && !target.startsWith(folder + path.sep)) {
      throw new SkillError("Refused: path escapes the skill folder.");
    }
    const lst = await fsp.lstat(target).catch(() => null);
    if (!lst || lst.isSymbolicLink()) throw new SkillError("No such file in the skill folder.");
    if (!lst.isFile()) throw new SkillError("No such file in the skill folder.");
    if (lst.size > SKILLS_LIMITS.maxSkillMdBytes) {
      throw new SkillError(`File exceeds the ${SKILLS_LIMITS.maxSkillMdBytes / 1024} KB viewer limit.`);
    }
    return fsp.readFile(target, "utf8");
  }

  /** Write SKILL.md (or a file inside the folder) with validation and bounds. */
  async writeFile(id: string, rel: string, content: string): Promise<void> {
    this.requireRegisteredId(id);
    if (typeof content !== "string" || content.length > SKILLS_LIMITS.maxSkillMdBytes) {
      throw new SkillError(`Content must be text under ${SKILLS_LIMITS.maxSkillMdBytes / 1024} KB.`);
    }
    const folder = await fsp.realpath(skillFolder(this.storage, id)).catch(() => {
      throw new SkillError("Skill folder is missing on disk — remove and re-import the skill.");
    });
    const target = path.resolve(folder, rel);
    if (target !== folder && !target.startsWith(folder + path.sep)) {
      throw new SkillError("Refused: path escapes the skill folder.");
    }
    const lst = await fsp.lstat(target).catch(() => null);
    if (lst && lst.isSymbolicLink()) throw new SkillError("Refused: target is a symlink.");
    if (path.basename(rel).toUpperCase() === "SKILL.MD") validateSkillMd(id, content);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content, "utf8");
    const records = this.registry;
    const rec = records.find((s) => s.id === id);
    if (rec) {
      if (path.basename(rel).toUpperCase() === "SKILL.MD") {
        const meta = validateSkillMd(id, content);
        rec.name = meta.name;
        rec.description = meta.description;
        rec.version = meta.version;
      }
      rec.sizeBytes = dirSize(folder);
      rec.updatedAt = Date.now();
      await this.save(records);
    }
  }

  /** Full SKILL.md text (bounded) for prompt injection. */
  async loadInstructions(id: string): Promise<string | null> {
    const raw = await fsp.readFile(path.join(skillFolder(this.storage, id), "SKILL.md"), "utf8").catch(() => null);
    if (raw == null) return null;
    const { body } = parseFrontmatter(raw);
    return body.slice(0, SKILLS_LIMITS.maxPromptCharsPerSkill);
  }

  /**
   * Skills available to a chat: enabled globals + enabled project-scoped skills of the
   * chat's project. Returns metadata for the catalog and the selected records' ids.
   */
  availableFor(projectId: string | null): SkillRecord[] {
    return this.list().filter(
      (s) => s.enabled && (s.scope === "global" || (s.scope === "project" && s.projectId === projectId)),
    );
  }

  /** Catalog block for the system prompt (metadata only, hard-bounded). */
  catalogBlock(available: SkillRecord[]): string | null {
    if (available.length === 0) return null;
    const lines: string[] = [];
    let total = 0;
    for (const s of available) {
      const line = `- ${s.id} (v${s.version}): ${s.description}`;
      if (total + line.length > SKILLS_LIMITS.maxCatalogChars) {
        lines.push(`… [${available.length - lines.length} more skills not shown]`);
        break;
      }
      lines.push(line);
      total += line.length;
    }
    return lines.join("\n");
  }

  /**
   * Register folders that already exist under skills/ but are missing from the registry
   * (used when bundled skills are scaffolded on launch, or a user drops a folder in
   * manually). Invalid folders are reported and left on disk, never auto-deleted.
   */
  async adoptUnregistered(bundledIds: string[] = []): Promise<{ adopted: string[]; invalid: string[] }> {
    const adopted: string[] = [];
    const invalid: string[] = [];
    const entries = await fsp.readdir(skillsDir(this.storage), { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
    for (const e of entries) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      if (this.get(e.name)) continue;
      const mdPath = path.join(skillFolder(this.storage, e.name), "SKILL.md");
      const raw = await fsp.readFile(mdPath, "utf8").catch(() => null);
      if (raw == null) {
        invalid.push(e.name);
        continue;
      }
      try {
        const meta = validateSkillMd(e.name, raw);
        await assertNoEscapingSymlinks(skillFolder(this.storage, e.name));
        const records = this.registry;
        if (records.some((s) => s.id === e.name)) continue;
        const rec: SkillRecord = {
          id: e.name,
          name: meta.name,
          description: meta.description,
          version: meta.version,
          scope: meta.scope,
          projectId: null,
          enabled: bundledIds.includes(e.name),
          source: bundledIds.includes(e.name) ? "bundled" : "imported",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sizeBytes: dirSize(skillFolder(this.storage, e.name)),
        };
        records.push(rec);
        await this.save(records);
        adopted.push(e.name);
      } catch {
        invalid.push(e.name);
      }
    }
    return { adopted, invalid };
  }
}
