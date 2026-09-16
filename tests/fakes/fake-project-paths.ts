// In-memory `ProjectPaths` — the registry's one door, narrowed (CODING-STANDARDS §10.1).
//
// A real implementation of the contract rather than a stub: it canonicalises first and screens the
// RESULT, which is the order SEC-FS-1's junction check depends on and the thing a test of anything
// under a project root is actually about. What it cannot do is prove NTFS behaves that way —
// `tests/win/project-junction.test.ts` does that against a real `mklink /J`.
import { canonicalWindowsPath, isUnder, WINDOWS_SEPARATOR } from '../../contracts/windows-path.ts';
import type { ProjectPaths } from '../../core/application/git-directory-locator.ts';
import { err, ok, type Result } from '../../core/shared/result.ts';

export class FakeProjectPaths implements ProjectPaths {
  /** Every path this was asked about, in order — so a test can assert on a walk. */
  public readonly asked: string[] = [];
  private readonly roots: string[] = [];
  private readonly links = new Map<string, string>();

  /** An imported project root. Anything under it resolves; anything else is refused. */
  public root(path: string): this {
    this.roots.push(canonicalWindowsPath(path));
    return this;
  }

  /**
   * A junction or a symlink: asking for `path` comes back as `target`, and `target` is what gets
   * screened. The whole point of resolving before screening (SEC-FS-1).
   */
  public junction(path: string, target: string): this {
    this.links.set(canonicalWindowsPath(path), target);
    return this;
  }

  public resolve(path: string): Promise<Result<string, string>> {
    this.asked.push(path);
    const resolved = this.links.get(canonicalWindowsPath(path)) ?? path;
    const candidate = canonicalWindowsPath(resolved);
    if (!this.roots.some((root) => isUnder(candidate, root))) {
      return Promise.resolve(err('outside the config directories and every project'));
    }
    // Separators folded, never case: `realpath` answers in the filesystem's own spelling, and a
    // fake that handed back the forward slashes a `.git` pointer file uses would be a looser
    // contract than the adapter's.
    return Promise.resolve(ok(resolved.replaceAll('/', WINDOWS_SEPARATOR)));
  }
}
