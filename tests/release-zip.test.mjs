import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter, getEventListeners, once } from 'node:events';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { extractZip, zipName, linkTarget } from '../scripts/release-zip.mjs';

const SCRATCH = path.join(os.homedir(), '.cache/xtracsyscode-sprint');
const tick = () => new Promise(resolve => setImmediate(resolve));
const entry = (fileName = 'XtracsysCode.app/A', size = 1, mode = 0x8000) => ({
  fileName, uncompressedSize: size, externalFileAttributes: (mode << 16) >>> 0, generalPurposeBitFlag: 0, compressionMethod: 0,
});
function fixture(t, entries = [entry()], streams = [Readable.from(['x'])], options = {}) {
  fs.mkdirSync(path.dirname(SCRATCH), { recursive: true });
  assert.equal(fs.realpathSync(path.dirname(SCRATCH)), path.dirname(SCRATCH));
  if (!fs.existsSync(SCRATCH)) fs.mkdirSync(SCRATCH);
  assert.equal(fs.realpathSync(SCRATCH), SCRATCH);
  const dest = fs.mkdtempSync(path.join(SCRATCH, 'zip-test-'));
  const archive = new EventEmitter();
  let index = 0, settled = false, incomplete = false, timer, teardownTimer, openCallback, streamCallback;
  archive.reads = 0; archive.closes = 0;
  archive.readEntry = () => {
    archive.reads++;
    const next = entries[index++];
    queueMicrotask(() => archive.emit(next ? 'entry' : 'end', next));
  };
  archive.close = () => {
    archive.closes++;
    archive.emit('close-request');
    if (!options.holdClose) queueMicrotask(() => archive.emit('close'));
  };
  archive.openReadStream = (_entry, config, callback) => {
    assert.deepEqual(config, _entry.compressionMethod === 8 ? { decompress: false } : {});
    streamCallback = callback;
    if (!options.holdStream) queueMicrotask(() => callback(null, streams.shift()));
  };
  const promise = extractZip('fixture.zip', dest, {
    openZip: (_file, config, callback) => {
      assert.equal(config.lazyEntries, true);
      assert.equal(config.validateEntrySizes, true);
      openCallback = callback;
      if (!options.holdOpen) queueMicrotask(() => callback(null, archive));
    },
    signal: options.signal,
    setTimer: callback => { timer = callback; return callback; },
    clearTimer: handle => { if (timer === handle) timer = undefined; },
    setTeardownTimer: callback => { teardownTimer = callback; return callback; },
    clearTeardownTimer: handle => { if (teardownTimer === handle) teardownTimer = undefined; },
  });
  // Observe immediately, so intentional rejection cannot become unhandled.
  promise.then(() => { settled = true; }, error => { settled = true; incomplete = Boolean(error.teardownIncomplete); });
  t.after(() => {
    // Never remove a live extraction, even when an assertion failed.
    if (settled && !incomplete) fs.rmSync(dest, { recursive: true });
  });
  return { archive, dest, promise, settled: () => settled, timer: () => timer,
    expire: () => { assert(timer); timer(); },
    expireTeardown: () => { assert(teardownTimer); teardownTimer(); },
    deliverOpen: () => openCallback(null, archive),
    deliverStream: stream => streamCallback(null, stream),
  };
}

for (const cause of ['timeout', 'external cancellation', 'archive error']) {
  test(`ZIP ${cause} waits for active pipeline destruction and prevents later writes/readEntry`, { timeout: 3000 }, async t => {
    let releaseDestroy;
    const input = new Readable({ read() {}, destroy(error, done) { releaseDestroy = () => done(error); } });
    const caller = new AbortController();
    const f = fixture(t, [entry()], [input], { signal: caller.signal });
    await tick();
    input.push('x');
    await tick();
    if (cause === 'timeout') f.expire();
    else if (cause === 'external cancellation') caller.abort(new Error('fixture cancelled'));
    else f.archive.emit('error', new Error('fixture archive error'));
    await tick();
    assert.equal(input.destroyed, true);
    assert.equal(f.archive.closes, 1);
    assert.equal(f.settled(), false, 'must await asynchronous stream destruction');
    assert(releaseDestroy);
    releaseDestroy();
    await assert.rejects(f.promise, cause === 'timeout' ? /ZIP extraction stalled/ : /fixture/);
    const file = path.join(f.dest, 'XtracsysCode.app/A');
    const size = fs.statSync(file).size;
    input.push('late');
    f.archive.emit('entry', entry('XtracsysCode.app/LATE'));
    f.archive.emit('end');
    await tick();
    assert.equal(fs.statSync(file).size, size);
    assert.equal(fs.existsSync(path.join(f.dest, 'XtracsysCode.app/LATE')), false);
    assert.equal(f.archive.reads, 1);
    assert.equal(f.archive.closes, 1);
    assert.equal(f.timer(), undefined);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });
}

test('ZIP timeout disposes a late open callback without reading entries', { timeout: 3000 }, async t => {
  const f = fixture(t, [], [], { holdOpen: true });
  f.expire();
  await assert.rejects(f.promise, /ZIP extraction stalled/);
  f.deliverOpen();
  await tick();
  assert.equal(f.archive.closes, 1);
  assert.equal(f.archive.reads, 0);
});

test('ZIP cancellation disposes a late input callback without output or readEntry', { timeout: 3000 }, async t => {
  const caller = new AbortController();
  const f = fixture(t, [entry()], [], { holdStream: true, signal: caller.signal });
  await tick();
  caller.abort();
  await assert.rejects(f.promise, /abort/i);
  const input = Readable.from(['x']);
  f.deliverStream(input);
  await tick();
  assert.equal(input.destroyed, true);
  assert.deepEqual(fs.readdirSync(f.dest), []);
  assert.equal(f.archive.reads, 1);
  assert.equal(f.archive.closes, 1);
});

test('ZIP success awaits archive close and preserves legacy stored-link end handling', { timeout: 3000 }, async t => {
  const legacy = new Readable({ autoDestroy: false, emitClose: false, read() { this.push('A'); this.push(null); } });
  legacy[Symbol.asyncIterator] = undefined;
  const f = fixture(t, [entry(), entry('XtracsysCode.app/Current', 1, 0xa000)], [Readable.from(['x']), legacy], { holdClose: true });
  await once(f.archive, 'close-request');
  assert.equal(f.archive.closes, 1);
  assert.equal(f.settled(), false, 'archive descriptor close must precede success');
  f.archive.emit('close');
  await f.promise;
  assert.equal(fs.readFileSync(path.join(f.dest, 'XtracsysCode.app/A'), 'utf8'), 'x');
  assert.equal(fs.readlinkSync(path.join(f.dest, 'XtracsysCode.app/Current')), 'A');
  assert.equal(f.archive.reads, 3);
  assert.equal(f.timer(), undefined);
});

test('ZIP stalled legacy stored-link timeout destroys input and removes data listeners', { timeout: 3000 }, async t => {
  const input = new Readable({ emitClose: false, autoDestroy: false, read() {} });
  input[Symbol.asyncIterator] = undefined;
  const f = fixture(t, [entry('XtracsysCode.app/Current', 1, 0xa000)], [input]);
  await tick();
  f.expire();
  await assert.rejects(f.promise, /ZIP extraction stalled/);
  assert.equal(input.destroyed, true);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(f.archive.closes, 1);
  assert.equal(f.archive.reads, 1);
  assert.deepEqual(fs.readdirSync(f.dest), []);
});

test('ZIP legacy no-close regular input is bridged to a cancellable pipeline', { timeout: 3000 }, async t => {
  // Real yauzl streams can advertise emitClose:true even when overriding destroy
  // without emitting close; do not rely on that flag alone for teardown.
  const input = new Readable({ autoDestroy: false, read() {} });
  // Reproduce fd-slicer destroy semantics: synchronous error, no close event.
  input.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('error', new Error('legacy stream destroyed'));
  };
  const f = fixture(t, [entry()], [input]);
  await tick();
  f.expire();
  await tick(); await tick();
  if (!f.settled()) f.expireTeardown();
  await assert.rejects(f.promise, error => /ZIP extraction stalled/.test(error.message) && !error.teardownIncomplete);
  assert.equal(input.destroyed, true);
  assert.equal(f.archive.closes, 1);
  assert.equal(f.archive.reads, 1);
});

test('ZIP owns deflate teardown and extracts compressed files and links', { timeout: 3000 }, async t => {
  const file = { ...entry(), compressionMethod: 8 };
  const link = { ...entry('XtracsysCode.app/Current', 1, 0xa000), compressionMethod: 8 };
  const f = fixture(t, [file, link], [Readable.from([deflateRawSync('x')]), Readable.from([deflateRawSync('A')])]);
  await f.promise;
  assert.equal(fs.readFileSync(path.join(f.dest, 'XtracsysCode.app/A'), 'utf8'), 'x');
  assert.equal(fs.readlinkSync(path.join(f.dest, 'XtracsysCode.app/Current')), 'A');
  assert.equal(f.archive.closes, 1);
});

test('ZIP stuck archive close fails bounded teardown and flags retained evidence', { timeout: 3000 }, async t => {
  const f = fixture(t, [], [], { holdClose: true });
  await once(f.archive, 'close-request');
  await tick();
  assert.equal(f.settled(), false);
  f.expireTeardown();
  await assert.rejects(f.promise, error => /ZIP teardown deadline exceeded/.test(error.message) && error.teardownIncomplete);
  f.archive.emit('close'); // Release fixture; its evidence is deliberately retained.
  assert.equal(f.archive.closes, 1);
  assert.equal(f.timer(), undefined);
});

test('ZIP archive close exception fails bounded teardown without retrying close', { timeout: 3000 }, async t => {
  const f = fixture(t, [], [], { holdOpen: true });
  f.archive.close = () => { f.archive.closes++; throw new Error('fixture close failed'); };
  f.deliverOpen();
  await tick();
  f.expireTeardown();
  await assert.rejects(f.promise, error => /fixture close failed/.test(error.message) && error.teardownIncomplete);
  assert.equal(f.archive.closes, 1);
  f.archive.emit('close');
});

test('ZIP pre-cancelled extraction never opens an archive', { timeout: 3000 }, async () => {
  const caller = new AbortController(); caller.abort();
  await assert.rejects(extractZip('unused.zip', '/unused', {
    signal: caller.signal,
    openZip: () => assert.fail('must not open after cancellation'),
  }), error => /abort/i.test(error.message) && !error.teardownIncomplete);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('ZIP early archive close rejects and does not resume extraction', { timeout: 3000 }, async t => {
  const f = fixture(t, [entry()], [], { holdStream: true });
  await tick();
  f.archive.emit('close');
  await assert.rejects(f.promise, /closed before extraction completed/);
  assert.equal(f.archive.reads, 1);
});

test('ZIP open error clears timer', { timeout: 3000 }, async () => {
  let timer;
  await assert.rejects(extractZip('bad.zip', '/unused', {
    openZip: (_zip, _options, callback) => queueMicrotask(() => callback(new Error('open failed'))),
    setTimer: callback => { timer = callback; return callback; },
    clearTimer: () => { timer = undefined; },
  }), /open failed/);
  assert.equal(timer, undefined);
});

test('ZIP path and link validation retains confinement/private-path checks', () => {
  for (const name of ['/etc/passwd', '../XtracsysCode.app', 'XtracsysCode.app/../bad', 'XtracsysCode.app/._a', 'XtracsysCode.app/.env', 'XtracsysCode.app/private/a', 'XtracsysCode.app/a\\b']) assert.throws(() => zipName(name));
  assert.equal(linkTarget('XtracsysCode.app/F/Current', 'A'), 'XtracsysCode.app/F/A');
  for (const target of ['../../escape', '/Applications', '../.env']) assert.throws(() => linkTarget('XtracsysCode.app/a', target));
});

for (const [name, entries, streams, expected] of [
  ['duplicate', [entry(), entry()], [Readable.from(['x'])], /duplicate/],
  ['size mismatch', [entry()], [Readable.from([])], /declared size mismatch/],
  ['oversized data', [entry()], [Readable.from(['xx'])], /size/],
  ['declared size limit', [entry(undefined, 513 * 1024 ** 2)], [], /file size limit/],
  ['link escape', [entry('XtracsysCode.app/Current', 5, 0xa000)], [Readable.from(['/evil'])], /unsafe ZIP link/],
]) {
  test(`ZIP ${name} closes archive on validation failure`, { timeout: 3000 }, async t => {
    const f = fixture(t, entries, streams);
    await assert.rejects(f.promise, expected);
    assert.equal(f.archive.closes, 1);
    assert.equal(f.timer(), undefined);
  });
}
