// SEC-HTTP-7 — the credential a long-lived Claude Code session carries, and where it lives.
//
// It exists because of one measured fact (RESEARCH.md F.1.7): a hook's `Authorization` header is
// interpolated from the *session process's* environment, which is fixed when the session is
// spawned. A per-boot token (SEC-HTTP-3) therefore cannot reach a session that started before the
// current boot of core — and a stale bearer is not a silent degradation, it is a `401`, which is
// `Stop hook error occurred · ctrl+o to see` in front of the owner for every turn afterwards
// (RESEARCH.md F.1.5). A secret a client cannot re-read must not rotate under it.
//
// So the ingest key is **stable per install** and narrow: `POST /hooks` accepts it and nothing
// else does. It cannot launch a session, cannot read `/sessions`, cannot mint a PTY ticket. The
// statusLine block does not use it and does not need to — it re-reads the token file on every
// render (SEC-ING-3), so per-boot costs it nothing.
//
// It sits in contracts/ for the same reason core-token.ts does: it is the one definition of the
// path, and more than one process has to agree about it.
//
// **Server-only.** It touches node:fs, so nothing under a 'use client' boundary may import it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Written once by core, with the same per-user ACL as the token (SEC-FS-4). */
export function ingestKeyFile(): string {
  const override = process.env['FD_INGEST_KEY_FILE'];
  if (override !== undefined && override !== '') return override;
  return join(process.env['LOCALAPPDATA'] ?? process.cwd(), 'flightdeck', 'ingest-key');
}

/**
 * The environment variable Connect names in the hooks block, and the launcher exports.
 *
 * Named here rather than in the planner because two sides have to agree on the spelling: what
 * Connect writes into `settings.json` as `${FLIGHTDECK_TOKEN}`, and what puts a value there. A
 * name Claude Code does not find is interpolated to the empty string rather than left alone
 * (RESEARCH.md F.1.6), so a typo is a 401 rather than an error anyone can read.
 */
export const INGEST_KEY_ENV_VAR = 'FLIGHTDECK_TOKEN';

/**
 * The current ingest key, or `undefined` when core has never run on this machine.
 *
 * Absence is not an error for the same reason `readCoreToken` says so: not connected is an
 * ordinary state, and every caller fails closed on it.
 */
export function readIngestKey(): string | undefined {
  try {
    const key = readFileSync(/* turbopackIgnore: true */ ingestKeyFile(), 'utf8').trim();
    return key === '' ? undefined : key;
  } catch {
    return undefined;
  }
}
