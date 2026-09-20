// In-memory PastedImageStore — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// It keeps the WRITE ORDER as well as the contents, because the retention cap is the behaviour
// under test and "which file went" is the whole question. `failNames` exists for the one branch
// `PasteInbox` swallows: a directory it cannot list must not turn a written image into a refusal.
import { win32 } from 'node:path';
import type { PastedImageStore } from '../../core/ports/pasted-image-store.ts';

export class FakePastedImageStore implements PastedImageStore {
  /** A plausible Windows directory, so a test can assert the whole path rather than a suffix. */
  public static readonly DIRECTORY = String.raw`C:\pasted`;

  public failNames = false;
  public readonly written: string[] = [];
  public readonly removed: string[] = [];
  private readonly files = new Map<string, Uint8Array>();

  public get count(): number {
    return this.files.size;
  }

  public async put(name: string, bytes: Uint8Array): Promise<string> {
    this.files.set(name, bytes);
    this.written.push(name);
    return Promise.resolve(win32.join(FakePastedImageStore.DIRECTORY, name));
  }

  public async names(): Promise<readonly string[]> {
    if (this.failNames) throw new Error('directory is gone');
    return Promise.resolve([...this.files.keys()]);
  }

  public async remove(name: string): Promise<void> {
    this.files.delete(name);
    this.removed.push(name);
    return Promise.resolve();
  }

  public bytesOf(name: string): Uint8Array | undefined {
    return this.files.get(name);
  }
}
