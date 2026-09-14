// Where the durable store lives — DECISIONS.md D9, SEC-DATA-1.
//
// `%LOCALAPPDATA%\flightdeck\flightdeck.db`, next to the token and the ingest key. **Outside the
// repo and outside `$CFG`**, and both halves of that matter: the repo is public (D23), and
// `~\.claude-*` is Claude Code's, where Flightdeck writes two settings blocks and nothing else
// (D13, SEC-FS-3).
//
// It is the only durable history there is. `cleanupPeriodDays` deletes transcripts after 30 days,
// so a question about what happened six weeks ago can only be answered from here (D9).
import { join } from 'node:path';

/**
 * The database path.
 *
 * Falls back to the working directory when `LOCALAPPDATA` is absent — the same fallback as
 * `coreTokenFile`, for the same reason: a test runner and a CI container have no profile, and a
 * store that threw at import time would take the whole process with it.
 */
export function storeFile(): string {
  return join(process.env['LOCALAPPDATA'] ?? process.cwd(), 'flightdeck', 'flightdeck.db');
}
