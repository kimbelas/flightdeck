// SEC-OPS-3, as assertions — P1-T12.
//
// Two promises: run only when the user is logged on, and never elevated. Both are one word in a
// 40-line XML file, both are invisible once registered unless somebody opens the task's property
// sheet, and a wrong one would mean core runs with an administrator token on every logon. So they
// are pinned here rather than checked by eye.
import { describe, expect, it } from 'vitest';
import {
  DECK_LOGON_TASK_NAME,
  ephemeralDirectory,
  logonTaskCommand,
  logonTaskDefinition,
  logonTaskParts,
  LOGON_ROLES,
  LOGON_TASK_NAME,
} from '../../../core/adapters/windows/logon-task-definition.ts';

const MACHINE = {
  account: 'KIMPOY\\Kimpoy',
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  repo: 'C:\\dev\\flightdeck',
};

const PARTS = logonTaskParts('core', MACHINE);
const DECK = logonTaskParts('deck', MACHINE);

describe('logonTaskDefinition — SEC-OPS-3', () => {
  it('runs as the owner with an interactive token, so no credential is stored', () => {
    const xml = logonTaskDefinition(PARTS);

    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<UserId>KIMPOY\\Kimpoy</UserId>');
    // The two logon types that mean a stored secret. Neither may appear.
    expect(xml).not.toContain('Password');
    expect(xml).not.toContain('S4U');
  });

  it('never asks for elevation', () => {
    const xml = logonTaskDefinition(PARTS);

    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).not.toContain('HighestAvailable');
  });

  it('starts at logon and nothing else', () => {
    const xml = logonTaskDefinition(PARTS);

    expect(xml).toContain('<LogonTrigger>');
    expect(xml).not.toContain('CalendarTrigger');
    expect(xml).not.toContain('BootTrigger');
  });
});

describe('logonTaskDefinition — the settings that would otherwise stop a service', () => {
  it('has no execution time limit, because the default would stop core after 72 hours', () => {
    expect(logonTaskDefinition(PARTS)).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
  });

  it('runs on battery, because the default is no hook receiver while unplugged', () => {
    const xml = logonTaskDefinition(PARTS);

    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(xml).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
  });

  it('ignores a second start, rather than running two cores', () => {
    // Two cores is the one failure worse than none: the second issues a token the first does not
    // hold, and then fails to bind (SECURITY.md §7 rule 1, the `run` skill).
    expect(logonTaskDefinition(PARTS)).toContain(
      '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    );
  });
});

describe('logonTaskDefinition — the action', () => {
  it('names node by absolute path and redirects the log', () => {
    const command = logonTaskCommand(PARTS);

    expect(command).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(command).toContain('"C:\\dev\\flightdeck\\scripts\\flightdeck-core.ts"');
    // A task action cannot redirect; cmd is the only thing on a stock Windows that can, and the
    // log is the record that survives the browser being closed (P1-T9).
    expect(command).toContain('> "C:\\dev\\flightdeck\\.flightdeck-core.log" 2>&1');
  });

  /**
   * `cmd /?`'s own rule, modelled: after `/c`, a line that starts with a quote and holds more than
   * two has its first and last quote removed. The P1-T12 form ran `node.exe" "…" > "…` as a
   * command name and exited 1 with no log (RESEARCH.md G.57) — the second assertion is that bug.
   */
  function afterCmdStrips(command: string): string {
    const line = command.replace(/^\/c /, '');
    const quotes = line.split('"').length - 1;
    if (!line.startsWith('"') || quotes <= 2) return line;
    const last = line.lastIndexOf('"');
    return line.slice(1, last) + line.slice(last + 1);
  }

  it('survives cmd /c stripping its first and last quote, and still names node quoted', () => {
    const ran = afterCmdStrips(logonTaskCommand(PARTS));

    expect(ran.startsWith('"C:\\Program Files\\nodejs\\node.exe" ')).toBe(true);
    expect(ran).toContain('> "C:\\dev\\flightdeck\\.flightdeck-core.log" 2>&1');
  });

  it('would not have survived in the P1-T12 form, which is why the wrapper exists', () => {
    const p1t12 = `/c "${PARTS.nodePath}" "${PARTS.scriptPath}" > "${PARTS.logPath}" 2>&1`;

    expect(afterCmdStrips(p1t12).startsWith('C:\\Program Files\\nodejs\\node.exe" ')).toBe(true);
  });

  it('quotes every path, because Program Files has a space in it', () => {
    expect(logonTaskCommand(PARTS)).not.toMatch(/[^"]C:\\Program Files/);
  });

  it('runs cmd from System32, so a PATH entry cannot decide what starts at logon', () => {
    expect(logonTaskDefinition(PARTS)).toMatch(/<Command>.*System32.cmd\.exe<\/Command>/);
  });
});

describe('logonTaskDefinition — escaping', () => {
  it('escapes XML in an account name or a path', () => {
    const xml = logonTaskDefinition({
      ...PARTS,
      account: 'A&B\\user',
      workingDirectory: 'C:\\dev\\flight&deck',
    });

    expect(xml).toContain('<UserId>A&amp;B\\user</UserId>');
    expect(xml).toContain('<WorkingDirectory>C:\\dev\\flight&amp;deck</WorkingDirectory>');
    // A raw ampersand anywhere is XML Task Scheduler would refuse, or accept differently from what
    // the dry run printed.
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it('declares UTF-16, which is the only encoding schtasks /xml reads', () => {
    expect(logonTaskDefinition(PARTS).startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(
      true,
    );
  });

  it('carries the one task name every caller agrees on', () => {
    expect(logonTaskDefinition(PARTS)).toContain(LOGON_TASK_NAME);
  });
});

/**
 * P8-T1 — the deck's task is core's with a few strings changed.
 *
 * Pinned as "everything else is identical" rather than as a second copy of the SEC-OPS-3
 * assertions: a second copy is exactly how one of the two would one day drift.
 */
describe('logonTaskParts — core and the deck', () => {
  it('builds the paths core has always had, so the registered core task does not change', () => {
    expect(PARTS).toMatchObject({
      name: LOGON_TASK_NAME,
      scriptPath: 'C:\\dev\\flightdeck\\scripts\\flightdeck-core.ts',
      workingDirectory: 'C:\\dev\\flightdeck',
      logPath: 'C:\\dev\\flightdeck\\.flightdeck-core.log',
    });
  });

  it('points the deck at its own entry point and the log flightdeck.cmd writes', () => {
    expect(DECK).toMatchObject({
      name: DECK_LOGON_TASK_NAME,
      scriptPath: 'C:\\dev\\flightdeck\\scripts\\flightdeck-deck.ts',
      logPath: 'C:\\dev\\flightdeck\\.flightdeck-deck.log',
    });
  });

  it('differs from core in name, description, script and log, and in nothing else', () => {
    const strip = (xml: string): string =>
      xml
        .replaceAll(PARTS.name, 'NAME')
        .replaceAll(DECK.name, 'NAME')
        .replace(/<Description>.*<\/Description>/, '')
        .replaceAll('flightdeck-core', 'ROLE')
        .replaceAll('flightdeck-deck', 'ROLE');

    expect(strip(logonTaskDefinition(DECK))).toBe(strip(logonTaskDefinition(PARTS)));
  });

  it('gives each role its own name, so installing one cannot replace the other', () => {
    const names = LOGON_ROLES.map((role) => logonTaskParts(role, MACHINE).name);

    expect(new Set(names).size).toBe(LOGON_ROLES.length);
  });

  it('does not double a separator when the repo path ends with one', () => {
    expect(logonTaskParts('deck', { ...MACHINE, repo: 'C:\\dev\\flightdeck\\' }).logPath).toBe(
      'C:\\dev\\flightdeck\\.flightdeck-deck.log',
    );
  });

  it('says in the description that the deck task never builds', () => {
    expect(logonTaskDefinition(DECK)).toMatch(/<Description>[^<]*never builds[^<]*<\/Description>/);
  });
});

describe('ephemeralDirectory — the node path a logon task must not name', () => {
  it('catches the version-manager shim `process.execPath` actually is', () => {
    // Verbatim from this machine's dry run, which is how the bug was found: fnm gives every shell
    // a directory named after that shell's pid and deletes it with the shell. A task built from
    // `process.execPath` would fail at every logon with no symptom but a dead hook receiver.
    const shim = 'C:\\Users\\x\\AppData\\Local\\fnm_multishells\\26232_1789387346814\\node.exe';

    expect(ephemeralDirectory(shim)).toBe('fnm_multishells');
  });

  it('catches a temp directory, and is case-insensitive as Windows paths are', () => {
    expect(ephemeralDirectory('C:\\Users\\x\\AppData\\Local\\TEMP\\node\\node.exe')).toBeDefined();
  });

  it('passes a real installation', () => {
    const installed =
      'C:\\Users\\x\\scoop\\persist\\fnm\\node-versions\\v26.3.0\\installation\\node.exe';

    // Version-pinned, and that is right for a service: a later `fnm use 27` must not silently
    // move a long-running receiver onto an untested runtime.
    expect(ephemeralDirectory(installed)).toBeUndefined();
    expect(ephemeralDirectory('C:\\Program Files\\nodejs\\node.exe')).toBeUndefined();
  });

  it('finds the marker anywhere in a whole task definition, which is how doctor uses it', () => {
    const broken = logonTaskDefinition({
      ...PARTS,
      nodePath: 'C:\\Users\\x\\AppData\\Local\\fnm_multishells\\1_2\\node.exe',
    });

    expect(ephemeralDirectory(broken)).toBe('fnm_multishells');
  });
});
