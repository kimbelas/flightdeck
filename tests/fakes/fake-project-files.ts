// In-memory ProjectFiles — CODING-STANDARDS §10.1.
//
// A tiny filesystem described by two maps: what is in a directory, and what a file contains. Paths
// are matched case-insensitively with both separators folded, because every real caller hands over
// a path `realpath` produced and a test writes whichever one reads better.
import { canonicalWindowsPath } from '../../contracts/windows-path.ts';
import type { FileFacts, ProjectFiles } from '../../core/ports/project-files.ts';

export class FakeProjectFiles implements ProjectFiles {
  public readonly listed: string[] = [];
  private readonly directories = new Map<string, readonly string[]>();
  private readonly files = new Map<string, string>();
  private readonly times = new Map<string, number>();

  /** A directory holding these entry names. */
  public directory(path: string, entries: readonly string[], modifiedAt = 0): void {
    this.directories.set(canonicalWindowsPath(path), entries);
    this.times.set(canonicalWindowsPath(path), modifiedAt);
  }

  /** A file with this text. */
  public file(path: string, text: string, modifiedAt = 0): void {
    this.files.set(canonicalWindowsPath(path), text);
    this.times.set(canonicalWindowsPath(path), modifiedAt);
  }

  /** Moves a file's mtime, which is what a cache signature is meant to notice. */
  public touch(path: string, modifiedAt: number): void {
    this.times.set(canonicalWindowsPath(path), modifiedAt);
  }

  public list(directory: string, maxEntries: number): Promise<readonly string[]> {
    this.listed.push(directory);
    return Promise.resolve(
      (this.directories.get(canonicalWindowsPath(directory)) ?? []).slice(0, maxEntries),
    );
  }

  public facts(path: string): Promise<FileFacts | undefined> {
    const key = canonicalWindowsPath(path);
    const isDirectory = this.directories.has(key);
    if (!isDirectory && !this.files.has(key)) return Promise.resolve(undefined);
    return Promise.resolve({ isDirectory, modifiedAt: this.times.get(key) ?? 0 });
  }

  public read(path: string, maxBytes: number): Promise<string | undefined> {
    const text = this.files.get(canonicalWindowsPath(path));
    return Promise.resolve(text === undefined ? undefined : text.slice(0, maxBytes));
  }
}
