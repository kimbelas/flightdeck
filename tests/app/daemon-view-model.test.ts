// The daemon panel's words — P7-T4. The stale sentence and the idle-prompt one are the two that
// matter (RESEARCH.md F.2.16, F.2.15), so they are the ones pinned here.
import { describe, expect, it } from 'vitest';
import { DaemonPanelModel } from '../../app/deck/daemon-panel-model.ts';
import { DaemonViewModel } from '../../app/deck/daemon-view-model.ts';
import type { DaemonSupervisor, SubscriptionDaemon } from '../../contracts/daemon-report.ts';
import { CORE_DAEMON_PATH } from '../../contracts/deck-routes.ts';
import { FakeDeckApi } from '../fakes/fake-deck-api.ts';

const NOW = 1_790_000_000_000;
const HOUR = 3_600_000;

function supervisor(overrides: Partial<DaemonSupervisor>): DaemonSupervisor {
  return {
    state: 'absent',
    pid: undefined,
    rosterUpdatedAt: undefined,
    startedAt: undefined,
    version: undefined,
    exitedAt: undefined,
    exitCause: undefined,
    ...overrides,
  };
}

function daemon(overrides: Partial<SubscriptionDaemon> = {}): SubscriptionDaemon {
  return {
    subscription: 'isg',
    supervisor: supervisor({}),
    workers: [],
    endings: [],
    logRead: true,
    ...overrides,
  };
}

const view = (value: SubscriptionDaemon): DaemonViewModel => new DaemonViewModel(value, NOW);

describe('DaemonViewModel — the headline', () => {
  it('says a running supervisor is running, with its pid, version and age', () => {
    const model = view(
      daemon({
        supervisor: supervisor({
          state: 'running',
          pid: 9700,
          version: '2.1.282',
          startedAt: NOW - 2 * HOUR,
        }),
      }),
    );

    expect(model.tone).toBe('ok');
    expect(model.headline).toBe('running — supervisor 9700, v2.1.282 · up 2h ago');
  });

  it('says a stale roster is not running, since when, and what brings one back', () => {
    const model = view(
      daemon({
        supervisor: supervisor({
          state: 'stale',
          pid: 27_708,
          exitedAt: NOW - 4 * 24 * HOUR,
          exitCause: 'idle_exit',
        }),
      }),
    );

    expect(model.tone).toBe('bad');
    expect(model.headline).toContain(
      'the roster still names supervisor 27708, which shut down 4d ago (idle_exit)',
    );
    expect(model.headline).toContain('stop, rm and logs fail until a --bg launch starts a new one');
  });

  it('tells a subscription that has never run a daemon from one whose daemon exited', () => {
    expect(view(daemon()).headline).toBe('no background daemon has run here');
    const exited = view(
      daemon({ supervisor: supervisor({ startedAt: NOW - HOUR, exitedAt: NOW - HOUR }) }),
    );
    expect(exited.tone).toBe('quiet');
    expect(exited.headline).toBe(
      'not running, which shut down 1h ago. The next --bg launch starts one.',
    );
  });

  it('says so when the log could not be read', () => {
    expect(view(daemon({ logRead: false })).logNote).toBe('daemon.log could not be read');
    expect(view(daemon()).logNote).toBeUndefined();
  });
});

describe('DaemonViewModel — workers and endings', () => {
  it('labels each worker, marking one whose pid has gone', () => {
    const model = view(
      daemon({
        workers: [
          {
            shortId: 'aaaaaaaa',
            pid: 10,
            alive: true,
            startedAt: NOW - 60_000,
            cliVersion: '2.1.282',
          },
          {
            shortId: 'bbbbbbbb',
            pid: undefined,
            alive: false,
            startedAt: undefined,
            cliVersion: undefined,
          },
        ],
      }),
    );

    expect(model.workers).toEqual([
      { shortId: 'aaaaaaaa', label: 'pid 10 · 2.1.282 · started 1m ago', alive: true },
      { shortId: 'bbbbbbbb', label: 'no pid (gone)', alive: false },
    ]);
  });

  it('draws an idle-prompt retirement as a request for attention, and counts them', () => {
    const model = view(
      daemon({
        endings: [
          {
            shortId: 'cccccccc',
            at: NOW - HOUR,
            reason: 'retired',
            retireReason: 'idle-prompt',
            idleMinutes: 32,
            lowMemory: true,
          },
          {
            shortId: 'dddddddd',
            at: NOW - HOUR,
            reason: 'retired',
            retireReason: 'settled',
            idleMinutes: 61,
            lowMemory: false,
          },
          {
            shortId: 'eeeeeeee',
            at: NOW - HOUR,
            reason: 'retired',
            retireReason: 'empty-idle',
            idleMinutes: 61,
            lowMemory: false,
          },
          {
            shortId: 'ffffffff',
            at: NOW - HOUR,
            reason: 'retired',
            retireReason: 'bored',
            idleMinutes: 1,
            lowMemory: false,
          },
          { shortId: '11111111', at: NOW - 5000, reason: 'stopped' },
        ],
      }),
    );

    expect(model.endings.map((ending) => ending.label)).toEqual([
      'retired while waiting for you',
      'retired after finishing',
      'retired before its first turn',
      'retired (bored)',
      'stopped',
    ]);
    expect(model.endings[0]?.detail).toBe('1h ago · idle ≤ 32m · low memory');
    expect(model.endings[4]?.detail).toBe('5s ago');
    expect(model.endings.map((ending) => ending.attention)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(model.unanswered).toBe(1);
  });
});

describe('DaemonPanelModel', () => {
  it('asks core once and builds a view per subscription, aged from the reading', async () => {
    const api = new FakeDeckApi();
    api.willAnswer(200, { at: NOW, daemons: [daemon(), daemon({ subscription: '365' })] });

    const state = await new DaemonPanelModel(api).load();

    expect(api.requests).toEqual([{ method: 'GET', path: CORE_DAEMON_PATH, body: undefined }]);
    expect(state.at).toBe(NOW);
    expect(state.daemons.map((one) => one.subscription)).toEqual(['isg', '365']);
    expect(state.error).toBeUndefined();
  });

  it('turns an unreachable core and a bad reply into a sentence, never a throw', async () => {
    const api = new FakeDeckApi();
    api.willNotAnswer();
    expect((await new DaemonPanelModel(api).load()).error).toBe('could not reach core');

    api.willAnswer(401, { error: 'unauthorised' });
    expect((await new DaemonPanelModel(api).load()).error).toBe('core answered 401');

    api.willAnswer(200, '<html>');
    expect((await new DaemonPanelModel(api).load()).error).toBe('core answered 200');
  });
});
