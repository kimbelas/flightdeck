// The real reader, against real files — P1-T7.
//
// The fake owns the byte arithmetic in every other test; this is the one that proves the fake and
// the adapter agree about what a byte offset, a replacement and a half-written character are.
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsTranscriptFile } from '../../../core/adapters/node/fs-transcript-file.ts';
import { NEW_TRANSCRIPT } from '../../../core/ports/transcript-file.ts';

let directory: string;
let path: string;
const file = new FsTranscriptFile();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fd-transcript-'));
  path = join(directory, 'session.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('FsTranscriptFile', () => {
  it('reads a missing transcript as unreadable rather than throwing', async () => {
    const slice = await file.read(join(directory, 'nothing.jsonl'), NEW_TRANSCRIPT);

    expect(slice.unreadable).toBe(true);
    expect(slice.text).toBe('');
  });

  it('reads from the start and reports where it got to', async () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');

    const slice = await file.read(path, NEW_TRANSCRIPT);

    expect(slice.text).toBe('{"a":1}\n');
    expect(slice.from).toBe(0);
    expect(slice.to).toBe(8);
    expect(slice.restarted).toBe(false);
  });

  it('reads only what was appended, from the byte offset', async () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');
    const first = await file.read(path, NEW_TRANSCRIPT);
    appendFileSync(path, '{"b":2}\n', 'utf8');

    const second = await file.read(path, { offset: first.to, identity: first.identity });

    expect(second.text).toBe('{"b":2}\n');
    expect(second.from).toBe(8);
    expect(second.restarted).toBe(false);
  });

  it('reports nothing new as an empty slice, not as a failure', async () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');
    const first = await file.read(path, NEW_TRANSCRIPT);

    const second = await file.read(path, { offset: first.to, identity: first.identity });

    expect(second.text).toBe('');
    expect(second.unreadable).toBe(false);
    expect(second.restarted).toBe(false);
  });

  it('sees a truncation as a restart and rereads from zero', async () => {
    writeFileSync(path, '{"a":1}\n{"b":2}\n', 'utf8');
    const first = await file.read(path, NEW_TRANSCRIPT);
    truncateSync(path, 8);

    const second = await file.read(path, { offset: first.to, identity: first.identity });

    expect(second.restarted).toBe(true);
    expect(second.from).toBe(0);
    expect(second.text).toBe('{"a":1}\n');
  });

  // Replacement at the SAME length is detectable only where the filesystem gives a distinct file
  // index or creation time, which NTFS does and ext4 with a reused inode does not. It is therefore
  // asserted in tests/win/transcript-identity.test.ts, on the platform Flightdeck actually targets.

  it('never ends a slice inside a UTF-8 character', async () => {
    // Four bytes: one ASCII brace and a three-byte ellipsis. Reading the file one byte at a time
    // must never produce U+FFFD, and must never advance the offset past half a character.
    const text = '{"s":"…"}\n';
    writeFileSync(path, text, 'utf8');
    const size = Buffer.byteLength(text);

    let cursor = NEW_TRANSCRIPT;
    let assembled = '';
    for (let stop = 0; stop < size * 2 && cursor.offset < size; stop += 1) {
      const slice = await file.read(path, cursor);
      assembled += slice.text;
      cursor = { offset: slice.to, identity: slice.identity };
    }

    expect(assembled).toBe(text);
    expect(assembled).not.toContain('�');
  });

  it('leaves the offset on a character boundary while a writer flushes byte by byte', async () => {
    // The real scenario, not a synthetic one: Claude Code appends while this reads, so every read
    // can land mid-character. The contract is that the offset the adapter RETURNS is always a
    // boundary, which is what makes the next read start on one — an offset handed in mid-character
    // is not a case the tail can produce, and not one this can rescue.
    const text = '{"s":"日本語ですよ"}\n';
    const bytes = Buffer.from(text, 'utf8');
    writeFileSync(path, '');

    let cursor = NEW_TRANSCRIPT;
    let assembled = '';
    for (const byte of bytes) {
      appendFileSync(path, Buffer.from([byte]));
      const slice = await file.read(path, cursor);
      assembled += slice.text;
      expect(slice.text).not.toContain('�');
      expect(Buffer.byteLength(slice.text)).toBe(slice.to - slice.from);
      cursor = { offset: slice.to, identity: slice.identity };
    }

    expect(assembled).toBe(text);
  });

  it('does not call a first read a restart — nothing was consumed, so nothing was lost', async () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');

    const slice = await file.read(path, NEW_TRANSCRIPT);

    expect(slice.restarted).toBe(false);
    expect(slice.from).toBe(0);
  });
});
