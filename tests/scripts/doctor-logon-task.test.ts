// `doctor`'s SEC-OPS-3 verdict — P1-T12.
//
// Its own file because the shape it checks is not the shape this project writes: Task Scheduler
// hands back a definition with the default values removed, and the first version of this check
// asserted a positive that a correctly registered task does not carry (RESEARCH.md G.18).
import { describe, expect, it } from 'vitest';
import {
  logonTaskDefinition,
  logonTaskParts,
} from '../../core/adapters/windows/logon-task-definition.ts';
import type { LogonTaskState } from '../../core/ports/logon-task.ts';
import { deckBuildCheck, logonTaskCheck, taskNodePath } from '../../scripts/doctor.ts';

const ACCOUNT = 'KIMPOY\\Kimpoy';

describe('logonTaskCheck — SEC-OPS-3', () => {
  const definition = logonTaskDefinition(
    logonTaskParts('core', {
      account: ACCOUNT,
      nodePath: 'C:\\nodejs\\node.exe',
      repo: 'C:\\dev\\flightdeck',
    }),
  );

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

  it('fails a task registered by the P1-T12 installer, whose cmd line never started node', () => {
    // Everything else about it is right, which is why it went unnoticed (RESEARCH.md G.57).
    const p1t12 = definition
      .replace('<Arguments>/c &quot;&quot;', '<Arguments>/c &quot;')
      .replace('2&gt;&amp;1&quot;</Arguments>', '2&gt;&amp;1</Arguments>');

    const check = logonTaskCheck(state({ definition: p1t12 }));

    expect(p1t12).not.toBe(definition);
    expect(check.level).toBe('fail');
    expect(check.detail).toContain('task:install');
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

/**
 * P8-T1 — doctor reports each task's node, because it is version-pinned on purpose and a Node
 * upgrade leaves both tasks on the old one until they are re-registered.
 */
describe('taskNodePath', () => {
  it('reads the node out of a definition this project writes', () => {
    const xml = logonTaskDefinition(
      logonTaskParts('deck', {
        account: ACCOUNT,
        nodePath: 'C:\\Program Files\\nodejs\\node.exe',
        repo: 'C:\\dev\\flightdeck',
      }),
    );

    expect(taskNodePath(xml)).toBe('C:\\Program Files\\nodejs\\node.exe');
  });

  it('reads it when Task Scheduler hands the quotes back raw', () => {
    const raw = '<Arguments>/c "C:\\n\\node.exe" "C:\\f\\scripts\\flightdeck-deck.ts"</Arguments>';

    expect(taskNodePath(raw)).toBe('C:\\n\\node.exe');
  });

  it('names the node in the ok line, per task', () => {
    const xml = logonTaskDefinition(
      logonTaskParts('deck', { account: ACCOUNT, nodePath: 'C:\\n\\node.exe', repo: 'C:\\f' }),
    );

    const check = logonTaskCheck(
      { name: 'Flightdeck Deck', installed: true, definition: xml },
      'logon: deck',
    );

    expect(check).toMatchObject({ name: 'logon: deck', level: 'ok' });
    expect(check.detail).toContain('C:\\n\\node.exe');
  });
});

describe('deckBuildCheck — P8-T1', () => {
  it('passes when there is a build to serve', () => {
    expect(deckBuildCheck(true, true).level).toBe('ok');
  });

  it('fails a registered deck task with nothing to serve — it exits at every logon', () => {
    const check = deckBuildCheck(false, true);

    expect(check.level).toBe('fail');
    expect(check.detail).toContain('flightdeck.cmd');
  });

  it('only warns without a task, because flightdeck.cmd builds before it starts', () => {
    expect(deckBuildCheck(false, false).level).toBe('warn');
  });
});
