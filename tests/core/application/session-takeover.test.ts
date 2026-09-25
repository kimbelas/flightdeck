// Moving a live interactive session into Flightdeck — P6-T8, D63, RESEARCH.md G.60.
//
// **The order is the feature.** Every refusal must happen BEFORE the process is ended, because the
// one thing a take-over cannot undo is closing somebody's terminal. So most of this file asserts
// that `end` was never called, and the rest asserts that the adoption ran in the folder the
// listing named, with the id it was given.
import { describe, expect, it } from 'vitest';
import type { AgentRecord } from '../../../contracts/agents-listing.ts';
import type { AdoptFailure } from '../../../contracts/launch-reply.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import type { AdoptRequest } from '../../../core/application/session-adopter.ts';
import { SessionTakeover } from '../../../core/application/session-takeover.ts';
import { err, ok, type Result } from '../../../core/shared/result.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const SESSION = 'e3cd988e-4179-4ba5-9bed-69dbac7c6e93';
const FOLDER = 'C:\\Users\\owner\\Documents\\ledger';
const PID = 5300;
const REQUEST = { subscription: '365', sessionId: SESSION } as const;

/** The interactive record G.60 read off the listing a moment before ending it. */
function idleRecord(over: Partial<AgentRecord> = {}): AgentRecord {
  return {
    sessionId: SESSION,
    id: undefined,
    pid: PID,
    cwd: FOLDER,
    kind: 'interactive',
    name: 'ledger',
    startedAt: 1000,
    status: 'idle',
    state: undefined,
    ...over,
  };
}

/** `NONE` for "the listing does not carry it" — `session-adopter.test.ts`'s trap with defaults. */
const NONE = Symbol('none');
const UNREADABLE = Symbol('unreadable');

interface Options {
  readonly record?: AgentRecord | typeof NONE | typeof UNREADABLE;
  readonly ends?: boolean;
  readonly adopts?: Result<string, AdoptFailure>;
  readonly executable?: string;
}

interface Built {
  readonly takeover: SessionTakeover;
  readonly ended: number[];
  readonly adopted: { request: AdoptRequest; cwd: string }[];
  readonly looked: string[];
  readonly store: FakeStore;
}

function build(options: Options = {}): Built {
  const ended: number[] = [];
  const adopted: { request: AdoptRequest; cwd: string }[] = [];
  const looked: string[] = [];
  const store = new FakeStore();
  const record = options.record ?? idleRecord();
  const takeover = new SessionTakeover({
    install: new ClaudeInstall('C:\\home', options.executable ?? 'C:\\claude.exe'),
    lookup: {
      find: (subscription, sessionId) => {
        looked.push(`${subscription}:${sessionId}`);
        if (record === UNREADABLE) return Promise.resolve(err('unreadable'));
        return Promise.resolve(ok(record === NONE ? undefined : record));
      },
    },
    ender: {
      end: (pid) => {
        ended.push(pid);
        return Promise.resolve(options.ends ?? true);
      },
    },
    adopter: {
      adoptAt: (request, cwd) => {
        adopted.push({ request, cwd });
        return Promise.resolve(options.adopts ?? ok(request.sessionId));
      },
    },
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { takeover, ended, adopted, looked, store };
}

describe('SessionTakeover — the two steps G.60 measured', () => {
  it('ends the pid the listing named, then adopts in the folder it named', async () => {
    const { takeover, ended, adopted } = build();

    const moved = await takeover.takeOver(REQUEST);

    expect(moved).toEqual({ ok: true, value: SESSION });
    expect(ended).toEqual([PID]);
    expect(adopted).toEqual([{ request: REQUEST, cwd: FOLDER }]);
  });

  // The pid is read at the press, from the subscription the session belongs to — a session id is
  // only unique within one config directory.
  it('asks the listing about that session under its own subscription', async () => {
    const { takeover, looked } = build();

    await takeover.takeOver({ subscription: 'isg', sessionId: SESSION });

    expect(looked).toEqual([`isg:${SESSION}`]);
  });
});

describe('SessionTakeover — what it refuses, before ending anything', () => {
  it.each([
    {
      why: 'a short id',
      request: { subscription: '365', sessionId: 'e3cd988e' },
      code: 'bad_session',
    },
    {
      why: 'an upper-case uuid',
      request: { subscription: '365', sessionId: SESSION.toUpperCase() },
      code: 'bad_session',
    },
  ] as const)('refuses $why', async ({ request, code }) => {
    const { takeover, ended, looked } = build();

    expect(await takeover.takeOver(request)).toEqual({ ok: false, error: code });
    expect(looked).toEqual([]);
    expect(ended).toEqual([]);
  });

  it.each([
    { why: 'a session the listing no longer carries', record: NONE, code: 'not_running' },
    { why: 'an unreadable listing', record: UNREADABLE, code: 'not_running' },
    { why: 'a record with no pid', record: idleRecord({ pid: undefined }), code: 'not_running' },
    {
      why: 'a background session',
      record: idleRecord({ kind: 'background' }),
      code: 'not_interactive',
    },
    // The opposite of the sweep's default, on purpose: here the dangerous direction is ending it.
    {
      why: 'a record with no kind',
      record: idleRecord({ kind: undefined }),
      code: 'not_interactive',
    },
    { why: 'a busy session', record: idleRecord({ status: 'busy' }), code: 'busy' },
    { why: 'a waiting session', record: idleRecord({ status: 'waiting' }), code: 'busy' },
    { why: 'a session with no status', record: idleRecord({ status: undefined }), code: 'busy' },
    { why: 'no folder', record: idleRecord({ cwd: undefined }), code: 'no_folder' },
    { why: 'an empty folder', record: idleRecord({ cwd: '' }), code: 'no_folder' },
  ] as const)('refuses $why without ending the process', async ({ record, code }) => {
    const { takeover, ended, adopted } = build({ record });

    expect(await takeover.takeOver(REQUEST)).toEqual({ ok: false, error: code });
    expect(ended).toEqual([]);
    expect(adopted).toEqual([]);
  });

  it('reports a missing binary as the operator’s problem', async () => {
    const { takeover, ended } = build({ executable: '' });

    expect(await takeover.takeOver(REQUEST)).toEqual({ ok: false, error: 'no_claude' });
    expect(ended).toEqual([]);
  });
});

describe('SessionTakeover — when a step fails', () => {
  // The terminal is still there, so nothing is adopted: a second process against a conversation
  // somebody can still type into is exactly what P6-T7 refused to start.
  it('does not adopt when the process is still running afterwards', async () => {
    const { takeover, adopted } = build({ ends: false });

    expect(await takeover.takeOver(REQUEST)).toEqual({ ok: false, error: 'end_failed' });
    expect(adopted).toEqual([]);
  });

  it('reports a failed adoption, which the ended row then offers to retry', async () => {
    const { takeover } = build({ adopts: err('adopt_failed') });

    expect(await takeover.takeOver(REQUEST)).toEqual({ ok: false, error: 'adopt_failed' });
  });
});

describe('SessionTakeover — the audit trail', () => {
  it('records the taskkill argv, pid included, when it ended the process', async () => {
    const { takeover, store } = build();

    await takeover.takeOver(REQUEST);

    expect(store.allAudit[0]).toMatchObject({
      action: 'takeover',
      target: SESSION,
      outcome: 'ok',
      args: ['/PID', String(PID), '/FI', 'IMAGENAME eq claude.exe', '/T', '/F'],
    });
  });

  it('records a refusal with no argv, because nothing ran', async () => {
    const { takeover, store } = build({ record: idleRecord({ status: 'busy' }) });

    await takeover.takeOver(REQUEST);

    expect(store.allAudit).toHaveLength(1);
    expect(store.allAudit[0]).toMatchObject({ action: 'takeover', outcome: 'refused', args: [] });
  });

  it('records a failed end as failed', async () => {
    const { takeover, store } = build({ ends: false });

    await takeover.takeOver(REQUEST);

    expect(store.allAudit[0]).toMatchObject({ action: 'takeover', outcome: 'failed' });
  });
});
