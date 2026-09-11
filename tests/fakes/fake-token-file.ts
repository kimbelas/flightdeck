// In-memory TokenFile — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// It records rather than asserts, so a test can say what it cares about. `failOnWrite` exists
// because "the token could not be written" is the one failure TokenIssuer must not swallow.
import type { TokenFile } from '../../core/ports/token-file.ts';

export class FakeTokenFile implements TokenFile {
  public written: string | undefined;
  public removals = 0;
  public failOnWrite = false;

  public write(token: string): void {
    if (this.failOnWrite) throw new Error('acl refused');
    this.written = token;
  }

  public remove(): void {
    this.removals += 1;
    this.written = undefined;
  }

  public location(): string {
    return 'C:\\fake\\flightdeck\\token';
  }
}
