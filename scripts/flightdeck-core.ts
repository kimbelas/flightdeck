// The entry point — `node scripts/flightdeck-core.ts`, no build step (P0-T2).
//
// Everything here is process concerns: signals, exit codes, and the one line an operator reads.
// The service graph is built by core/main.ts, which knows nothing about any of it.
import { CORE_PORT } from '../contracts/origins.ts';
import { buildCore } from '../core/main.ts';

async function start(): Promise<void> {
  const core = buildCore();

  try {
    await core.server.listen(CORE_PORT);
  } catch (cause) {
    // Fail loudly and stay dead. A second core on another port would issue a second token and
    // serve a stale session list (SECURITY.md §7 rule 1).
    const reason = cause instanceof Error ? cause.message : 'unknown';
    console.error(`flightdeck-core could not bind 127.0.0.1:${String(CORE_PORT)} — ${reason}`);
    process.exitCode = 1;
    return;
  }

  // Only now: a core that could not bind has nothing to reconcile for (core/main.ts).
  core.reconciler.start();
  // Before anything else can be the first request: SEC-ING-2's 5 ms budget is missed by the first
  // one after boot and by no other (RESEARCH.md F.1.4), and a hook is a bad thing to be first.
  await core.warmUp();

  console.log(`flightdeck-core listening on 127.0.0.1:${String(CORE_PORT)}`);
  console.log(`token: ${core.tokenPath}`);
  // Named, not assumed: `claude` is not on PATH, and a pane on a session cannot open without it.
  console.log(`claude: ${core.claudePath ?? 'NOT FOUND — session panes will refuse to open'}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void core.shutdown().then(() => process.exit(0));
    });
  }
}

void start();
