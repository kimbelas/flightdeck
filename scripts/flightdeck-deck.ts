// The deck's logon-task entry point — `node scripts/flightdeck-deck.ts` (P8-T1).
//
// Process concerns only, as `flightdeck-core.ts` is: what to run is `deck-launch.ts`'s decision.
// The child inherits stdio, so the task's `> .flightdeck-deck.log` redirect captures Next's own
// output, and this exits with the child's code so Task Scheduler's "last run result" is Next's.
//
// `spawn` with an argument array and no shell (CODING-STANDARDS §11) — the argv is built entirely
// from the repo path and constants.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildIdFile, deckLaunch } from './deck-launch.ts';

const repo = join(import.meta.dirname, '..');
const launch = deckLaunch(repo, existsSync(buildIdFile(repo)));

if (!launch.ok) {
  console.error(`flightdeck-deck: ${launch.reason}`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, [...launch.args], {
    cwd: repo,
    env: { ...process.env, ...launch.env },
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  // A stop that kills this process should not orphan the server holding 4949.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
}
