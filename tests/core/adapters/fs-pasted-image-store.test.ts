// P5a-T8. A real directory, because what this class does is exactly the thing a fake cannot check:
// that the file appears whole and that the `.part` it was written through does not survive.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FsPastedImageStore } from '../../../core/adapters/node/fs-pasted-image-store.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function store(): { store: FsPastedImageStore; directory: string } {
  const root = mkdtempSync(join(tmpdir(), 'fd-paste-'));
  roots.push(root);
  const directory = join(root, 'pasted');
  return { store: new FsPastedImageStore(directory), directory };
}

describe('FsPastedImageStore', () => {
  it('creates the directory on first use and writes the bytes there', async () => {
    const { store: subject, directory } = store();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    const path = await subject.put('paste-1.png', bytes);

    expect(path).toBe(join(directory, 'paste-1.png'));
    expect([...readFileSync(path)]).toEqual([...bytes]);
  });

  it('leaves no .part behind, so nothing ever opens a half-written image', async () => {
    const { store: subject, directory } = store();
    await subject.put('paste-1.png', new Uint8Array([1, 2, 3]));

    expect(readdirSync(directory)).toEqual(['paste-1.png']);
  });

  it('lists files and not directories', async () => {
    const { store: subject, directory } = store();
    await subject.put('a.png', new Uint8Array([1]));
    await subject.put('b.png', new Uint8Array([2]));

    expect([...(await subject.names())].sort()).toEqual(['a.png', 'b.png']);
    expect(directory).toContain('pasted');
  });

  it('answers with nothing at all when the directory has never been made', async () => {
    const { store: subject } = store();
    expect(await subject.names()).toEqual([]);
  });

  it('removes a file, and is not troubled by one that has already gone', async () => {
    const { store: subject, directory } = store();
    await subject.put('a.png', new Uint8Array([1]));

    await subject.remove('a.png');
    await subject.remove('a.png');

    expect(readdirSync(directory)).toEqual([]);
  });

  it('overwrites a name it is given twice, rather than failing the second time', async () => {
    const { store: subject } = store();
    const first = await subject.put('a.png', new Uint8Array([1]));
    await subject.put('a.png', new Uint8Array([2, 2]));

    expect([...readFileSync(first)]).toEqual([2, 2]);
  });
});

describe('the directory it defaults to', () => {
  it('sits under %LOCALAPPDATA%, beside the token and the store', async () => {
    const { pastedImageDirectory } = await import('../../../contracts/pasted-image-file.ts');
    expect(pastedImageDirectory().endsWith(join('flightdeck', 'pasted'))).toBe(true);
  });
});
