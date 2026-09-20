// In-memory ConfigFile — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// It records the ORDER of operations, because that order is the control: SEC-FS-3 says back up
// before replacing, and a test that only checked the final contents would pass on an adapter that
// backed up afterwards.
import type { ConfigFile } from '../../core/ports/config-file.ts';

export class FakeConfigFile implements ConfigFile {
  public readonly files = new Map<string, string>();
  public readonly operations: string[] = [];
  public failOn: string | undefined;

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, contents] of Object.entries(initial)) this.files.set(path, contents);
  }

  public read(path: string): string | undefined {
    return this.files.get(path);
  }

  /** No `backup` line, deliberately: a test asserting the order must see that there was none. */
  public create(path: string, contents: string): void {
    if (this.failOn === path) throw new Error('disk full');
    this.operations.push(`create ${path}`);
    this.files.set(path, contents);
  }

  public replace(path: string, contents: string): string {
    if (this.failOn === path) throw new Error('disk full');
    const backup = `${path}.bak-fake`;
    this.operations.push(`backup ${path}`);
    this.operations.push(`write ${path}`);
    this.files.set(path, contents);
    return backup;
  }
}
