// Adopting a session started outside Flightdeck — P6-T7, SPEC §4.3, RESEARCH.md G.55.
//
// **Every assertion about the argv is a measurement.** G.55 adopted a real ended session, at zero
// token cost, and found the three facts this class is built on: `--bg --resume <uuid>` keeps the
// id and turns the session into a background job; anything else next to it — `-n` included —
// starts a COPY, which the binary now says out loud; and a session with no `--bg` history has no
// saved cwd, so it runs wherever the process was started.
//
// That last one is what most of this file is about. Core runs as a logon task from its own
// directory, so an adoption that did not pass a cwd would take a terminal that was working in a
// repository and restart it in core's folder — P6-T1's "the one failure a terminal must not have",
// arriving silently and looking like it worked.
import { describe, expect, it } from 'vitest';
import {
  SessionAdopter,
  type SessionDirectory,
} from '../../../core/application/session-adopter.ts';
import { ClaudeInstall } from '../../../core/adapters/claude-cli/claude-install.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import type { SessionRow } from '../../../contracts/session-row.ts';
import type { ProcessRequest, ProcessResult } from '../../../core/ports/process-runner.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const SESSION = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const FOLDER = 'C:\\Users\\owner\\Documents\\ledger';

/** What `--bg --resume` really prints for an adoption, from G.55's probe. */
const WOKE: ProcessResult = {
  code: 0,
  stdout: 'backgrounded · 337975f9 (idle — send a prompt to start)\n',
  stderr: '',
  timedOut: false,
};

const FAILED: ProcessResult = { code: 1, stdout: '', stderr: 'nope', timedOut: false };

/** The ended interactive row core remembers — what `Reconciler.rowFor` answers with. */
function endedRow(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: SESSION,
    shortId: '337975f9',
    subscription: '365',
    kind: 'interactive',
    name: 'apex',
    cwd: FOLDER,
    startedAt: 1000,
    live: false,
    runState: undefined,
    status: undefined,
    attachable: false,
    notAttachableBecause: 'That terminal has closed.',
    endReason: 'unknown',
    retireReason: undefined,
    ...over,
  };
}

/**
 * `NONE` rather than `undefined` for "there isn't one" — the trap `session-handoff.test.ts` named.
 *
 * It bites twice here. `ClaudeInstall` reads `undefined` as "go and look on disk", which on this
 * machine finds one; and `build(NONE)` for "core remembers no row" selects the DEFAULT row
 * instead, so the case meant to prove an adoption is refused proves one succeeding.
 */
const NONE = Symbol('none');

interface Built {
  readonly adopter: SessionAdopter;
  readonly asked: ProcessRequest[];
  readonly store: FakeStore;
}

function build(
  row: SessionRow | typeof NONE = endedRow(),
  result: ProcessResult = WOKE,
  executable: string | typeof NONE = 'C:\\claude.exe',
): Built {
  const asked: ProcessRequest[] = [];
  const store = new FakeStore();
  const sessions: SessionDirectory = {
    rowFor: (subscription, sessionId) =>
      row !== NONE && row.subscription === subscription && row.sessionId === sessionId
        ? row
        : undefined,
  };
  const adopter = new SessionAdopter({
    install: new ClaudeInstall('C:\\home', executable === NONE ? '' : executable),
    sessions,
    runner: {
      run: (request: ProcessRequest) => {
        asked.push(request);
        return Promise.resolve(result);
      },
    },
    audit: new AuditLog(store, new FakeClock(), new FakeLogger()),
    logger: new FakeLogger(),
  });
  return { adopter, asked, store };
}

const REQUEST = { subscription: '365', sessionId: SESSION } as const;

describe('SessionAdopter — the command line G.55 measured', () => {
  it('wakes it with two flags and the FULL uuid, and nothing else', async () => {
    const { adopter, asked } = build();

    await adopter.adopt(REQUEST);

    expect(asked[0]?.args).toEqual(['--bg', '--resume', SESSION]);
  });

  /**
   * The measurement this class exists for.
   *
   * A session with no `--bg` history has no saved options, so the adopted one runs in the PROCESS
   * cwd — core's own directory, which is not where that terminal was working.
   */
  it('runs it in the folder core remembers, not core’s own', async () => {
    const { adopter, asked } = build();

    await adopter.adopt(REQUEST);

    expect(asked[0]?.cwd).toBe(FOLDER);
  });

  it('answers with the id it was given, because an adoption keeps the id', async () => {
    const { adopter } = build();

    const adopted = await adopter.adopt(REQUEST);

    expect(adopted).toEqual({ ok: true, value: SESSION });
  });

  // A session id is only unique within a config directory, so the account is part of WHICH
  // session this is — the row is looked up under it as well as being run under it.
  it('sends the subscription’s config dir, so the right account is asked', async () => {
    const { adopter, asked } = build(endedRow({ subscription: 'isg' }));

    await adopter.adopt({ subscription: 'isg', sessionId: SESSION });

    expect(asked[0]?.env['CLAUDE_CONFIG_DIR']).toContain('.claude-isg');
  });
});

describe('SessionAdopter — what it refuses', () => {
  // The control rather than input hygiene. A short id does not fail: it starts a copy under a new
  // id, which succeeds, and nothing anywhere reports it (F.2.7, G.55).
  it.each(['337975f9', SESSION.toUpperCase(), '', 'not-a-uuid'])(
    'refuses %s rather than starting a copy',
    async (sessionId) => {
      const { adopter, asked } = build();

      const adopted = await adopter.adopt({ subscription: '365', sessionId });

      expect(adopted).toEqual({ ok: false, error: 'bad_session' });
      expect(asked).toEqual([]);
    },
  );

  // After a core restart this is the ordinary answer rather than an edge case: the memory of the
  // ended terminal went with it, and there is no folder to start the session in.
  it('refuses a session it has no row for', async () => {
    const { adopter, asked } = build(NONE);

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: false, error: 'not_adoptable' });
    expect(asked).toEqual([]);
  });

  // `resume` is the verb for a background session, and it is right where this is wrong: a
  // background job keeps its own saved cwd, and passing one would be core overriding it.
  it('refuses a background session — that is what resume is for', async () => {
    const { adopter, asked } = build(endedRow({ kind: 'background' }));

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: false, error: 'not_adoptable' });
    expect(asked).toEqual([]);
  });

  // Its own code, because it is not a failure: the terminal is open and the answer is to close it.
  it('refuses a session whose terminal is still open, and says so', async () => {
    const { adopter, asked } = build(endedRow({ live: true }));

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: false, error: 'still_running' });
    expect(asked).toEqual([]);
  });

  // Running in core's own directory instead would be the silent folder change this class exists
  // to prevent — the failure would look exactly like a success.
  it('refuses when no folder is known rather than falling back to core’s', async () => {
    const { adopter, asked } = build(endedRow({ cwd: '' }));

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: false, error: 'not_adoptable' });
    expect(asked).toEqual([]);
  });

  it('reports a missing binary as the operator’s problem', async () => {
    const { adopter } = build(endedRow(), WOKE, NONE);

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: false, error: 'no_claude' });
  });

  it.each([
    { result: FAILED, why: 'a non-zero exit' },
    { result: { ...WOKE, timedOut: true }, why: 'a timeout' },
  ])('reports $why as adopt_failed', async ({ result }) => {
    const { adopter } = build(endedRow(), result);

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: false, error: 'adopt_failed' });
  });

  // The id is answered rather than parsed out of stdout, which is the promise the argv makes: a
  // correct adoption cannot produce a different id, so reading one back would mean reporting on a
  // copy we had just made by accident.
  it('answers the same id even when the output says nothing', async () => {
    const { adopter } = build(endedRow(), { ...WOKE, stdout: '' });

    expect(await adopter.adopt(REQUEST)).toEqual({ ok: true, value: SESSION });
  });
});

describe('SessionAdopter — the audit trail', () => {
  it('writes exactly one row on the way out, whichever way it went', async () => {
    for (const built of [build(), build(NONE), build(endedRow(), FAILED)]) {
      await built.adopter.adopt(REQUEST);

      expect(built.store.allAudit).toHaveLength(1);
    }
  });

  it.each([
    { build: () => build(), outcome: 'ok' },
    { build: () => build(NONE), outcome: 'refused' },
    { build: () => build(endedRow(), FAILED), outcome: 'failed' },
  ])('records $outcome', async ({ build: make, outcome }) => {
    const built = make();

    await built.adopter.adopt(REQUEST);

    expect(built.store.allAudit[0]).toMatchObject({ action: 'adopt', target: SESSION, outcome });
  });

  // Safe to record in full, unlike a launch's: two flags and an id the deck already has, no prompt
  // and no name (SEC-DATA-2).
  it('records the argv, which carries nothing of the owner’s', async () => {
    const { adopter, store } = build();

    await adopter.adopt(REQUEST);

    expect(store.allAudit[0]?.args).toEqual(['--bg', '--resume']);
  });
});

// P6-T8. The take-over's way in: the row still says live, and the folder is the caller's reading.
describe('SessionAdopter.adoptAt', () => {
  it('adopts in the folder it is given, even while core’s row still says live', async () => {
    const { adopter, asked } = build(endedRow({ live: true }));

    const adopted = await adopter.adoptAt(REQUEST, 'C:\\elsewhere');

    expect(adopted).toEqual({ ok: true, value: SESSION });
    expect(asked[0]?.args).toEqual(['--bg', '--resume', SESSION]);
    expect(asked[0]?.cwd).toBe('C:\\elsewhere');
  });

  it.each([
    { why: 'a short id', sessionId: '337975f9', cwd: FOLDER, code: 'bad_session' },
    { why: 'no folder', sessionId: SESSION, cwd: '', code: 'not_adoptable' },
  ] as const)('still refuses $why', async ({ sessionId, cwd, code }) => {
    const { adopter, asked } = build();

    expect(await adopter.adoptAt({ subscription: '365', sessionId }, cwd)).toEqual({
      ok: false,
      error: code,
    });
    expect(asked).toEqual([]);
  });

  it('still refuses without a binary', async () => {
    const { adopter } = build(endedRow(), WOKE, NONE);

    expect(await adopter.adoptAt(REQUEST, FOLDER)).toEqual({ ok: false, error: 'no_claude' });
  });
});
