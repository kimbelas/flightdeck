// P7-T5 — the receiver's sums: deltas added, bounded, and copied out.
import { describe, expect, it } from 'vitest';
import type { TelemetryPoint } from '../../../contracts/otlp-metrics.ts';
import { TelemetryTally } from '../../../core/application/telemetry-tally.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';

const SESSION = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER = 'bbbbbbbb-1111-2222-3333-444444444444';

function point(overrides: Partial<TelemetryPoint> = {}): TelemetryPoint {
  return {
    sessionId: SESSION,
    metric: 'cost',
    kind: undefined,
    model: undefined,
    value: 1,
    ...overrides,
  };
}

function build(enabled = true): { tally: TelemetryTally; clock: FakeClock } {
  const clock = new FakeClock();
  return { tally: new TelemetryTally({ enabled, clock }), clock };
}

describe('TelemetryTally', () => {
  it('reports whether it is enabled, and when the sums began', () => {
    const { tally, clock } = build(false);

    expect(tally.report()).toEqual({
      enabled: false,
      since: clock.now().getTime(),
      sessions: [],
      skipped: 0,
    });
  });

  it('adds deltas rather than replacing them', () => {
    const { tally } = build();

    tally.addPoints([point({ value: 0.25 }), point({ value: 0.5 })], 0);
    tally.addPoints([point({ value: 0.25 })], 0);

    expect(tally.report().sessions[0]?.costUsd).toBe(1);
  });

  it('files each split metric under its documented kind', () => {
    const { tally } = build();

    tally.addPoints(
      [
        point({ metric: 'tokens', kind: 'input', value: 10 }),
        point({ metric: 'tokens', kind: 'cacheCreation', value: 5 }),
        point({ metric: 'activeTime', kind: 'user', value: 2 }),
        point({ metric: 'lines', kind: 'removed', value: 3 }),
        point({ metric: 'commits', value: 1 }),
        point({ metric: 'pullRequests', value: 1 }),
      ],
      0,
    );

    const [entry] = tally.report().sessions;
    expect(entry?.tokens).toEqual({ input: 10, output: 0, cacheRead: 0, cacheCreation: 5 });
    expect(entry?.activeSeconds).toEqual({ user: 2, cli: 0 });
    expect(entry?.lines).toEqual({ added: 0, removed: 3 });
    expect(entry?.commits).toBe(1);
    expect(entry?.pullRequests).toBe(1);
  });

  it('drops a kind that is not documented rather than guessing where it goes', () => {
    const { tally } = build();

    tally.addPoints([point({ metric: 'tokens', kind: 'thinking', value: 99 })], 0);

    expect(tally.report().sessions[0]?.tokens).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    });
  });

  it('counts events by name, absent until one arrives', () => {
    const { tally } = build();

    tally.addEvents(
      [
        { sessionId: SESSION, name: 'user_prompt' },
        { sessionId: SESSION, name: 'user_prompt' },
        { sessionId: SESSION, name: 'api_error' },
      ],
      0,
    );

    expect(tally.report().sessions[0]?.events).toEqual({ user_prompt: 2, api_error: 1 });
  });

  it('sums what both signals skipped', () => {
    const { tally } = build();

    tally.addPoints([], 2);
    tally.addEvents([], 3);

    expect(tally.report().skipped).toBe(5);
  });

  it('lists the most recently heard session first, with when', () => {
    const { tally, clock } = build();

    tally.addPoints([point({ sessionId: SESSION })], 0);
    clock.advance(1000);
    tally.addEvents([{ sessionId: OTHER, name: 'tool_result' }], 0);

    const sessions = tally.report().sessions;
    expect(sessions.map((entry) => entry.sessionId)).toEqual([OTHER, SESSION]);
    expect(sessions[0]?.lastAt).toBe(clock.now().getTime());
  });

  it('forgets the least recently heard session past two hundred', () => {
    const { tally } = build();
    const id = (n: number): string =>
      `${n.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;

    for (let n = 0; n <= 200; n += 1) tally.addPoints([point({ sessionId: id(n) })], 0);

    const ids = tally.report().sessions.map((entry) => entry.sessionId);
    expect(ids).toHaveLength(200);
    expect(ids).not.toContain(id(0));
    expect(ids[0]).toBe(id(200));
  });

  it('hands out copies, so a reader cannot change the sums', () => {
    const { tally } = build();
    tally.addPoints([point({ metric: 'tokens', kind: 'input', value: 1 })], 0);

    const first = tally.report().sessions[0];
    if (first !== undefined) Object.assign(first.tokens, { input: 1000 });

    expect(tally.report().sessions[0]?.tokens.input).toBe(1);
  });
});
