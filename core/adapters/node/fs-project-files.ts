// Looking inside an imported project with `node:fs` — P3-T2, SEC-FS-1.
//
// Three small reads and no cleverness. What is worth saying is what this class deliberately does
// NOT do: it does not compose a path, it does not screen one, and it does not walk anywhere. It
// opens exactly what it is handed, which has already been through `ProjectRegistry.resolve`.
//
// **`readdir` is capped by the caller and truncated here rather than filtered.** A project root is
// the owner's own repository and may hold anything; the caller wants five filenames out of it, and
// reading 50 000 `Dirent` objects to answer "is there a package.json" would be the slowest part of
// the whole feature. `withFileTypes` is not used for the same reason — the names are all the stack
// markers need, and asking for types is a `lstat` per entry.
import { open, readdir, stat } from 'node:fs/promises';
import type { FileFacts, ProjectFiles } from '../../ports/project-files.ts';

export class FsProjectFiles implements ProjectFiles {
  /** @throws never — a directory that cannot be listed is an empty one to the caller. */
  public async list(directory: string, maxEntries: number): Promise<readonly string[]> {
    try {
      return (await readdir(directory)).slice(0, maxEntries);
    } catch {
      // Gone, never there, or on a drive that is not plugged in. All three draw the same panel.
      return [];
    }
  }

  /** @throws never — absence and failure are one answer. */
  public async facts(path: string): Promise<FileFacts | undefined> {
    try {
      const facts = await stat(path);
      return {
        isDirectory: facts.isDirectory(),
        // Whole seconds — see `FileFacts.modifiedAt` for why the precision is dropped here.
        modifiedAt: Math.trunc(facts.mtimeMs / 1000),
      };
    } catch {
      return undefined;
    }
  }

  /** @throws never. */
  public async read(path: string, maxBytes: number): Promise<string | undefined> {
    try {
      return await this.head(path, maxBytes);
    } catch {
      return undefined;
    }
  }

  /**
   * Opens FIRST, then reads from the open descriptor.
   *
   * `stat` then `open` is a time-of-check / time-of-use race — the path can be replaced between
   * the two calls — and `FsJobFiles` was changed to this shape for the same reason CodeQL gave
   * there. One descriptor, one path resolution.
   */
  private async head(path: string, maxBytes: number): Promise<string> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
}
