// The ingest key as a user-level environment variable, so sessions inherit it (SEC-HTTP-7).
//
// `setx` rather than the registry directly: it is the documented way to write HKCU\Environment and
// it broadcasts `WM_SETTINGCHANGE`, which is what lets a shell started afterwards see the value
// without a sign-out. Named by full path for the same reason icacls is in WindowsTokenFile — a
// PATH entry must not decide what runs.
//
// **A shell that is already open will not see it.** Windows hands a process its environment at
// creation and never revisits it, so terminals the owner already had need reopening once. Once,
// ever: the key is stable by design, which is the entire point of SEC-HTTP-7.
//
// The key itself is read here and nowhere else in this path. It is never returned, logged or
// printed (SEC-DATA-4) — `isPublished` compares and answers a boolean.
import { execFileSync } from 'node:child_process';
import { INGEST_KEY_ENV_VAR, ingestKeyFile, readIngestKey } from '../../../contracts/ingest-key.ts';
import type { SessionEnvironment } from '../../ports/session-environment.ts';

const SYSTEM32 = `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32`;
const SETX = `${SYSTEM32}\\setx.exe`;
const REG = `${SYSTEM32}\\reg.exe`;

export class UserEnvironmentVariable implements SessionEnvironment {
  private readonly name: string;

  constructor(name: string = INGEST_KEY_ENV_VAR) {
    this.name = name;
  }

  /**
   * Compares the stored value against the key. Both absent is `false`, not "in agreement" —
   * there is nothing published, so a session would carry nothing.
   */
  public isPublished(): boolean {
    const key = readIngestKey();
    if (key === undefined) return false;
    return this.stored() === key;
  }

  /** @throws if there is no ingest key to publish, or if setx refuses. */
  public publish(): void {
    const key = readIngestKey();
    if (key === undefined) {
      throw new Error(`there is no ingest key at ${ingestKeyFile()} — start core once first`);
    }
    execFileSync(SETX, [this.name, key], { stdio: 'ignore' });
  }

  /** Deletes the value. `reg delete` on a name that is not there exits non-zero, which is fine. */
  public withdraw(): void {
    try {
      execFileSync(REG, ['delete', 'HKCU\\Environment', '/v', this.name, '/f'], {
        stdio: 'ignore',
      });
    } catch {
      // Already gone. Disconnect must not fail because there was nothing left to undo.
    }
  }

  public describe(): string {
    return `$${this.name} (user environment) ← ${ingestKeyFile()}`;
  }

  /** The value Windows has, or `undefined`. A missing name and a failed read are one answer. */
  private stored(): string | undefined {
    try {
      // stderr is discarded rather than inherited: `reg query` writes "unable to find the
      // specified registry key or value" to it when the name is simply not set yet, which is the
      // ordinary answer on a first Connect and not something an operator should be shown.
      const out = execFileSync(REG, ['query', 'HKCU\\Environment', '/v', this.name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // `    NAME    REG_SZ    <value>` — the value is whatever follows the type, trimmed.
      const match = /REG_(?:SZ|EXPAND_SZ)\s+(\S+)/.exec(out);
      return match?.[1];
    } catch {
      return undefined;
    }
  }
}
