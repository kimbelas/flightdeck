// What the deck's logon task runs, decided — P8-T1, SEC-NET-1, SEC-NET-2.
//
// **`next start`, never `next build`.** Building is `flightdeck.cmd`'s job, because a build fails in
// ways a person has to read (a type error, a missing dependency), and a logon task has nobody
// watching. So this serves the `.next` that is already there, and when there is none it says so
// once and exits — Task Scheduler restarts nothing (the settings in logon-task-definition.ts), so
// "reports rather than loops" is a property of exiting, not of any retry logic here.
//
// **The address is a constant, not an argument.** `next start` defaults to `0.0.0.0` and put the
// deck on the LAN once already (RESEARCH.md G.6). `-H 127.0.0.1` is written here from
// `LOOPBACK_ADDRESS` and nothing the task passes can change it; `doctor` then checks the address
// the deck actually bound, the way `flightdeck.cmd` does, because a flag in a file is a claim and a
// `netstat` line is a measurement.
//
// **Telemetry is off in the child's environment** (SEC-NET-2), set here rather than by
// `next telemetry disable`, which writes a per-user global and so would not travel with the repo.
//
// Split the way doctor is: this file decides, `flightdeck-deck.ts` touches the machine.
import { join } from 'node:path';
import { LOOPBACK_ADDRESS, UI_PORT } from '../contracts/origins.ts';

export type DeckLaunch =
  | {
      readonly ok: true;
      /** `node` runs Next's own bin by path — no `npm`, no shell, no PATH lookup at logon. */
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The launch, or why there is none.
 *
 * `buildPresent` is whether `.next/BUILD_ID` exists — the file `next start` itself refuses to run
 * without, checked first so the log says what to do rather than printing Next's stack.
 */
export function deckLaunch(repo: string, buildPresent: boolean): DeckLaunch {
  if (!buildPresent) {
    return {
      ok: false,
      reason:
        `no production build at ${join(repo, '.next')} - the deck task serves a build and never ` +
        `makes one. Run flightdeck.cmd once (it builds), then the task serves it from the next logon.`,
    };
  }
  return {
    ok: true,
    args: [
      join(repo, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      '-H',
      LOOPBACK_ADDRESS,
      '-p',
      String(UI_PORT),
    ],
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  };
}

/** The file whose absence means "never built" — what `next start` checks, and `doctor` too. */
export function buildIdFile(repo: string): string {
  return join(repo, '.next', 'BUILD_ID');
}
