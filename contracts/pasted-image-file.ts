// Where a pasted image lands — P5a-T8, SEC-FS-5.
//
// `%LOCALAPPDATA%\flightdeck\pasted`, beside the token, the ingest key and the store. Not `$CFG`,
// where Flightdeck writes two settings blocks and nothing else (D13, SEC-FS-3), and not the repo,
// which is public (D23). Split out of pasted-image.ts because this file imports `node:path` and
// that one is bundled into the page — the same split, for the same reason, as store-file.ts.
import { join } from 'node:path';

/**
 * The directory pasted images are written to.
 *
 * Falls back to the working directory when `LOCALAPPDATA` is absent, matching `storeFile()` and
 * `coreTokenFile()`: a CI container has no profile, and a helper that threw at import time would
 * take the process with it.
 */
export function pastedImageDirectory(): string {
  return join(process.env['LOCALAPPDATA'] ?? process.cwd(), 'flightdeck', 'pasted');
}
