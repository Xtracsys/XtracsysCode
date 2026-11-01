import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

export function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}
export function forbidden(name) {
  return name.split('/').some(p => p.startsWith('._') || ['.DS_Store', '__MACOSX', '.git', '.hermes', 'backups', 'private'].includes(p) || /^\.env(?:\.|$)/i.test(p) || /\.(pem|key|p12|pfx)$/i.test(p));
}
export function zipName(name) {
  assert(!name.includes('\\') && !/[\x00-\x1f\x7f]/.test(name), 'unsafe ZIP name');
  const value = name.replace(/\/$/, '');
  assert(value && !path.posix.isAbsolute(value), 'absolute/empty ZIP name');
  assert(value.split('/').every(p => p && p !== '.' && p !== '..'), 'traversing ZIP name');
  assert(value === 'XtracsysCode.app' || value.startsWith('XtracsysCode.app/'), 'unexpected ZIP root');
  assert(!forbidden(value), 'private/AppleDouble ZIP entry');
  return value;
}
export function linkTarget(name, target) {
  assert(target && !path.posix.isAbsolute(target) && !target.includes('\\') && !/[\x00-\x1f\x7f]/.test(target), 'unsafe ZIP link');
  return zipName(path.posix.normalize(path.posix.join(path.posix.dirname(name), target)));
}

/** No subprocesses or deletion. Caller supplies yauzl.open and a fresh private dest.
 * Timer injection makes cancellation races deterministic without third-party tests.
 */
export async function extractZip(zip, dest, {
  openZip, checkTime = () => {}, onProgress = () => {}, signal,
  timeoutMs = 60_000, teardownMs = 5_000,
  maxEntries = 20000, maxBytes = 2 * 1024 ** 3,
  setTimer = setTimeout, clearTimer = clearTimeout,
  setTeardownTimer = setTimeout, clearTeardownTimer = clearTimeout,
} = {}) {
  const links = [], seen = new Set(), streams = new Set(), streamClosures = [], tasks = new Set();
  const controller = new AbortController();
  let archive, archiveClosed, closeRequested = false, closed = false, opened = false, openingStarted = false;
  let stopped = false, failure, bytes = 0, entryBusy = false, progress;
  let complete;
  const completion = new Promise(resolve => { complete = resolve; });
  let timer;
  const closeArchive = () => {
    if (!archive || closeRequested || closed) return;
    closeRequested = true;
    try { archive.close(); }
    catch (error) { failure ??= error; }
  };
  // The only terminal path: stop callbacks synchronously, cancel readers/pipeline,
  // then close the archive. Settlement happens below, AFTER teardown is awaited.
  const finish = error => {
    if (stopped) return;
    stopped = true;
    failure = error;
    clearTimer(timer);
    controller.abort(error || new Error('ZIP extraction completed'));
    for (const stream of streams) stream.destroy();
    closeArchive();
    complete();
  };
  const guard = () => {
    if (stopped) throw failure || new Error('ZIP extraction stopped');
    checkTime();
  };
  const track = stream => {
    streams.add(stream);
    // Modern _destroy callbacks emit close. Legacy yauzl/fd-slicer overrides
    // destroy itself and can advertise emitClose:true without honoring it;
    // its descriptor lifetime is instead bounded by archiveClosed below.
    const state = stream._readableState || stream._writableState;
    const legacyDestroy = stream.destroy !== Readable.prototype.destroy;
    if (!legacyDestroy && typeof stream.closed === 'boolean' && !stream.closed && state?.emitClose !== false) {
      streamClosures.push(new Promise(resolve => stream.once('close', resolve)));
    }
    stream.on('error', finish); // Also absorbs errors arriving during destruction.
    return stream;
  };
  const disposeLate = stream => {
    if (stream) { stream.on('error', () => {}); stream.destroy(); }
  };
  const readInput = entry => new Promise((resolve, reject) => {
    const abort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      guard();
      // Own decompression: old yauzl overrides its inflate endpoint's destroy()
      // without closing the inflate filter or emitting modern close events.
      archive.openReadStream(entry, entry.compressionMethod === 8 ? { decompress: false } : {}, (error, stream) => {
        controller.signal.removeEventListener('abort', abort);
        if (stopped || error) {
          disposeLate(stream);
          reject(failure || error || new Error('ZIP extraction stopped'));
        } else resolve(track(stream));
      });
    } catch (error) {
      controller.signal.removeEventListener('abort', abort);
      reject(error);
    }
  });
  const bridge = raw => {
    // Legacy fd-slicer can destroy without close. Pipeline gets a modern endpoint
    // whose _destroy completes; archive close separately awaits the raw fd.
    const input = track(new Readable({
      read() { raw.resume(); },
      destroy(error, done) {
        raw.pause();
        raw.removeListener('data', data);
        raw.removeListener('end', end);
        raw.removeListener('error', fail);
        raw.removeListener('close', close);
        try { raw.destroy(); done(error); } catch (cause) { done(error || cause); }
      },
    }));
    const data = chunk => { if (!stopped && !input.push(chunk)) raw.pause(); };
    const end = () => input.push(null);
    const fail = error => input.destroy(error);
    const close = () => { if (!raw.readableEnded && !raw._readableState?.endEmitted) fail(new Error('ZIP input closed before end')); };
    raw.once('end', end);
    raw.on('error', fail);
    raw.once('close', close);
    raw.on('data', data);
    return input;
  };
  const readLink = (input, entry) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const done = error => {
      input.removeListener('data', data);
      input.removeListener('end', end);
      input.removeListener('close', close);
      input.removeListener('error', done);
      controller.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve({ size, target: Buffer.concat(chunks).toString('utf8') });
    };
    const abort = () => done(controller.signal.reason);
    const end = () => done();
    const close = () => done(new Error('ZIP link stream closed before end'));
    const data = chunk => {
      try {
        guard();
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        assert(size <= 4096 && size <= entry.uncompressedSize, 'oversize ZIP link');
        chunks.push(bytes);
      } catch (error) { done(error); finish(error); }
    };
    // Do not use for-await/finished here: yauzl's legacy stored-entry stream
    // requires explicit end-event handling, not modern async-iterator semantics.
    input.on('error', done);
    input.once('end', end);
    input.once('close', close);
    controller.signal.addEventListener('abort', abort, { once: true });
    input.on('data', data);
    if (stopped) abort();
  });
  const readNext = () => { if (!stopped) archive.readEntry(); };
  const processEntry = async entry => {
    guard();
    progress = { entries: seen.size, name: entry.fileName };
    onProgress(progress);
    guard();
    const name = zipName(entry.fileName);
    assert(!seen.has(name) && seen.size < maxEntries, 'duplicate/excessive ZIP entry'); seen.add(name);
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    const type = unixMode & 0xf000;
    assert([0, 0x8000, 0x4000, 0xa000].includes(type), 'unsupported ZIP file type');
    assert(!(entry.generalPurposeBitFlag & 1), 'encrypted ZIP');
    assert([0, 8].includes(entry.compressionMethod), 'unsupported ZIP compression');
    assert(Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize >= 0 && entry.uncompressedSize <= 512 * 1024 ** 2, 'ZIP file size limit');
    bytes += entry.uncompressedSize;
    assert(bytes <= maxBytes, 'ZIP total size limit');
    const out = path.join(dest, name);
    assert(inside(dest, out), 'ZIP scope violation');
    if (entry.fileName.endsWith('/')) fs.mkdirSync(out, { recursive: true });
    else {
      if (type === 0xa000) assert(entry.uncompressedSize <= 4096, 'oversize ZIP link');
      const input = await readInput(entry);
      guard(); // Cancellation may have won after the open callback resolved.
      let size = 0;
      if (type === 0xa000 && entry.compressionMethod === 0) {
        const link = await readLink(input, entry);
        guard();
        size = link.size;
        linkTarget(name, link.target);
        links.push({ out, target: link.target });
      } else {
        const chunks = [];
        if (type !== 0xa000) fs.mkdirSync(path.dirname(out), { recursive: true });
        const limiter = track(new Transform({ transform(chunk, encoding, done) {
          try { guard(); size += chunk.length; assert(size <= entry.uncompressedSize, 'ZIP streamed size limit'); done(null, chunk); }
          catch (error) { done(error); }
        } }));
        const output = track(type === 0xa000
          ? new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } })
          : fs.createWriteStream(out, { flags: 'wx', mode: (unixMode & 0o777) || 0o644 }));
        const source = bridge(input);
        const filters = entry.compressionMethod === 8 ? [track(createInflateRaw())] : [];
        await pipeline(source, ...filters, limiter, output, { signal: controller.signal });
        guard();
        if (type === 0xa000) {
          const target = Buffer.concat(chunks).toString('utf8');
          linkTarget(name, target); links.push({ out, target });
        }
      }
      assert.equal(size, entry.uncompressedSize, 'ZIP declared size mismatch');
    }
    entryBusy = false;
    readNext();
  };
  const onAbort = () => finish(signal.reason instanceof Error ? signal.reason : new Error('ZIP extraction aborted'));
  timer = setTimer(() => finish(new Error(`ZIP extraction stalled: ${JSON.stringify(progress)}`)), timeoutMs);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  if (!stopped) {
    openingStarted = true;
    try {
      // Own archive closure on both success and failure; do not race autoClose.
      openZip(zip, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, handle) => {
        opened = true;
        if (handle) {
          archive = handle;
          archiveClosed = new Promise(resolve => archive.once('close', () => {
            closed = true; resolve();
            if (!stopped) finish(new Error('ZIP closed before extraction completed'));
          }));
          archive.on('error', error => {
            if (stopped) failure ??= error;
            else finish(error);
          });
        }
        if (stopped) { closeArchive(); return; } // Late open must never read entries.
        if (error) { finish(error); return; }
        if (!archive) { finish(new Error('ZIP open returned no archive')); return; }
        archive.on('entry', entry => {
          if (stopped) return;
          if (entryBusy) { finish(new Error('overlapping ZIP entries')); return; }
          entryBusy = true;
          const task = processEntry(entry).catch(finish);
          tasks.add(task);
          task.then(() => tasks.delete(task));
        });
        archive.on('end', () => {
          if (stopped) return;
          try {
            guard(); assert(!entryBusy, 'ZIP ended with active entry');
            // Links are created last, after all regular writes have completed.
            for (const { out, target } of links) {
              guard(); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.symlinkSync(target, out);
            }
            finish();
          } catch (error) { finish(error); }
        });
        try { guard(); readNext(); } catch (error) { finish(error); }
      });
    } catch (error) { opened = true; finish(error); }
  }
  await completion;
  signal?.removeEventListener('abort', onAbort);
  let teardownTimer;
  try {
    // Bound broken/native teardown without ever pretending it is safe to delete.
    // All tracked tasks already have rejection handlers, including a late callback.
    await Promise.race([
      Promise.allSettled([...tasks, ...streamClosures, archiveClosed]),
      new Promise((_, reject) => { teardownTimer = setTeardownTimer(() => reject(new Error('ZIP teardown deadline exceeded')), teardownMs); }),
    ]);
  } catch (error) {
    failure ??= error;
    failure.teardownIncomplete = true;
  } finally { clearTeardownTimer(teardownTimer); streams.clear(); }
  // yauzl.open itself has no cancellation API. A late result is closed by its
  // guarded callback; retain evidence until then rather than declaring it idle.
  if (openingStarted && !opened && failure) failure.teardownIncomplete = true;
  if (failure) throw failure;
}
