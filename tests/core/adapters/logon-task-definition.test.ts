// SEC-OPS-3, as assertions — P1-T12.
//
// Two promises: run only when the user is logged on, and never elevated. Both are one word in a
// 40-line XML file, both are invisible once registered unless somebody opens the task's property
// sheet, and a wrong one would mean core runs with an administrator token on every logon. So they
// are pinned here rather than checked by eye.
import { describe, expect, it } from 'vitest';
import {
  ephemeralDirectory,
  logonTaskCommand,
  logonTaskDefinition,
  LOGON_TASK_NAME,
  type LogonTaskDefinitionParts,
} from '../../../core/adapters/windows/logon-task-definition.ts';

const PARTS: LogonTaskDefinitionParts = {
  account: 'KIMPOY\\Kimpoy',
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  scriptPath: 'C:\\dev\\flightdeck\\scripts\\flightdeck-core.ts',
  workingDirectory: 'C:\\dev\\flightdeck',
  logPath: 'C:\\dev\\flightdeck\\.flightdeck-core.log',
};

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
