/**
 * Consent boundary: ALL entries in the original source tree, including hidden files,
 * manifests and local dependencies. No ignored directories or mtime-only cache.
 * Oversized trees, links (including internal links), hard links and special files fail
 * closed; use a small dedicated source folder rather than importing a workspace.
 *
 * This is change detection, NOT a sandbox or an immutable execution snapshot. Bare
 * PATH commands, external interpreters/libraries, environment, network and files a
 * process opens outside this folder are NOT reviewed/pinned. A writer can still race
 * the final check and spawn, or mutate files after spawn. Stop/review/restart after
 * updates; installed/running processes cannot be made safe by hashing their source.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const PLUGIN_SOURCE_LIMITS = {
  maxEntries: 2048,
  maxDepth: 24,
  maxFileBytes: 8 * 1024 * 1024,
  maxBytes: 32 * 1024 * 1024,
} as const;

export function pluginSourceIdentity(source: string): string {
  const root = fs.realpathSync(source);
  if (!fs.statSync(root).isDirectory()) throw new Error("Plugin source must be a directory.");
  const hash = createHash("sha256");
  const frame = (value: unknown) => hash.update(JSON.stringify(value) + "\n");
  frame(["plugin-source-v1", root]);
  let entries = 0;
  let bytes = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > PLUGIN_SOURCE_LIMITS.maxDepth) throw new Error("Plugin source exceeds the review depth limit.");
    // Bound directory enumeration too (readdir could allocate an arbitrarily large list).
    const names: string[] = [];
    const directory = fs.opendirSync(dir);
    try {
      let entry: fs.Dirent | null;
      while ((entry = directory.readSync())) {
        if (++entries > PLUGIN_SOURCE_LIMITS.maxEntries) throw new Error("Plugin source has too many entries for review.");
        names.push(entry.name);
      }
    } finally { directory.closeSync(); }
    for (const name of names.sort()) {
      const target = path.join(dir, name);
      const relative = path.relative(root, target);
      const st = fs.lstatSync(target);
      if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || fs.realpathSync(target) !== target) throw new Error("Plugin source review does not allow links or special files.");
      frame([relative, st.isDirectory() ? "directory" : "file", st.mode & 0o777]);
      if (st.isDirectory()) { walk(target, depth + 1); continue; }
      if (st.nlink !== 1) throw new Error("Plugin source review does not allow hard links.");
      if (st.size > PLUGIN_SOURCE_LIMITS.maxFileBytes || bytes + st.size > PLUGIN_SOURCE_LIMITS.maxBytes) throw new Error("Plugin source exceeds the review byte limit; use a small dedicated folder.");
      const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fs.fstatSync(fd);
        if (!opened.isFile() || opened.dev !== st.dev || opened.ino !== st.ino || opened.size !== st.size || opened.nlink !== 1) throw new Error("Plugin source changed during review.");
        const content = Buffer.alloc(st.size);
        let offset = 0;
        while (offset < content.length) {
          const count = fs.readSync(fd, content, offset, content.length - offset, null);
          if (!count) throw new Error("Plugin source changed during review.");
          offset += count;
        }
        const after = fs.fstatSync(fd);
        if (after.size !== st.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("Plugin source changed during review.");
        bytes += content.length;
        frame([content.length, createHash("sha256").update(content).digest("hex")]);
      } finally { fs.closeSync(fd); }
    }
  };
  walk(root, 0);
  return hash.digest("hex");
}
