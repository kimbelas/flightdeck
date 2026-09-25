// `npm run doctor` — looks everything up, prints the verdicts, exits non-zero on a failure.
//
// SEC-OPS-1. The verdicts are in doctor.ts and are pure; this is the half that touches the
// machine, which is also why it is the half with no tests (CODING-STANDARDS §10.2: what needs the
// real OS is proven by tests/win/** or by running it).
//
// **It writes nothing.** Every call here is a read: `netstat`, `icacls`, `schtasks /query`,
// `claude --version`, whether `.next/BUILD_ID` exists, an in-memory SQLite database,
// `Connector.plan` (which is the dry-run half of Connect by construction, P1-T11), and a sample of
// transcripts. A health check that repaired things would be a health check nobody dares run.
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_PORT, UI_PORT } from '../contracts/origins.ts';
import { ingestKeyFile } from '../contracts/ingest-key.ts';
import { storeFile } from '../contracts/store-file.ts';
import { coreTokenFile } from '../contracts/core-token.ts';
import { SUBSCRIPTION_IDS } from '../contracts/session.ts';
import { ClaudeInstall } from '../core/adapters/claude-cli/claude-install.ts';
import { ConsoleLogger } from '../core/adapters/console-logger.ts';
import { WindowsFileAcl } from '../core/adapters/windows/windows-file-acl.ts';
import { SchtasksLogonTask } from '../core/adapters/windows/schtasks-logon-task.ts';
import { logonTaskParts, type LogonRole } from '../core/adapters/windows/logon-task-definition.ts';
import type { LogonTaskState } from '../core/ports/logon-task.ts';
import { buildIdFile } from './deck-launch.ts';
import type { Connector } from '../core/application/connector.ts';
import { buildConnector } from '../core/connect.ts';
import { ReadPolicy } from '../core/domain/read-policy.ts';
import { readStatus } from './core-status.ts';
import { recentTranscripts, allTranscripts, readWhole } from './transcript-probe.ts';
import {
  aclCheck,
  claudeCheck,
  counterCheck,
  deckBuildCheck,
  exitCodeFor,
  fts5Check,
  hooksCheck,
  loopbackCheck,
  logonTaskCheck,
  nodeCheck,
  renderChecks,
  secretsCheck,
  transcriptCheck,
  type Check,
} from './doctor.ts';

const SYSTEM32 = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32');

/** Enough to see a new record type from the current Claude Code, cheap enough to run often. */
const TRANSCRIPT_SAMPLE = 15;

const install = new ClaudeInstall();
const acl = new WindowsFileAcl();

const REPO = join(import.meta.dirname, '..');

async function main(): Promise<number> {
  const coreTask = logonTask('core');
  const deckTask = logonTask('deck');
  const checks: Check[] = [
    nodeCheck(process.version, engines()),
    claudeCheck(install.executable, claudeVersion()),
    ...portChecks(deckTask.installed),
    ...aclChecks(),
    secretsCheck(policy(), secretCandidates()),
    hooksCheck(connector().plan('connect')),
    logonTaskCheck(coreTask, 'logon: core'),
    logonTaskCheck(deckTask, 'logon: deck'),
    deckBuildCheck(existsSync(buildIdFile(REPO)), deckTask.installed),
    fts5Check(fts5Failure()),
    await transcripts(),
    ...(await counters()),
  ];
  console.log('');
  console.log('  flightdeck doctor');
  console.log('');
  for (const line of renderChecks(checks)) console.log(line);
  console.log('');
  return exitCodeFor(checks);
}

/**
 * Both ports, from one `netstat`.
 *
 * The deck becomes `needed` once its logon task exists (P8-T1): a registered task that is not
 * holding 4949 is a task that failed, which is what `doctor` is for. Without one the deck being
 * down costs nobody a session (D2) and is only worth a warning.
 */
function portChecks(deckTaskInstalled: boolean): readonly Check[] {
  // One netstat for both ports: two calls could disagree about a port that changed between them.
  const netstat = execFileSync(join(SYSTEM32, 'netstat.exe'), ['-ano', '-p', 'TCP'], {
    encoding: 'utf8',
  });
  return [
    // Core is always `needed`: hooks post to core whether a browser is open or not.
    loopbackCheck('core port', netstat, CORE_PORT, true),
    loopbackCheck('deck port', netstat, UI_PORT, deckTaskInstalled),
  ];
}

/**
 * SEC-FS-4 on all four paths, because the ACL is inherited from the directory.
 *
 * The directory is checked first and for its own sake: it is what `flightdeck.db-wal` inherits,
 * and the WAL holds the most recently committed rows (core/main.ts `restrictDataDirectory`).
 */
function aclChecks(): readonly Check[] {
  const account = whoami();
  return [
    aclCheck('acl: data dir', acl.describe(join(storeFile(), '..')), account),
    aclCheck('acl: token', acl.describe(coreTokenFile()), account),
    aclCheck('acl: ingest key', acl.describe(ingestKeyFile()), account),
    aclCheck('acl: store', acl.describe(storeFile()), account),
  ];
}

function policy(): ReadPolicy {
  return new ReadPolicy(SUBSCRIPTION_IDS.map((id) => install.configDirFor(id)));
}

/**
 * The secrets SEC-FS-2 names, plus every one actually on this machine.
 *
 * The named paths are listed whether or not they exist, so the check cannot pass by finding
 * nothing (see `secretsCheck`).
 */
function secretCandidates(): readonly string[] {
  const named = SUBSCRIPTION_IDS.flatMap((id) => {
    const configDir = install.configDirFor(id);
    return [
      join(configDir, 'daemon', 'control.key'),
      join(configDir, 'daemon', 'rv.key'),
      join(configDir, 'sessions', 'any-session.key'),
      join(configDir, '.credentials.json'),
    ];
  });
  return [...named, ...secretsOnDisk()];
}

/** `.key` and `.credentials*` in the three directories Claude Code puts them in. */
function secretsOnDisk(): readonly string[] {
  return SUBSCRIPTION_IDS.flatMap((id) => {
    const configDir = install.configDirFor(id);
    return [configDir, join(configDir, 'daemon'), join(configDir, 'sessions')].flatMap(
      (directory) =>
        names(directory)
          .filter((name) => name.endsWith('.key') || name.startsWith('.credentials'))
          .map((name) => join(directory, name)),
    );
  });
}

function names(directory: string): readonly string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** The same construction `npm run connect` uses, so `plan()` compares against the real template. */
function connector(): Connector {
  return buildConnector(install, new ConsoleLogger());
}

/** What is registered under the role's name. Only `describe` is called — doctor writes nothing. */
function logonTask(role: LogonRole): LogonTaskState {
  const parts = logonTaskParts(role, { account: whoami(), nodePath: process.execPath, repo: REPO });
  return new SchtasksLogonTask(parts).describe();
}

/** D9's one-line check, re-run because an older Node had no FTS5 (nodejs/node#56951). */
function fts5Failure(): string | undefined {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('CREATE VIRTUAL TABLE probe USING fts5(body)');
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'unknown';
  } finally {
    database.close();
  }
}

async function transcripts(): Promise<Check> {
  const roots = SUBSCRIPTION_IDS.map((id) => join(install.configDirFor(id), 'projects'));
  const total = allTranscripts(roots).length;
  const sample = recentTranscripts(roots, TRANSCRIPT_SAMPLE);
  let unknown = 0;
  for (const path of sample) unknown += (await readWhole(path)).unknown;
  return transcriptCheck(sample.length, total, unknown);
}

/**
 * The counters, which need a core to ask.
 *
 * A core that is not running is already reported by `core port`, so this adds nothing when it is
 * down — hence no check at all rather than a second `warn` saying the same thing.
 */
async function counters(): Promise<readonly Check[]> {
  const reading = await readStatus();
  return reading.ok ? [counterCheck(reading.value.status)] : [];
}

function claudeVersion(): string | undefined {
  const executable = install.executable;
  if (executable === undefined) return undefined;
  try {
    return execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch {
    return undefined;
  }
}

/** `DOMAIN\account`, which is what icacls prints and what the logon task names. */
function whoami(): string {
  try {
    return execFileSync(join(SYSTEM32, 'whoami.exe'), [], { encoding: 'utf8' }).trim();
  } catch {
    return process.env['USERNAME'] ?? 'unknown';
  }
}

function engines(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
  );
  if (typeof manifest === 'object' && manifest !== null && 'engines' in manifest) {
    const { engines: field } = manifest;
    if (typeof field === 'object' && field !== null && 'node' in field) {
      const { node } = field;
      if (typeof node === 'string') return node;
    }
  }
  return '>=26.0.0';
}

process.exitCode = await main();
