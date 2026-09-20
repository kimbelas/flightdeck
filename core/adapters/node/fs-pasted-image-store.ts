// The `pasted/` directory on disk — P5a-T8, SEC-FS-4 and SEC-FS-5.
//
// The directory is created on first use rather than at boot, so a machine where nobody has ever
// pasted an image has no such folder. It sits INSIDE `%LOCALAPPDATA%\flightdeck`, which `buildCore`
// has already restricted to this user with an inheritable ACE (SEC-FS-4) — which is the reason
// this adapter sets no ACL of its own: one that did would be a second opinion about a directory
// that already has one, and the inheritable grant is what covers files nothing here creates
// directly.
//
// **Written temp-then-rename**, like every other write in this project (SEC-FS-3's shape). A
// session opens this path seconds after it is returned, and a partially written PNG is a worse
// answer than a slow one.
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pastedImageDirectory } from '../../../contracts/pasted-image-file.ts';
import type { PastedImageStore } from '../../ports/pasted-image-store.ts';

export class FsPastedImageStore implements PastedImageStore {
  private readonly directory: string;

  constructor(directory: string = pastedImageDirectory()) {
    this.directory = directory;
  }

  public async put(name: string, bytes: Uint8Array): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, name);
    const temporary = `${path}.part`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
    return path;
  }

  /** @throws never — a directory that is not there yet holds nothing, which is the honest answer. */
  public async names(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  public async remove(name: string): Promise<void> {
    // `join` of a name this class also generated: nothing from the wire reaches here, and
    // `PasteInbox.nextName` is the only thing that has ever named one (SEC-FS-5).
    await rm(join(this.directory, name), { force: true });
  }
}
