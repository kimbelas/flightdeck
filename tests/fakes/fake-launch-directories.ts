// In-memory `LaunchDirectories` — CODING-STANDARDS §10.1, P10-T2.
//
// Admits every folder until it is told which roots exist, so the launcher tests that are about
// something else need not import a project first. `only` is the registry with those roots in it:
// containment by prefix, which is all the launcher needs to be tested against. The real rule —
// canonicalise first, then `isUnder` — is `ProjectRegistry`'s, and is tested there.
import type { LaunchDirectories } from '../../core/application/session-launcher.ts';
import { err, ok, type Result } from '../../core/shared/result.ts';

export class FakeLaunchDirectories implements LaunchDirectories {
  public readonly asked: string[] = [];
  private roots: readonly string[] | undefined;

  /** From now on, only folders under one of these are admitted. */
  public only(...roots: readonly string[]): this {
    this.roots = roots.map((root) => root.toLowerCase());
    return this;
  }

  public resolveDirectory(path: string): Promise<Result<string, string>> {
    this.asked.push(path);
    const key = path.toLowerCase();
    const admitted = this.roots?.some((root) => key === root || key.startsWith(`${root}\\`));
    return Promise.resolve(
      this.roots === undefined || admitted === true
        ? ok(path)
        : err('outside every imported project'),
    );
  }
}
