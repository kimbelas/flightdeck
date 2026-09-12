// Removes the per-boot token file — the half of "stopped" a forced kill cannot do itself (P1-T6).
//
// Core deletes it in `stopCore` on a clean shutdown, and that is the right place for it. But the
// normal way Flightdeck stops on this machine is `flightdeck-stop.cmd`, which is `taskkill /F`:
// TerminateProcess runs no handler, so the token survives the stop that was supposed to end it.
//
// **Why a surviving token is worse than untidy.** The statusLine block reads this file first and
// returns before importing anything if it is absent — a disconnected machine pays 0.10 ms per
// render. With the file present and nothing listening, every render instead pays **51 ms**,
// because a closed loopback port is not refused to Python here, it is dropped (RESEARCH.md F.3.3).
// So a stale token quietly taxes every keystroke in every interactive session on the machine,
// for as long as it sits there.
//
// It reads the path from `contracts/core-token.ts` rather than spelling it, for the same reason
// proxy.ts does: the deck, core and this script have to agree about where it is, and the only way
// to guarantee that is one definition.
import { rmSync } from 'node:fs';
import { coreTokenFile } from '../contracts/core-token.ts';

const path = coreTokenFile();

try {
  rmSync(path, { force: true });
} catch {
  // `force: true` already swallows "not there". Anything left is a permissions problem, and a stop
  // script is not the place to argue about it — the ports are down either way.
  console.error(`could not remove ${path}`);
  process.exitCode = 1;
}
