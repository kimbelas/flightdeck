// `node scripts/connect-cli.ts [connect|disconnect] [--apply]` — P1-T11, D13.
//
// **Dry run is the default and `--apply` is the opt-in**, not the other way round. Every other
// safeguard in this feature is a thing the code does; this one is a thing the code cannot do by
// accident, and it is the reason the owner can run this command without reading it first.
//
// It prints a whole unified diff per file, names the backup each write will produce, and refuses
// out loud. It never prints the token or the ingest key (SEC-DATA-4) — the hooks block it writes
// contains `${FLIGHTDECK_TOKEN}`, a name, so the diff is safe to paste anywhere.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConnectPlan } from '../contracts/connect-plan.ts';
import { INGEST_KEY_ENV_VAR, ingestKeyFile } from '../contracts/ingest-key.ts';
import { ClaudeInstall } from '../core/adapters/claude-cli/claude-install.ts';
import { ConsoleLogger } from '../core/adapters/console-logger.ts';
import { BackingUpConfigFile } from '../core/adapters/node/backing-up-config-file.ts';
import { HttpCoreHealth } from '../core/adapters/node/http-core-health.ts';
import { UserEnvironmentVariable } from '../core/adapters/windows/user-environment-variable.ts';
import { Connector, type Direction } from '../core/application/connector.ts';
import { unifiedDiff } from '../core/shared/text-diff.ts';
import { StatuslinePatcher } from './statusline-patch.ts';

/**
 * The shared statusline.py both subscriptions' `statusLine.command` point at.
 *
 * `~/.claude/hooks/`, the legacy config dir, which D14 keeps visible for exactly this reason: both
 * live configs reference it. It is patched once, not once per subscription.
 */
function statuslinePath(): string {
  return join(homedir(), '.claude', 'hooks', 'statusline.py');
}

function buildConnector(): Connector {
  const install = new ClaudeInstall();
  return new Connector({
    files: new BackingUpConfigFile(),
    health: new HttpCoreHealth(),
    patcher: StatuslinePatcher.fromRepo(),
    environment: new UserEnvironmentVariable(),
    settingsPaths: [
      { subscription: '365', path: join(install.configDirFor('365'), 'settings.json') },
      { subscription: 'isg', path: join(install.configDirFor('isg'), 'settings.json') },
    ],
    statuslinePath: statuslinePath(),
    logger: new ConsoleLogger(),
  });
}

function printPlan(direction: Direction, plan: ConnectPlan): void {
  if (!plan.ok) {
    console.log(`\n${direction} REFUSED:\n`);
    for (const refusal of plan.refusals) console.log(`  ${refusal.path}\n    ${refusal.reason}`);
    return;
  }
  for (const label of plan.alreadyDone) console.log(`  unchanged — ${label}`);
  if (plan.environment !== 'none') {
    console.log(`
  ${plan.environment} — ${plan.environmentLabel}`);
  }
  if (plan.changes.length === 0 && plan.environment === 'none') {
    console.log(
      `\nnothing to do: already ${direction === 'connect' ? 'connected' : 'disconnected'}`,
    );
    return;
  }
  for (const change of plan.changes) {
    console.log(`\n--- ${change.label}`);
    console.log(`--- ${change.path}`);
    console.log(unifiedDiff(change.before, change.after));
  }
}

async function run(direction: Direction, apply: boolean): Promise<number> {
  const connector = buildConnector();
  const plan = connector.plan(direction);
  printPlan(direction, plan);
  if (!plan.ok) return 1;

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write it.`);
    if (direction === 'connect') {
      console.log(`The header resolves from $${INGEST_KEY_ENV_VAR}; its value lives in`);
      console.log(`  ${ingestKeyFile()}`);
      console.log(`Terminals already open will not see it — sessions started from a NEW one will.`);
    }
    return 0;
  }

  const outcome = await connector.apply(direction, plan);
  for (const change of outcome.applied) {
    console.log(`\nwrote   ${change.path}`);
    console.log(`backup  ${change.backup}`);
  }
  if (!outcome.ok) {
    console.error(`\n${direction} FAILED: ${outcome.reason}`);
    return 1;
  }
  console.log(`\n${direction} done.`);
  return 0;
}

const argv = process.argv.slice(2);
const direction: Direction = argv.includes('disconnect') ? 'disconnect' : 'connect';
void run(direction, argv.includes('--apply')).then((code) => {
  process.exitCode = code;
});
