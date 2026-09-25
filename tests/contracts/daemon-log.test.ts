// `daemon.log` lines — P7-T4, RESEARCH.md B.3, F.2.3, F.2.15. Every line below is quoted from
// RESEARCH.md or from the scrubbed fixture, not invented: a parser tested against lines nobody saw
// is tested against a guess.
import { describe, expect, it } from 'vitest';
import { parseDaemonLog, parseDaemonLogLine } from '../../contracts/daemon-log.ts';

const AT = '2026-09-10T20:34:48.927Z';
const line = (channel: string, message: string): string => `[${AT}] [${channel}] ${message}`;

describe('parseDaemonLogLine', () => {
  it('reads a supervisor start with its version, pid and origin', () => {
    expect(
      parseDaemonLogLine(
        line('supervisor', '─── daemon start ─── version=2.1.268 pid=23140 origin=transient'),
      ),
    ).toEqual({
      kind: 'start',
      at: Date.parse(AT),
      version: '2.1.268',
      pid: 23_140,
      origin: 'transient',
    });
  });

  it('reads a retirement, its reason word, the printed idle figure and the low-memory mark', () => {
    expect(
      parseDaemonLogLine(line('bg', 'bg retire a41e908d: idle-prompt, idle 32m [low memory]')),
    ).toEqual({
      kind: 'retired',
      at: Date.parse(AT),
      shortId: 'a41e908d',
      reason: 'idle-prompt',
      idleMinutes: 32,
      lowMemory: true,
    });
    expect(
      parseDaemonLogLine(line('bg', 'bg retire bf93f016: empty-idle, idle 61m')),
    ).toMatchObject({ reason: 'empty-idle', idleMinutes: 61, lowMemory: false });
  });

  it('reads spawns and settlements, keeping the word in brackets', () => {
    expect(parseDaemonLogLine(line('bg', 'bg spawned 2f234ce1 (spare)'))).toMatchObject({
      kind: 'spawned',
      shortId: '2f234ce1',
      how: 'spare',
    });
    expect(parseDaemonLogLine(line('bg', 'bg settled 78a31323 (killed)'))).toMatchObject({
      kind: 'settled',
      shortId: '78a31323',
      outcome: 'killed',
    });
  });

  it('reads a shutdown and the refusal F.2.16 found written about a dead pid', () => {
    expect(
      parseDaemonLogLine(
        line(
          'supervisor',
          'shutting down (cause=idle_exit, uptime=3666s, leases=0, live_workers=0)',
        ),
      ),
    ).toMatchObject({ kind: 'exited', cause: 'idle_exit', uptimeSeconds: 3666, liveWorkers: 0 });
    expect(
      parseDaemonLogLine(
        line(
          'supervisor',
          'another daemon is already running (pid=23140, version=2.1.268, origin=transient; an on-demand daemon never displaces a running one).',
        ),
      ),
    ).toMatchObject({ kind: 'refused', runningPid: 23_140 });
  });

  it('answers undefined for lines nothing reads, blank lines and torn ones', () => {
    expect(parseDaemonLogLine(line('supervisor', 'workers=0'))).toBeUndefined();
    expect(parseDaemonLogLine('')).toBeUndefined();
    expect(parseDaemonLogLine('[2026-09-10T20:34')).toBeUndefined();
    expect(
      parseDaemonLogLine('[not-an-instantZ] [bg] bg spawned 2f234ce1 (shell)'),
    ).toBeUndefined();
  });

  it('tolerates a CRLF line ending', () => {
    expect(parseDaemonLogLine(`${line('bg', 'bg settled 78a31323 (done)')}\r`)).toMatchObject({
      outcome: 'done',
    });
  });
});

describe('parseDaemonLog', () => {
  it('keeps the lines it reads, in file order', () => {
    const text = [
      line('bg', 'bg retire 57218c6e: idle-prompt, idle 60m'),
      line('supervisor', 'auth: proactive refresh starting'),
      line('bg', 'bg settled 57218c6e (done)'),
      '',
    ].join('\n');

    expect(parseDaemonLog(text).map((event) => event.kind)).toEqual(['retired', 'settled']);
  });
});
