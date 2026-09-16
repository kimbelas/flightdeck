// In-memory `PathCanonicaliser` — CODING-STANDARDS §10.1.
//
// A real implementation of the port over a map, not a stub: what the adapter buys is that two
// spellings of one folder come back as the same string, and that a junction comes back as its
// target. Both are expressible here, and both are what the registry's tests are actually about.
//
// What it deliberately does NOT do is prove that `realpath` behaves that way on NTFS. A fake can
// only honour a contract, never establish one, so the platform half lives in
// `tests/win/project-junction.test.ts` against a real `mklink /J` junction.
import { canonicalWindowsPath } from '../../contracts/windows-path.ts';
import type { CanonicalPath, PathCanonicaliser } from '../../core/ports/path-canonicaliser.ts';

export class FakePathCanonicaliser implements PathCanonicaliser {
  private readonly known = new Map<string, CanonicalPath>();

  /** Registers a folder: asking for it, in any casing or with either separator, resolves here. */
  public directory(path: string, resolvesTo: string = path): this {
    this.known.set(canonicalWindowsPath(path), { path: resolvesTo, isDirectory: true });
    return this;
  }

  /** The same for a file, so `not_a_directory` is a case a test can actually reach. */
  public file(path: string, resolvesTo: string = path): this {
    this.known.set(canonicalWindowsPath(path), { path: resolvesTo, isDirectory: false });
    return this;
  }

  /**
   * A junction: `path` exists, and resolves to somewhere else entirely.
   *
   * Named rather than spelled as `directory(a, b)` at each call site, because the point of the
   * cases that use it is that the two strings differ — and a reader should not have to notice that
   * from argument order.
   */
  public junction(path: string, target: string): this {
    return this.directory(path, target);
  }

  public canonicalise(path: string): Promise<CanonicalPath | undefined> {
    return Promise.resolve(this.known.get(canonicalWindowsPath(path)));
  }
}
