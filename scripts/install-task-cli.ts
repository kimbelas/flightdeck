// `npm run task:install [-- --apply]` · `npm run task:remove [-- --apply]` — D21, SEC-OPS-3.
//
// **Dry run is the default and `--apply` is the opt-in**, exactly as `connect-cli.ts` has it, and
// for the same reason: every other safeguard in this feature is something the code does, and this
// one is something the code cannot do by accident. It registers a task that starts a service at
// every logon — the owner should be able to run it once to see what it would do.
//
// It prints the definition in full. That is the whole point of `LogonTask.plan()`: the XML shown
// here is the XML that gets registered, not a description of it.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  ephemeralDirectory,
  logonTaskCommand,
  LOGON_TASK_NAME,
  type LogonTaskDefinitionParts,
} from '../core/adapters/windows/logon-task-definition.ts';
import { SchtasksLogonTask } from '../core/adapters/windows/schtasks-logon-task.ts';

const SYSTEM32 = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32');

/** `DOMAIN\account` — the trigger and the principal both name it, and icacls prints it the same. */
function account(): string {
  return execFileSync(join(SYSTEM32, 'whoami.exe'), [], { encoding: 'utf8' }).trim();
}

/**
 * The node this task should run, which is NOT `process.execPath`.
 *
 * A version manager hands each shell a shim in a directory named after that shell, and deletes it
 * with the shell; `realpathSync` resolves it to the installation behind it. See
 * `ephemeralDirectory` — this was found by reading the installer's own dry run.
 *
 * It resolves to a VERSION-PINNED path, and that is the right answer for a service: a later
 * `fnm use 27` leaves the task on the Node it was installed with rather than silently moving a
 * long-running receiver onto an untested runtime. `npm run task:install --apply` again is how you
 * move it, and `npm run doctor` is what notices the version drifted.
 */
function stableNodePath(): string {
  try {
    return realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

function parts(): LogonTaskDefinitionParts {
  const repo = join(import.meta.dirname, '..');
  return {
    account: account(),
    // Not `process.execPath` — a scheduled task's PATH is not an interactive shell's, and the
    // shell's own node may not exist at logon (`stableNodePath`).
    nodePath: stableNodePath(),
    scriptPath: join(repo, 'scripts', 'flightdeck-core.ts'),
    workingDirectory: repo,
    logPath: join(repo, '.flightdeck-core.log'),
  };
}

function install(apply: boolean): number {
  const definition = parts();
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
  const state = logon.describe();
  const replacing = state.installed
    ? 'already registered — this would REPLACE it'
    : 'not yet registered';
  console.log(`\n  task     ${LOGON_TASK_NAME}`);
  console.log(`  state    ${replacing}`);
  console.log(`  as       ${definition.account}, at every logon, never elevated (SEC-OPS-3)`);
  console.log(`\n  it runs:\n\n    cmd.exe ${logonTaskCommand(definition)}\n`);
  console.log(
    `  A console window appears at logon and stays for as long as core runs. That is the`,
  );
  console.log(`  price of SEC-OPS-3: a task with no window has to store a credential (D21).\n`);
  console.log(logon.plan());
  if (!apply) {
    console.log(`\n  DRY RUN — nothing registered. Re-run with --apply to register it.`);
    console.log(`  Then npm run doctor, which checks the shape of what this wrote.\n`);
    return 0;
  }
  try {
    logon.install();
  } catch (cause) {
    console.error(`\n  FAILED: ${cause instanceof Error ? cause.message : 'unknown'}\n`);
    return 1;
  }
  console.log(`\n  registered. It starts core at the next logon; flightdeck.cmd starts it now.\n`);
  return 0;
}

function remove(apply: boolean): number {
  const logon = new SchtasksLogonTask(parts());
  if (!logon.describe().installed) {
    console.log(`\n  "${LOGON_TASK_NAME}" is not registered — nothing to do.\n`);
    return 0;
  }
  console.log(`\n  "${LOGON_TASK_NAME}" is registered and would be unregistered.`);
  if (!apply) {
    console.log(`\n  DRY RUN — nothing removed. Re-run with --apply to remove it.\n`);
    return 0;
  }
  try {
    logon.remove();
  } catch (cause) {
    console.error(`\n  FAILED: ${cause instanceof Error ? cause.message : 'unknown'}\n`);
    return 1;
  }
  // Core keeps running: unregistering the task never stops the process it started.
  console.log(
    `\n  unregistered. A core already running is untouched; flightdeck-stop.cmd ends it.\n`,
  );
  return 0;
}

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
process.exitCode = argv.includes('remove') ? remove(apply) : install(apply);
