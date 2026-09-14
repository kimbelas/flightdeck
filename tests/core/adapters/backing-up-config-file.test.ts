// SEC-FS-3's order, against a real temp tree: back up → write temp → atomic rename.
//
// It also pins the bug that showed up on the first live Connect: the temp file was named from a
// hand-rolled basename that returned the whole path, so the write failed with ENOENT on a path
// like `C:\cfg\.C:\cfg\settings.json.flightdeck-tmp`. Nothing was lost — the backup was already
// taken and the original untouched, which is the order doing its job — but the feature could not
// write at all (RESEARCH.md G.14).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackingUpConfigFile } from '../../../core/adapters/node/backing-up-config-file.ts';

let dir = '';
let target = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fd-cfg-'));
  target = join(dir, 'settings.json');
  writeFileSync(target, '{\r\n  "a": 1\r\n}\r\n', 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (): Date => new Date(2026, 8, 12, 20, 40, 12);

describe('BackingUpConfigFile', () => {
  it('reads what is there and undefined for what is not', () => {
    const file = new BackingUpConfigFile(at);

    expect(file.read(target)).toBe('{\r\n  "a": 1\r\n}\r\n');
    expect(file.read(join(dir, 'nope.json'))).toBeUndefined();
  });

  it('writes the backup before replacing, named by SEC-FS-3\u2019s convention', () => {
    const original = readFileSync(target, 'utf8');

    const backup = new BackingUpConfigFile(at).replace(target, 'replaced');

    expect(backup).toBe(`${target}.bak-20260912-204012`);
    expect(readFileSync(backup, 'utf8')).toBe(original);
    expect(readFileSync(target, 'utf8')).toBe('replaced');
  });

  it('writes the exact bytes it was given, CRLF and all', () => {
    const crlf = '{\r\n  "a": 2\r\n}\r\n';

    new BackingUpConfigFile(at).replace(target, crlf);

    expect(readFileSync(target, 'utf8')).toBe(crlf);
  });

  it('leaves no temp file behind (G.14 \u2014 the temp name has to be a NAME, not a path)', () => {
    new BackingUpConfigFile(at).replace(target, 'replaced');

    expect(readdirSync(dir).filter((name) => name.includes('flightdeck-tmp'))).toEqual([]);
  });

  it('fails without touching the original when the file cannot be backed up', () => {
    const missing = join(dir, 'not-there.json');

    expect(() => new BackingUpConfigFile(at).replace(missing, 'x')).toThrow();
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  it('two replaces in the same second do not lose the first backup', () => {
    const file = new BackingUpConfigFile(at);

    file.replace(target, 'one');
    file.replace(target, 'two');

    // Same timestamp, so the second overwrites the first backup by design — what must NOT happen
    // is the original being lost, and the newest backup is always the state before the last write.
    expect(readFileSync(`${target}.bak-20260912-204012`, 'utf8')).toBe('one');
    expect(readFileSync(target, 'utf8')).toBe('two');
  });
});
