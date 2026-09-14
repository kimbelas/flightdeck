// The one thing P1-T7's truncation detection asks of the filesystem — on the filesystem itself.
//
// A resumed session writes a fresh transcript at a path Flightdeck is already tailing. If the new
// file happens to be the length the old one had reached, a byte comparison cannot tell it from
// "nothing was appended", and the tail would splice a new file onto the offset of an old one and
// parse the seam. `FsTranscriptFile` answers that with `dev:ino:birthtime`.
//
// **That is an NTFS guarantee, and this file exists because CI proved it is not a universal one.**
// The assertion first lived in `tests/core/adapters/`, passed on Windows, and failed on the Ubuntu
// runner: ext4 hands a deleted inode straight back to the next file, and Node's `birthtimeMs`
// there is not a real creation time. Flightdeck is Windows-only — ConPTY, `%LOCALAPPDATA%`,
// `icacls` — so the honest place for it is the suite that runs on `windows-latest`, not a
// weakened version of it that runs everywhere and proves less.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsTranscriptFile } from '../../core/adapters/node/fs-transcript-file.ts';
import { NEW_TRANSCRIPT } from '../../core/ports/transcript-file.ts';

const onWindows = process.platform === 'win32';
const file = new FsTranscriptFile();

let directory = '';
let path = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fd-identity-'));
  path = join(directory, 'session.jsonl');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('transcript identity on NTFS', () => {
  it.skipIf(!onWindows)('gives a real file index and creation time', () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');

    const info = statSync(path);

    // The two halves of the identity. Either being zero would make replacement undetectable, and
    // the adapter would be relying on something the platform does not actually provide.
    expect(String(info.ino)).not.toBe('0');
    expect(info.birthtimeMs).toBeGreaterThan(0);
  });

  it.skipIf(!onWindows)('sees a file replaced at a length already read', async () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');
    const first = await file.read(path, NEW_TRANSCRIPT);

    // Same path, same length, different file — exactly what `--bg --resume` looks like from here.
    rmSync(path);
    writeFileSync(path, '{"z":9}\n', 'utf8');
    const second = await file.read(path, { offset: first.to, identity: first.identity });

    expect(second.restarted).toBe(true);
    expect(second.from).toBe(0);
    expect(second.text).toBe('{"z":9}\n');
  });

  it.skipIf(!onWindows)('does not call an ordinary append a replacement', async () => {
    writeFileSync(path, '{"a":1}\n', 'utf8');
    const first = await file.read(path, NEW_TRANSCRIPT);

    writeFileSync(path, '{"a":1}\n{"b":2}\n', 'utf8');
    const second = await file.read(path, { offset: first.to, identity: first.identity });

    // The other half of the guarantee: an identity that changed on every write would restart the
    // digest once a second and feed 4 would never accumulate anything.
    expect(second.restarted).toBe(false);
    expect(second.text).toBe('{"b":2}\n');
  });
});
