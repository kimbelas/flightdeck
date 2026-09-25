// The fold over `daemon.log` — P7-T4, RESEARCH.md F.2.3, F.2.15, F.2.16.
import { describe, expect, it } from 'vitest';
import type { DaemonLogEvent } from '../../../contracts/daemon-log.ts';
import { DaemonHistory, MAX_ENDINGS } from '../../../core/domain/daemon-history.ts';

const start = (at: number, pid: number): DaemonLogEvent => ({
  kind: 'start',
  at,
  version: '2.1.278',
  pid,
  origin: 'transient',
});
const exited = (at: number): DaemonLogEvent => ({
  kind: 'exited',
  at,
  cause: 'idle_exit',
  uptimeSeconds: 10,
  liveWorkers: 0,
});
const spawned = (at: number, shortId: string, how = 'shell'): DaemonLogEvent => ({
  kind: 'spawned',
  at,
  shortId,
  how,
});
const settled = (at: number, shortId: string, outcome: string): DaemonLogEvent => ({
  kind: 'settled',
  at,
  shortId,
  outcome,
});
const retired = (at: number, shortId: string, reason: string): DaemonLogEvent => ({
  kind: 'retired',
  at,
  shortId,
  reason,
  idleMinutes: 32,
  lowMemory: true,
});

describe('DaemonHistory — supervisor runs', () => {
  it('knows nothing about a pid the log never saw start', () => {
    const history = DaemonHistory.of([start(1, 100)]);

    expect(history.hasExited(999)).toBeUndefined();
    expect(DaemonHistory.of([]).lastRun).toBeUndefined();
  });

  it('says a supervisor is gone once a shutdown follows its start', () => {
    const history = DaemonHistory.of([start(1, 100), exited(2)]);

    expect(history.hasExited(100)).toBe(true);
    expect(history.lastRun).toEqual({
      pid: 100,
      version: '2.1.278',
      startedAt: 1,
      exitedAt: 2,
      exitCause: 'idle_exit',
    });
  });

  it('says a supervisor that is still the latest, with no shutdown, has not exited', () => {
    expect(DaemonHistory.of([start(1, 100), exited(2), start(3, 200)]).hasExited(200)).toBe(false);
  });

  // A pid can be reissued; a supervisor that was REPLACED is not the one listening, whatever the
  // process table says about that number.
  it('says a supervisor replaced by a later start is gone even with no shutdown line', () => {
    expect(DaemonHistory.of([start(1, 100), start(3, 200)]).hasExited(100)).toBe(true);
  });

  // isg's log, 2026-09-10 20:45: two starts 266 ms apart, the second refused in favour of the
  // first, and one shutdown two minutes later — which belongs to the FIRST (G.58).
  it('drops a start that was refused, so the shutdown after it closes the real supervisor', () => {
    const refused: DaemonLogEvent = { kind: 'refused', at: 3, runningPid: 23_140 };
    const history = DaemonHistory.of([start(1, 23_140), start(2, 34_948), refused, exited(9)]);

    expect(history.lastRun).toMatchObject({ pid: 23_140, exitedAt: 9 });
    expect(history.hasExited(23_140)).toBe(true);
    expect(history.runOf(34_948)).toBeUndefined();
  });

  it('keeps the running supervisor when a refusal names it and nothing newer is open', () => {
    const refused: DaemonLogEvent = { kind: 'refused', at: 3, runningPid: 23_140 };

    expect(DaemonHistory.of([start(1, 23_140), refused]).lastRun?.pid).toBe(23_140);
    expect(DaemonHistory.of([refused]).lastRun).toBeUndefined();
  });

  it('finds the latest run of a pid, or nothing for a pid it never saw', () => {
    const history = DaemonHistory.of([start(1, 100), exited(2), start(3, 200), start(4, 100)]);

    expect(history.runOf(100)?.startedAt).toBe(4);
    expect(history.runOf(300)).toBeUndefined();
  });

  it('pins a shutdown to the run it follows and ignores a stray second one', () => {
    const history = DaemonHistory.of([exited(0), start(1, 100), exited(2), exited(5)]);

    expect(history.lastRun?.exitedAt).toBe(2);
  });
});

describe('DaemonHistory — endings', () => {
  it('names each ending for its cause, newest first — F.2.3 in one fold', () => {
    const history = DaemonHistory.of([
      spawned(1, 'aaaaaaaa'),
      settled(2, 'aaaaaaaa', 'killed'),
      spawned(3, 'bbbbbbbb'),
      settled(4, 'bbbbbbbb', 'done'),
      spawned(5, 'cccccccc'),
      retired(6, 'cccccccc', 'idle-prompt'),
      settled(7, 'cccccccc', 'done'),
    ]);

    expect(history.endings).toEqual([
      {
        shortId: 'cccccccc',
        at: 7,
        reason: 'retired',
        retireReason: 'idle-prompt',
        idleMinutes: 32,
        lowMemory: true,
      },
      { shortId: 'bbbbbbbb', at: 4, reason: 'finished' },
      { shortId: 'aaaaaaaa', at: 2, reason: 'stopped' },
    ]);
  });

  it('leaves out a pre-warmed spare, whose kill nobody made', () => {
    const history = DaemonHistory.of([
      spawned(1, 'dddddddd', 'spare'),
      settled(2, 'dddddddd', 'killed'),
    ]);

    expect(history.endings).toEqual([]);
  });

  it('counts a spare id again once it is spawned as a real session', () => {
    const history = DaemonHistory.of([
      spawned(1, 'dddddddd', 'spare'),
      spawned(2, 'dddddddd', 'fleet'),
      settled(3, 'dddddddd', 'killed'),
    ]);

    expect(history.endings).toHaveLength(1);
  });

  it('does not carry one retirement onto the session’s next ending', () => {
    const history = DaemonHistory.of([
      retired(1, 'eeeeeeee', 'settled'),
      settled(2, 'eeeeeeee', 'done'),
      settled(3, 'eeeeeeee', 'killed'),
    ]);

    expect(history.endings.map((ending) => ending.reason)).toEqual(['stopped', 'retired']);
  });

  it('keeps only the newest endings', () => {
    const events = Array.from({ length: MAX_ENDINGS + 5 }, (unused, index) =>
      settled(index, 'ffffffff', 'done'),
    );

    const endings = DaemonHistory.of(events).endings;
    expect(endings).toHaveLength(MAX_ENDINGS);
    expect(endings[0]?.at).toBe(MAX_ENDINGS + 4);
  });
});

// D62 — the reconciler's question, which is about ONE session rather than the newest twenty.
describe('DaemonHistory — the newest ending for one session', () => {
  it('names how a session ended, and nothing for one the window does not mention', () => {
    const history = DaemonHistory.of([spawned(1, 'aaaa0001'), settled(2, 'aaaa0001', 'killed')]);

    expect(history.latestEndingFor('aaaa0001')).toEqual({
      shortId: 'aaaa0001',
      at: 2,
      reason: 'stopped',
    });
    expect(history.latestEndingFor('bbbb0002')).toBeUndefined();
  });

  it('takes the later of two endings for an id that ran twice', () => {
    const history = DaemonHistory.of([
      settled(1, 'aaaa0001', 'killed'),
      retired(5, 'aaaa0001', 'settled'),
      settled(6, 'aaaa0001', 'done'),
    ]);

    expect(history.latestEndingFor('aaaa0001')).toMatchObject({
      at: 6,
      reason: 'retired',
      retireReason: 'settled',
    });
  });

  // F.2.15: the reason is only in the `bg retire` line, and its `bg settled` is ~1.1 s behind it.
  it('counts a retirement whose settle line has not been written yet, dated by the retire', () => {
    const history = DaemonHistory.of([
      settled(1, 'aaaa0001', 'done'),
      retired(4, 'aaaa0001', 'idle-prompt'),
    ]);

    expect(history.latestEndingFor('aaaa0001')).toEqual({
      shortId: 'aaaa0001',
      at: 4,
      reason: 'retired',
      retireReason: 'idle-prompt',
      idleMinutes: 32,
      lowMemory: true,
    });
    // The panel lists endings that HAPPENED, and this one has not finished happening.
    expect(history.endings.map((ending) => ending.at)).toEqual([1]);
  });

  // `MAX_ENDINGS` is the panel's budget, not a fact about the log.
  it('finds an ending older than the newest twenty', () => {
    const busy = Array.from({ length: MAX_ENDINGS + 5 }, (unused, index) =>
      settled(10 + index, `cccc${String(index).padStart(4, '0')}`, 'done'),
    );
    const history = DaemonHistory.of([settled(1, 'aaaa0001', 'killed'), ...busy]);

    expect(history.endings.some((ending) => ending.shortId === 'aaaa0001')).toBe(false);
    expect(history.latestEndingFor('aaaa0001')?.reason).toBe('stopped');
  });
});
