// Coordinator-reviewed, read-only local audit. No network or working-tree writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CAP = Object.freeze({ entries: 50000, objects: 50000, aliases: 100000,
  fileBytes: 1024 * 1024, treeBytes: 2 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024, commandBytes: 16 * 1024 * 1024,
  records: 30000, reportBytes: 16 * 1024 * 1024, pathBytes: 4096,
  depth: 64, seconds: 180, commandSeconds: 15 });
const started = Date.now();
const report = { version: 1, scope: 'local current tree and objects reachable from all local refs',
  complete: false, cleanHistoryClaim: false, caps: CAP, counts: {}, findings: [], skipped: [],
  limitations: ['Pattern matching is not exhaustive or credential validation.',
    'No reflogs, unreachable objects, remote-only refs, LFS payloads, submodule contents, or decoded archives.',
    'Excluded directories are not inventoried internally; their counts are directory counts.',
    'Requires a quiescent trusted checkout; race checks are not an adversarial filesystem sandbox.',
    'Output contains private filenames/object IDs; keep local and do not publish it.'] };
const count = (key, n = 1) => { report.counts[key] = (report.counts[key] || 0) + n; };
const fail = code => { const e = new Error(); e.auditCode = code; throw e; };
function tick() { if (Date.now() - started > CAP.seconds * 1000) fail('overall-time-cap'); }
let reportBytes = 0;
function record(array, value) {
  if (report.findings.length + report.skipped.length >= CAP.records) fail('report-record-cap');
  reportBytes += Buffer.byteLength(JSON.stringify(value)) * 2 + 256;
  if (reportBytes > CAP.reportBytes) fail('report-byte-cap');
  array.push(value);
}
function skip(scope, object, name, reason) {
  count(`skipped:${reason}`); record(report.skipped, { scope, object, path: name, reason });
}
function inside(p) { return p === ROOT || p.startsWith(ROOT + path.sep); }
function exact(p) { if (!inside(fs.realpathSync(p))) fail('symlink-or-path-escape'); }
const denyPath = name => name.split('/').some(part =>
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.aws|\.ssh|\.gnupg|\.hermes|\.claude|\.codex|credentials?(?:[._-].*)?|secrets?(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|jks|keystore|mobileprovision)|.*(?:forensic|confidential|company[-_ ]?plan).*)$/i.test(part)) ||
  /(?:^|\/)(?:backups?|chat[-_]?logs?|sessions?|memories|user[-_]?data)(?:\/|$)/i.test(name);
const excluded = name => name.split('/').some(part =>
  /^(?:\.git|node_modules|dist(?:-.*)?|release|out|coverage|\.cache|\.DS_Store|\._.*)$/i.test(part));
const internalPath = name => /(?:^|\/)(?:AGENTS\.md|GOAL_PROMPT[^/]*|STATUS\.md|BUILD_REQUIREMENTS\.md|OPEN_SOURCE_READINESS\.md)$/i.test(name) ||
  /(?:^|\/)(?:internal[-_]?prompts?|goal[-_]?prompts?)(?:\/|$)/i.test(name);
function finding(scope, object, names, line, pattern, classification) {
  count(`findings:${classification}`);
  record(report.findings, { scope, object, paths: names, line, pattern, classification });
}
const rules = [
  ['private-key-header', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['aws-access-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['provider-token', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[A-Za-z0-9_-]{30,})\b/g],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)\s*[=:]\s*["']([^"'\r\n]{4,})["']/gi],
  ['operator-path', /(?:\/Users\/[^\s/"'`<>]+|\/Volumes\/[^\s/"'`<>]+|\/home\/[^\s/"'`<>]+|[A-Z]:\\Users\\[^\s\\"'`<>]+)/g],
  ['internal-prompt', /\b(?:confidential|internal[- ]only|system prompt|developer instructions|operator instructions|approved sprint|coordinator approved)\b/gi],
  ['private-network-address', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g],
];
// Exact, intentionally public sentinels only; never whitelist by a broad 'test' prefix.
const fixtureMarkers = new Set(['test-key', 'test-token', 'dummy', 'placeholder', 'your-api-key',
  'YOUR_API_KEY', 'AKIAIOSFODNN7EXAMPLE']);
function scan(buffer, scope, object, names, message = false) {
  if (buffer.includes(0)) { skip(scope, object, names, 'binary'); return; }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { skip(scope, object, names, 'non-utf8'); return; }
  count(`${scope}:textScanned`);
  if (names.some(internalPath)) finding(scope, object, names, 1, 'internal-document-path', 'internal-material');
  const publicFixture = !message && names.length > 0 && names.every(n => /^(?:tests\/|docs\/)|\.md$/i.test(n));
  for (const [index, line] of text.split('\n').entries()) {
    tick();
    for (const [pattern, regex] of rules) {
      regex.lastIndex = 0;
      const classifications = new Set();
      for (const match of line.matchAll(regex)) {
        const marker = pattern === 'credential-assignment' ? match[1] : match[0];
        classifications.add(publicFixture && fixtureMarkers.has(marker) ? 'known-public-fixture-marker' :
          ['operator-path', 'internal-prompt', 'private-network-address'].includes(pattern) ? 'internal-material' : 'secret-candidate');
      }
      for (const classification of classifications) finding(scope, object, names, index + 1, pattern, classification);
    }
  }
}
let bytes = 0;
function budget(size) { tick(); bytes += size; if (bytes > CAP.totalBytes) fail('aggregate-byte-cap'); count('contentBytesRead', size); }
function boundedFile(p, st) {
  exact(path.dirname(p));
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.dev !== st.dev || before.ino !== st.ino || before.size !== st.size ||
        before.mtimeMs !== st.mtimeMs || before.ctimeMs !== st.ctimeMs) fail('current-file-changed');
    budget(before.size);
    const b = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < b.length) { const n = fs.readSync(fd, b, offset, b.length - offset, offset); if (!n) fail('short-file-read'); offset += n; }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail('current-file-changed');
    return b;
  } finally { fs.closeSync(fd); }
}
function currentTree() {
  const files = [], deniedInodes = new Set(); let entries = 0;
  function walk(dir, depth = 0) {
    tick(); if (depth > CAP.depth) fail('current-depth-cap'); exact(dir);
    const handle = fs.opendirSync(dir);
    try {
      for (let item; (item = handle.readSync()) !== null;) {
        if (++entries > CAP.entries) fail('current-entry-cap');
        const p = path.join(dir, item.name), name = path.relative(ROOT, p).split(path.sep).join('/');
        if (Buffer.byteLength(name) > CAP.pathBytes) fail('current-path-byte-cap');
        const st = fs.lstatSync(p); count('current:entries');
        if (st.isSymbolicLink()) { skip('current', null, name, 'symlink'); continue; }
        if (denyPath(name)) { deniedInodes.add(`${st.dev}:${st.ino}`); skip('current', null, name, 'credential-or-private-path'); continue; }
        if (excluded(name)) { skip('current', null, name, 'excluded-surface'); continue; }
        if (st.isDirectory()) walk(p, depth + 1);
        else if (st.isFile()) files.push({ p, name, st });
        else skip('current', null, name, 'special-file');
      }
    } finally { handle.closeSync(); }
  }
  walk(ROOT);
  count('current:eligibleFiles', files.length);
  for (const { p, name, st } of files) {
    if (deniedInodes.has(`${st.dev}:${st.ino}`)) { skip('current', null, name, 'credential-hardlink-alias'); continue; }
    if (st.size > CAP.fileBytes) { skip('current', null, name, 'size-cap'); continue; }
    scan(boundedFile(p, st), 'current', null, [name]);
  }
}
const gitDir = path.join(ROOT, '.git');
function gitPreflight() {
  // No alternate repositories, linked worktrees, shallow history, grafts or symlinked Git storage.
  for (const rel of ['shallow', 'commondir', 'info/grafts', 'objects/info/alternates', 'objects/info/http-alternates']) {
    if (fs.existsSync(path.join(gitDir, rel))) fail('unsupported-git-storage-or-history');
  }
  if (!fs.lstatSync(gitDir).isDirectory() || fs.realpathSync(gitDir) !== gitDir) fail('unsupported-git-directory');
  let entries = 0;
  function walk(dir, depth = 0) {
    tick(); if (depth > CAP.depth) fail('git-storage-depth-cap');
    const handle = fs.opendirSync(dir);
    try {
      for (let item; (item = handle.readSync()) !== null;) {
        if (++entries > CAP.entries) fail('git-storage-entry-cap');
        const p = path.join(dir, item.name), st = fs.lstatSync(p);
        if (st.isSymbolicLink()) fail('symlink-in-git-storage');
        if (st.isDirectory()) walk(p, depth + 1);
      }
    } finally { handle.closeSync(); }
  }
  walk(gitDir);
}
function git(args, input) {
  tick();
  const result = spawnSync('/usr/bin/git', ['--no-optional-locks', '--no-replace-objects',
    '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: ROOT, shell: false, encoding: null, input,
    timeout: Math.min(CAP.commandSeconds * 1000, Math.max(1, CAP.seconds * 1000 - (Date.now() - started))),
    maxBuffer: CAP.commandBytes,
    env: { PATH: '/usr/bin:/bin', HOME: ROOT, LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
      GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' },
  });
  // Never echo stderr, arguments, object contents, or native exception messages.
  if (result.error || result.signal || result.status !== 0) fail('git-command-failed-or-output-cap');
  return result.stdout;
}
const decode = b => new TextDecoder('utf-8', { fatal: true }).decode(b);
const oidOK = s => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s);
function lines(b) { const s = decode(b); if (s && !s.endsWith('\n')) fail('incomplete-git-output'); return s.trimEnd().split('\n').filter(Boolean); }
function history() {
  gitPreflight();
  const refs = lines(git(['for-each-ref', '--format=%(objectname) %(refname)']));
  if (refs.some(r => r.includes(' refs/replace/'))) fail('replacement-refs-present');
  if (refs.length > CAP.objects) fail('ref-count-cap');
  const ids = lines(git(['rev-list', '--objects', '--all', '--no-object-names']));
  if (!ids.length || ids.length > CAP.objects || ids.some(id => !oidOK(id)) || new Set(ids).size !== ids.length) fail('invalid-or-capped-object-enumeration');
  const metadata = lines(git(['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], Buffer.from(ids.join('\n') + '\n')));
  if (metadata.length !== ids.length) fail('incomplete-object-metadata');
  const objects = new Map();
  metadata.forEach((line, i) => {
    const m = /^(\S+) (blob|tree|commit|tag) (\d+)$/.exec(line);
    if (!m || m[1] !== ids[i] || !Number.isSafeInteger(Number(m[3]))) fail('invalid-object-metadata');
    objects.set(m[1], { type: m[2], size: Number(m[3]) }); count(`history:${m[2]}Objects`);
  });
  for (const ref of refs) if (!objects.has(ref.split(' ')[0])) fail('unmapped-ref-object');
  const read = (id, type, cap = CAP.fileBytes) => {
    const meta = objects.get(id);
    if (!meta || meta.type !== type) fail('missing-or-wrong-object');
    if (meta.size > cap) fail('structural-object-size-cap');
    budget(meta.size);
    const b = git(['cat-file', type, id]); if (b.length !== meta.size) fail('object-size-mismatch'); return b;
  };
  const roots = new Set(), trees = new Map(), aliases = new Map(), denied = new Set();
  for (const [id, meta] of objects) {
    if (!['commit', 'tag'].includes(meta.type)) continue;
    if (meta.size > CAP.fileBytes) { skip('history', id, null, 'message-size-cap'); fail('unscanned-structural-message'); }
    const b = read(id, meta.type), split = b.indexOf(Buffer.from('\n\n'));
    if (split < 0) fail('invalid-message-object');
    const headers = decode(b.subarray(0, split));
    if (meta.type === 'commit') {
      const m = /^tree ([0-9a-f]+)$/m.exec(headers); if (!m || !oidOK(m[1])) fail('invalid-commit-tree'); roots.add(m[1]);
    } else {
      const m = /^object ([0-9a-f]+)$/m.exec(headers); if (!m || !objects.has(m[1])) fail('unmapped-tag-target');
      if (objects.get(m[1]).type === 'tree') roots.add(m[1]);
    }
    // Signed tag/commit headers are not messages. Scan bodies only; line is relative to message body.
    scan(b.subarray(split + 2), `${meta.type}-message`, id, [], true);
  }
  let width;
  for (const id of ids) { width = id.length / 2; break; }
  function tree(id) {
    if (trees.has(id)) return trees.get(id);
    const b = read(id, 'tree', CAP.treeBytes), result = []; let pos = 0;
    while (pos < b.length) {
      const space = b.indexOf(32, pos), zero = b.indexOf(0, space + 1);
      if (space < pos || zero < space || zero + 1 + width > b.length) fail('invalid-tree-record');
      const mode = b.subarray(pos, space).toString('ascii'), name = decode(b.subarray(space + 1, zero));
      if (!name || name === '.' || name === '..' || /[\/\\]/.test(name)) fail('unsafe-tree-path');
      const child = b.subarray(zero + 1, zero + 1 + width).toString('hex');
      result.push({ mode, name, child }); pos = zero + 1 + width;
    }
    trees.set(id, result); return result;
  }
  let aliasCount = 0;
  const visited = new Set();
  function walk(id, prefix = '', depth = 0) {
    tick(); if (depth > CAP.depth) fail('history-depth-cap');
    const key = `${id}:${prefix}`; if (visited.has(key)) return; visited.add(key);
    if (visited.size > CAP.aliases) fail('tree-alias-cap');
    for (const { mode, name, child } of tree(id)) {
      if (++aliasCount > CAP.aliases) fail('history-path-cap');
      const full = prefix + name;
      if (Buffer.byteLength(full) > CAP.pathBytes) fail('history-path-byte-cap');
      if (mode === '40000') { walk(child, full + '/', depth + 1); continue; }
      if (mode === '160000') { skip('history', child, full, 'submodule'); continue; }
      if (!['100644', '100755', '120000'].includes(mode) || objects.get(child)?.type !== 'blob') fail('invalid-tree-mode-or-object');
      if (!aliases.has(child)) aliases.set(child, new Set()); aliases.get(child).add(full);
      if (mode === '120000' || denyPath(full) || excluded(full)) {
        denied.add(child); skip('history', child, full, mode === '120000' ? 'symlink' : denyPath(full) ? 'credential-or-private-path' : 'excluded-surface');
      }
    }
  }
  for (const root of roots) walk(root);
  // Root trees referenced directly by refs, not only commits/tags.
  for (const ref of refs) { const id = ref.split(' ')[0]; if (objects.get(id).type === 'tree') walk(id); }
  count('history:pathAliases', aliasCount);
  for (const [id, meta] of objects) {
    if (meta.type === 'tree' && !trees.has(id)) fail('unmapped-tree');
    if (meta.type !== 'blob') continue;
    const names = [...(aliases.get(id) || [])].sort();
    if (!names.length) { skip('history', id, [], 'unmapped-blob'); continue; }
    if (denied.has(id)) { skip('history', id, names, 'blocked-alias-blob'); continue; }
    if (meta.size > CAP.fileBytes) { skip('history', id, names, 'size-cap'); continue; }
    scan(read(id, 'blob'), 'history-blob', id, names);
  }
  const finalRefs = lines(git(['for-each-ref', '--format=%(objectname) %(refname)']));
  if (JSON.stringify(refs) !== JSON.stringify(finalRefs)) fail('refs-changed-during-audit');
  count('history:refs', refs.length);
}
try {
  if (fs.realpathSync(ROOT) !== ROOT || fileURLToPath(import.meta.url) !== path.join(ROOT, 'scripts/release-audit.mjs')) fail('wrong-checkout');
  exact(path.join(ROOT, 'scripts'));
  currentTree(); history(); report.complete = true;
} catch (error) {
  report.failure = error.auditCode || 'local-read-or-parse-failed';
}
report.counts.elapsedMilliseconds = Date.now() - started;
report.status = !report.complete ? 'incomplete' : report.findings.some(f => f.classification !== 'known-public-fixture-marker') ? 'review-required' : report.skipped.some(s => s.reason !== 'excluded-surface') ? 'coverage-gaps' : 'bounded-scan-no-candidates';
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = !report.complete ? 2 : report.status === 'bounded-scan-no-candidates' ? 0 : 1;
