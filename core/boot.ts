// The four boot steps `buildCore` runs before it composes anything: the data directory's ACL, the
// two secrets, the guard and the version. Lifted out of main.ts for its 250-line limit when P11-T0
// threaded the port through; none of them is composition, and each is called exactly once.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ingestKeyFile } from '../contracts/ingest-key.ts';
import { UI_ORIGIN } from '../contracts/origins.ts';
import { storeFile } from '../contracts/store-file.ts';
import { IngestKeyIssuer } from './application/ingest-key-issuer.ts';
import { TokenIssuer } from './application/token-issuer.ts';
import { WindowsFileAcl } from './adapters/windows/windows-file-acl.ts';
import { WindowsTokenFile } from './adapters/windows/windows-token-file.ts';
import { BUDGETS } from './http/limits.ts';
import { LoopbackGuard } from './http/loopback-guard.ts';

export interface Secrets {
  readonly tokenFile: WindowsTokenFile;
  readonly issuer: TokenIssuer;
  readonly token: string;
  readonly ingestKey: string;
}

/**
 * The two secrets, which differ in exactly one way that matters: one is per boot and one is not.
 *
 * The token is issued fresh and revoked on shutdown (SEC-HTTP-3). The ingest key is read-or-create
 * and is NOT revoked — it is the one secret that outlives the process, so a session that started
 * three restarts ago still authenticates its hooks (SEC-HTTP-7, RESEARCH.md F.1.7).
 */
export function issueSecrets(): Secrets {
  const tokenFile = new WindowsTokenFile();
  const issuer = new TokenIssuer(tokenFile);
  const token = issuer.issue();
  const ingestKey = new IngestKeyIssuer(new WindowsTokenFile(ingestKeyFile())).ensure();
  return { tokenFile, issuer, token, ingestKey };
}

/**
 * One screen for every inbound connection, promoted from the P0-T7 probe unchanged.
 *
 * The body limit here is the CONTROL cap. Core enforces the per-route caps itself (limits.ts) now
 * that a hook may send 4 MB and a launch may not; this keeps the guard's own answer agreeing with
 * what the server does.
 */
export function buildGuard(token: string, ingestKey: string, port: number): LoopbackGuard {
  return new LoopbackGuard({
    port,
    uiOrigin: UI_ORIGIN,
    token,
    ingestKey,
    bodyLimitBytes: BUDGETS.control.bodyBytes,
  });
}

/**
 * Restricts `%LOCALAPPDATA%\flightdeck` to this user, creating it if it is not there.
 *
 * The directory is derived from the store's path rather than spelled again: three contracts
 * already agree about this folder and a fourth opinion is how they stop agreeing
 * (contracts/store-file.ts). It is created here rather than relied upon, so this does not depend
 * on the token having been written first — an ordering that is true today and is not a contract.
 */
export function restrictDataDirectory(): void {
  const directory = dirname(storeFile());
  mkdirSync(directory, { recursive: true });
  new WindowsFileAcl().restrictDirectory(directory);
}

export function readVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );
  if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
    const { version } = manifest;
    if (typeof version === 'string') return version;
  }
  return '0.0.0';
}
