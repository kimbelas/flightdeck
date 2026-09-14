// `doctor`'s SEC-OPS-3 verdict — P1-T12.
//
// Its own file because the shape it checks is not the shape this project writes: Task Scheduler
// hands back a definition with the default values removed, and the first version of this check
// asserted a positive that a correctly registered task does not carry (RESEARCH.md G.18).
import { describe, expect, it } from 'vitest';
import { logonTaskDefinition } from '../../core/adapters/windows/logon-task-definition.ts';
import type { LogonTaskState } from '../../core/ports/logon-task.ts';
import { logonTaskCheck } from '../../scripts/doctor.ts';

const ACCOUNT = 'KIMPOY\\Kimpoy';

describe('logonTaskCheck — SEC-OPS-3', () => {
  const definition = logonTaskDefinition({
    account: ACCOUNT,
    nodePath: 'C:\\nodejs\\node.exe',
    scriptPath: 'C:\\dev\\flightdeck\\scripts\\flightdeck-core.ts',
    workingDirectory: 'C:\\dev\\flightdeck',
    logPath: 'C:\\dev\\flightdeck\\.flightdeck-core.log',
  });

  /**
   * What `schtasks /query /xml` gives BACK for the definition above, which is not the definition
   * above (RESEARCH.md G.17). Measured by registering it under a probe name and reading it:
   * `<RunLevel>` is gone because least privilege is the default and Task Scheduler omits defaults,
   * and the principal's `UserId` has become a SID while the trigger's stayed a name.
   *
   * Hand-written with the identity replaced rather than captured, because nothing parses this —
   * `logonTaskCheck` makes two substring tests of it (CODING-STANDARDS §10.3 is about parsers).
   */
  const asStored = definition.replace(
    `<Principal id="Author">\n      <UserId>${ACCOUNT}</UserId>\n      <LogonType>InteractiveToken</LogonType>\n      <RunLevel>LeastPrivilege</RunLevel>`,
    `<Principal id="Author">\n      <UserId>S-1-5-21-0000000000-0000000000-000000000-1002</UserId>\n      <LogonType>InteractiveToken</LogonType>`,
  );

  function state(overrides: Partial<LogonTaskState> = {}): LogonTaskState {
    return { name: 'Flightdeck Core', installed: true, definition, ...overrides };
  }

  it('passes the definition this project writes', () => {
    expect(logonTaskCheck(state()).level).toBe('ok');
  });

  it('passes the definition as Task Scheduler actually stores it', () => {
    // The check this pins is the one that shipped wrong: asserting `<RunLevel>LeastPrivilege` is
    // present fails against every correctly registered task, because the default is omitted.
    expect(asStored).not.toContain('RunLevel');
    expect(logonTaskCheck(state({ definition: asStored })).level).toBe('ok');
  });

  it("warns when there is no task — a checkout that is not the owner's is not broken", () => {
    const check = logonTaskCheck(state({ installed: false, definition: undefined }));

    expect(check.level).toBe('warn');
    expect(check.detail).toContain('task:install');
  });

  it('fails a task that runs elevated', () => {
    const elevated = definition.replace('LeastPrivilege', 'HighestAvailable');

    expect(logonTaskCheck(state({ definition: elevated }))).toMatchObject({ level: 'fail' });
  });

  it('fails a task that stores a credential instead of using the interactive token', () => {
    const stored = definition.replace('InteractiveToken', 'Password');

    expect(logonTaskCheck(state({ definition: stored })).detail).toContain('logged on');
  });

  it('fails a task pointing at a node a version manager will delete', () => {
    // Registered and broken is worse than absent: "registered" reads as "the receiver is
    // guaranteed". This is the bug the installer's own dry run turned up.
    const shimmed = definition.replace(
      'C:\\nodejs\\node.exe',
      'C:\\Users\\x\\AppData\\Local\\fnm_multishells\\26232_1789387346814\\node.exe',
    );

    const check = logonTaskCheck(state({ definition: shimmed }));

    expect(check.level).toBe('fail');
    expect(check.detail).toContain('fnm_multishells');
  });
});
