// `npm run task:install [-- --apply]` · `npm run task:remove [-- --apply]` — D21, SEC-OPS-3, P8-T1.
//
// **Dry run is the default and `--apply` is the opt-in**, exactly as `connect-cli.ts` has it, and
// for the same reason: every other safeguard in this feature is something the code does, and this
// one is something the code cannot do by accident. It registers tasks that start services at
// every logon — the owner should be able to run it once to see what it would do.
//
// It prints each definition in full. That is the whole point of `LogonTask.plan()`: the XML shown
// here is the XML that gets registered, not a description of it.
//
// **Both tasks, every time.** Core (D21) and the deck (P8-T1) are registered, replaced and removed
// together: one without the other is either hooks with no deck or a deck showing `core down`, and
// neither is a state anybody would choose. The deck may start before core — it already shows
// `core down` and reconnects on its own (P1-T9) — so there is no dependency between them.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  ephemeralDirectory,
  logonTaskCommand,
  logonTaskParts,
  LOGON_ROLES,
  type LogonRole,
  type LogonTaskDefinitionParts,
} from '../core/adapters/windows/logon-task-definition.ts';
import { SchtasksLogonTask } from '../core/adapters/windows/schtasks-logon-task.ts';
import { buildIdFile } from './deck-launch.ts';

const SYSTEM32 = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32');
const REPO = join(import.meta.dirname, '..');

/** `DOMAIN\account` — the trigger and the principal both name it, and icacls prints it the same. */
function account(): string {
  return execFileSync(join(SYSTEM32, 'whoami.exe'), [], { encoding: 'utf8' }).trim();
}

/**
 * The node these tasks should run, which is NOT `process.execPath`.
 *
 * A version manager hands each shell a shim in a directory named after that shell, and deletes it
 * with the shell; `realpathSync` resolves it to the installation behind it. See
 * `ephemeralDirectory` — this was found by reading the installer's own dry run.
 *
 * It resolves to a VERSION-PINNED path, and that is the right answer for a service: a later
 * `fnm use 27` leaves the tasks on the Node they were installed with rather than silently moving a
 * long-running receiver onto an untested runtime. `npm run task:install --apply` again is how you
 * move them, and `npm run doctor` is what notices the version drifted.
 */
function stableNodePath(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

function parts(role: LogonRole): LogonTaskDefinitionParts {
  // Not `process.execPath` — a scheduled task's PATH is not an interactive shell's, and the
  // shell's own node may not exist at logon (`stableNodePath`).
  return logonTaskParts(role, { account: account(), nodePath: stableNodePath(), repo: REPO });
}

function install(apply: boolean): number {
  for (const role of LOGON_ROLES) {
    const code = installOne(role, apply);
    if (code !== 0) return code;
  }
  if (!existsSync(buildIdFile(REPO))) {
    // Not a refusal: the task is right and the build is missing, and the task says so in its log.
    console.log(
      `  NOTE: there is no deck build yet. Run flightdeck.cmd once, or the deck task will`,
    );
    console.log(`  log "no production build" and exit at every logon until there is one.\n`);
  }
  if (!apply) {
    console.log(`  DRY RUN — nothing registered. Re-run with --apply to register both.`);
    console.log(`  Then npm run doctor, which checks the shape of what this wrote.\n`);
    return 0;
  }
  console.log(`  registered both. They start at the next logon; flightdeck.cmd starts them now.\n`);
  return 0;
}

function installOne(role: LogonRole, apply: boolean): number {
  const definition = parts(role);
  const ephemeral = ephemeralDirectory(definition.nodePath);
  if (ephemeral !== undefined) {
    // Fail closed, and print the path: a task registered against this would never start, and
    // "registered" is what an operator reads as "the receiver is guaranteed".
    console.error(`\n  REFUSED: ${definition.nodePath}`);
    console.error(`  is under ${ephemeral}, which does not survive a logon.`);
    console.error(
      `  Install Node somewhere permanent, or run this from a shell using that copy.\n`,
    );
    return 1;
  }
  const logon = new SchtasksLogonTask(definition);
  const replacing = logon.describe().installed
    ? 'already registered — this would REPLACE it'
    : 'not yet registered';
  console.log(`\n  task     ${definition.name}`);
  console.log(`  state    ${replacing}`);
  console.log(`  as       ${definition.account}, at every logon, never elevated (SEC-OPS-3)`);
  console.log(`\n  it runs:\n\n    cmd.exe ${logonTaskCommand(definition)}\n`);
  console.log(`  A console window appears at logon and stays for as long as it runs. That is the`);
  console.log(`  price of SEC-OPS-3: a task with no window has to store a credential (D21).\n`);
  console.log(logon.plan());
  console.log('');
  if (!apply) return 0;
  try {
    logon.install();
  } catch (cause) {
    console.error(`\n  FAILED: ${cause instanceof Error ? cause.message : 'unknown'}\n`);
    return 1;
  }
  console.log(`  registered "${definition.name}".\n`);
  return 0;
}

function remove(apply: boolean): number {
  for (const role of LOGON_ROLES) {
    const code = removeOne(role, apply);
    if (code !== 0) return code;
  }
  console.log(apply ? '' : `\n  DRY RUN — nothing removed. Re-run with --apply to remove them.\n`);
  return 0;
}

function removeOne(role: LogonRole, apply: boolean): number {
  const definition = parts(role);
  const logon = new SchtasksLogonTask(definition);
  if (!logon.describe().installed) {
    console.log(`\n  "${definition.name}" is not registered — nothing to do.`);
    return 0;
  }
  console.log(`\n  "${definition.name}" is registered and would be unregistered.`);
  if (!apply) return 0;
  try {
    logon.remove();
  } catch (cause) {
    console.error(`\n  FAILED: ${cause instanceof Error ? cause.message : 'unknown'}\n`);
    return 1;
  }
  // The process keeps running: unregistering a task never stops what it started.
  console.log(`  unregistered. What it started is untouched; flightdeck-stop.cmd ends it.`);
  return 0;
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
process.exitCode = argv.includes('remove') ? remove(apply) : install(apply);
