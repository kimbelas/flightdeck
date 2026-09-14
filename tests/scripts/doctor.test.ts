// The verdicts `npm run doctor` reaches — SEC-OPS-1 (P1-T12).
//
// Every check is a pure function of what was found, which is the point: "a `.key` file must be
// refused" and "a wildcard bind is a failure" are assertions that must hold on a machine where
// neither condition exists. The CLI half looks things up and is proven by running it.
import { describe, expect, it } from 'vitest';
import type { ConnectPlan } from '../../contracts/connect-plan.ts';
import type { CoreStatus } from '../../contracts/core-status.ts';
import { ReadPolicy } from '../../core/domain/read-policy.ts';
import type { AclFacts } from '../../core/ports/file-acl.ts';
import {
  aclCheck,
  claudeCheck,
  counterCheck,
  exitCodeFor,
  fts5Check,
  hooksCheck,
  loopbackCheck,
  nodeCheck,
  renderChecks,
  secretsCheck,
  transcriptCheck,
  type Check,
} from '../../scripts/doctor.ts';

const CFG = 'C:\\Users\\x\\.claude-365';
const ACCOUNT = 'KIMPOY\\Kimpoy';

/** Real `netstat -ano -p TCP` shape, trimmed to the rows that matter. */
const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:4950         0.0.0.0:0              LISTENING       12345
  TCP    127.0.0.1:4949         0.0.0.0:0              LISTENING       23456
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:4950         127.0.0.1:51234        ESTABLISHED     12345
`;

describe('nodeCheck', () => {
  it('passes the version this project needs', () => {
    expect(nodeCheck('v26.3.0', '>=26.0.0').level).toBe('ok');
  });

  it('fails a version below it — node:sqlite and type stripping both depend on it', () => {
    expect(nodeCheck('v22.14.0', '>=26.0.0').level).toBe('fail');
  });

  it('fails rather than guessing when it cannot read either version', () => {
    expect(nodeCheck('who knows', '>=26.0.0').level).toBe('fail');
    expect(nodeCheck('v26.3.0', 'latest').level).toBe('fail');
  });
});

describe('loopbackCheck — SEC-NET-1', () => {
  it('passes a port held on 127.0.0.1 only', () => {
    const check = loopbackCheck('core port', NETSTAT, 4950, true);

    expect(check.level).toBe('ok');
    expect(check.detail).toContain('127.0.0.1:4950');
  });

  it('fails a wildcard bind, because that put the deck on the LAN once already', () => {
    const exposed = NETSTAT.replace('127.0.0.1:4949', '0.0.0.0:4949    ');

    const check = loopbackCheck('deck port', exposed, 4949, false);

    expect(check.level).toBe('fail');
    expect(check.detail).toContain('SEC-NET-1');
  });

  it('fails an IPv6 wildcard too', () => {
    const exposed = NETSTAT.replace('127.0.0.1:4950', '[::]:4950       ');

    expect(loopbackCheck('core port', exposed, 4950, true).level).toBe('fail');
  });

  it('accepts the IPv6 loopback', () => {
    const local = NETSTAT.replace('127.0.0.1:4950', '[::1]:4950      ');

    expect(loopbackCheck('core port', local, 4950, true).level).toBe('ok');
  });

  it('fails a missing core and only warns about a missing deck', () => {
    // Hooks post whether a browser is open or not; the deck being down costs nobody a session (D2).
    expect(loopbackCheck('core port', '', 4950, true).level).toBe('fail');
    expect(loopbackCheck('deck port', '', 4949, false).level).toBe('warn');
  });

  it('does not count an established connection as a listener', () => {
    // The ESTABLISHED row also ends in `:4950`. Counting it would report a port as held by
    // something that is only talking to it.
    const onlyEstablished = NETSTAT.split('\n')
      .filter((row) => !row.includes('LISTENING'))
      .join('\n');

    expect(loopbackCheck('core port', onlyEstablished, 4950, true).level).toBe('fail');
  });
});

describe('aclCheck — SEC-FS-4', () => {
  function facts(grants: AclFacts['grants']): AclFacts {
    return { path: 'C:\\data\\token', exists: true, grants };
  }

  it('passes one grant to this user', () => {
    expect(aclCheck('acl', facts([{ account: ACCOUNT, rights: '(f)' }]), ACCOUNT).level).toBe('ok');
  });

  it('is case-insensitive, as Windows account names are', () => {
    const check = aclCheck('acl', facts([{ account: 'kimpoy\\kimpoy', rights: '(f)' }]), ACCOUNT);

    expect(check.level).toBe('ok');
  });

  it('fails when anyone else is granted, which is what /inheritance:r alone leaves behind', () => {
    const check = aclCheck(
      'acl',
      facts([
        { account: ACCOUNT, rights: '(f)' },
        { account: 'BUILTIN\\Administrators', rights: '(i)(f)' },
      ]),
      ACCOUNT,
    );

    expect(check.level).toBe('fail');
    expect(check.detail).toContain('Administrators');
  });

  it('fails a file granted to nobody — the owner cannot read it either', () => {
    expect(aclCheck('acl', facts([]), ACCOUNT).level).toBe('fail');
  });

  it('warns rather than fails when the file is not there yet', () => {
    const missing: AclFacts = { path: 'C:\\data\\token', exists: false, grants: [] };

    expect(aclCheck('acl', missing, ACCOUNT).level).toBe('warn');
  });
});

describe("secretsCheck — SEC-OPS-1, no .key file on core's allowlist", () => {
  const policy = new ReadPolicy([CFG]);

  it('passes when every named secret is refused', () => {
    const check = secretsCheck(policy, [
      `${CFG}\\daemon\\control.key`,
      `${CFG}\\sessions\\a.key`,
      `${CFG}\\.credentials.json`,
    ]);

    expect(check.level).toBe('ok');
  });

  it('fails the moment one of them would be opened', () => {
    // A transcript is allowed; this asserts the check can actually fail, which is the property a
    // vacuous check does not have.
    const check = secretsCheck(policy, [`${CFG}\\projects\\s\\a.jsonl`]);

    expect(check.level).toBe('fail');
    expect(check.detail).toContain('a.jsonl');
  });
});

describe('hooksCheck', () => {
  it('passes when Connect has nothing left to change', () => {
    const plan: ConnectPlan = {
      ok: true,
      changes: [],
      alreadyDone: ['365 hooks', 'isg hooks'],
      environment: 'none',
      environmentLabel: '',
    };

    expect(hooksCheck(plan).level).toBe('ok');
  });

  it('warns when the machine is not connected — that is not a broken machine', () => {
    const plan: ConnectPlan = {
      ok: true,
      changes: [{ path: 'settings.json', label: '365 hooks', before: '{}', after: '{}' }],
      alreadyDone: [],
      environment: 'publish',
      environmentLabel: 'FLIGHTDECK_TOKEN',
    };

    const check = hooksCheck(plan);

    expect(check.level).toBe('warn');
    expect(check.detail).toContain('365 hooks');
  });

  it('fails on a refusal, and says which', () => {
    const plan: ConnectPlan = {
      ok: false,
      refusals: [{ path: 'settings.json', reason: 'hand-edited hooks block' }],
    };

    expect(hooksCheck(plan)).toMatchObject({ level: 'fail', detail: 'hand-edited hooks block' });
  });
});

describe('the rest', () => {
  it('reports claude by version, and fails when it is not installed', () => {
    expect(claudeCheck('C:\\bin\\claude.exe', '2.1.267').level).toBe('ok');
    expect(claudeCheck(undefined, undefined).level).toBe('fail');
    expect(claudeCheck('C:\\bin\\claude.exe', undefined).level).toBe('warn');
  });

  it('fails when node:sqlite has no FTS5, because P7 search depends on it (D9)', () => {
    expect(fts5Check(undefined).level).toBe('ok');
    expect(fts5Check('no such module: fts5').level).toBe('fail');
  });

  it('fails on an unknown transcript record type, and says what was sampled', () => {
    expect(transcriptCheck(15, 315, 0)).toMatchObject({ level: 'ok' });
    const check = transcriptCheck(15, 315, 4);
    expect(check.level).toBe('fail');
    expect(check.detail).toContain('15 newest of 315');
  });

  it('fails when the store or the audit log has dropped anything', () => {
    const status: CoreStatus = {
      version: '0.0.1',
      runtime: { pid: 1, uptimeSeconds: 1, nodeVersion: 'v26.3.0' },
      tokenPath: '',
      ingestKeyPath: '',
      claudePath: undefined,
      store: { path: '', schemaVersion: 2, stored: 9, snapshots: 1, dropped: 0 },
      audit: { written: 2, dropped: 0 },
      transcripts: { tracked: 0, ignored: 0, unknown: 0, oversize: 0 },
      vitals: [],
    };

    expect(counterCheck(status).level).toBe('ok');
    expect(counterCheck({ ...status, store: { ...status.store, dropped: 3 } }).level).toBe('fail');
    expect(counterCheck({ ...status, audit: { written: 2, dropped: 1 } }).level).toBe('fail');
  });
});

describe('the exit code and the printing', () => {
  const checks: readonly Check[] = [
    { name: 'node', level: 'ok', detail: 'fine' },
    { name: 'logon task', level: 'warn', detail: 'absent' },
  ];

  it('exits zero on warnings and non-zero on a failure', () => {
    expect(exitCodeFor(checks)).toBe(0);
    expect(exitCodeFor([...checks, { name: 'acl', level: 'fail', detail: 'bad' }])).toBe(1);
  });

  it('prints one aligned line per check and a summary', () => {
    const lines = renderChecks(checks);

    expect(lines[0]).toContain('[ ok ] node');
    expect(lines[1]).toContain('[warn] logon task');
    expect(lines.at(-1)).toContain('1 warning(s)');
  });

  it('says so plainly when everything is clear', () => {
    expect(renderChecks([{ name: 'node', level: 'ok', detail: 'fine' }]).at(-1)).toContain(
      'all clear',
    );
  });
});
