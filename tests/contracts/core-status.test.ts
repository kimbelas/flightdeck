// `parseCoreStatus` — the boundary between core and the script that prints it (P1-T12).
//
// The interesting half is the refusals. A status screen that prints `undefined` in six columns
// because the body changed shape is worse than one that says it does not understand the answer.
import { describe, expect, it } from 'vitest';
import { parseCoreStatus, type CoreStatus } from '../../contracts/core-status.ts';

const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';

const WHOLE: CoreStatus = {
  version: '0.0.1',
  runtime: { pid: 4242, uptimeSeconds: 90, nodeVersion: '26.3.0' },
  tokenPath: 'C:\\data\\token',
  ingestKeyPath: 'C:\\data\\ingest-key',
  claudePath: 'C:\\bin\\claude.exe',
  store: {
    path: 'C:\\data\\flightdeck.db',
    schemaVersion: 2,
    stored: 17,
    snapshots: 3,
    dropped: 0,
  },
  audit: { written: 4, dropped: 0 },
  transcripts: { tracked: 2, ignored: 900, unknown: 0, oversize: 1 },
  vitals: [
    {
      sessionId: SESSION,
      subscription: 'isg',
      at: 1_789_000_000_000,
      sessionName: 'the-one',
      modelName: 'Opus 5',
      usedPercentage: 42,
      costUsd: 1.25,
      fiveHourPercentage: 23,
      sevenDayPercentage: 7,
    },
  ],
};

/** Through JSON, because that is the only way this value ever arrives. */
function overTheWire(value: unknown): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  if (typeof parsed !== 'object' || parsed === null) return {};
  return Object.fromEntries(Object.entries(parsed));
}

describe('parseCoreStatus — a body core actually sent', () => {
  it('round-trips a whole status', () => {
    expect(parseCoreStatus(overTheWire(WHOLE))).toEqual(WHOLE);
  });

  it('puts back the undefined that JSON.stringify dropped', () => {
    const before = new Date().getTime();
    const fresh = {
      ...WHOLE,
      claudePath: undefined,
      vitals: [
        { ...WHOLE.vitals[0], sessionName: undefined, usedPercentage: undefined, at: before },
      ],
    };

    const parsed = parseCoreStatus(overTheWire(fresh));

    // `exactOptionalPropertyTypes` is why this is a parser and not a type guard: the properties
    // are gone from the JSON, and the type requires them to be present and `undefined`.
    expect(parsed?.claudePath).toBeUndefined();
    expect(parsed?.vitals[0]?.sessionName).toBeUndefined();
    expect(parsed?.vitals[0]?.usedPercentage).toBeUndefined();
    expect(parsed?.vitals[0]?.at).toBe(before);
  });

  it('keeps a zero as a zero, because zero cost is not unknown cost', () => {
    const zeroed = { ...WHOLE, vitals: [{ ...WHOLE.vitals[0], costUsd: 0, usedPercentage: 0 }] };

    const parsed = parseCoreStatus(overTheWire(zeroed));

    expect(parsed?.vitals[0]?.costUsd).toBe(0);
    expect(parsed?.vitals[0]?.usedPercentage).toBe(0);
  });
});

describe('parseCoreStatus — bodies it refuses', () => {
  const notStatuses: readonly (readonly [string, unknown])[] = [
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a string', 'ok'],
    ['an array', []],
    ['an empty object', {}],
  ];

  for (const [label, value] of notStatuses) {
    it(`refuses ${label}`, () => {
      expect(parseCoreStatus(value)).toBeUndefined();
    });
  }

  it('refuses a body with a block missing, rather than filling it with zeros', () => {
    // `version` is in the list because it is the field that says which build answered.
    for (const missing of ['version', 'runtime', 'store', 'audit', 'transcripts', 'vitals']) {
      const body = Object.fromEntries(
        Object.entries(overTheWire(WHOLE)).filter(([key]) => key !== missing),
      );

      expect(parseCoreStatus(body)).toBeUndefined();
    }
  });

  it('drops a vitals line that is not one, and keeps the rest of the table', () => {
    const body = {
      ...overTheWire(WHOLE),
      vitals: [null, { subscription: 'isg' }, ...WHOLE.vitals],
    };

    expect(parseCoreStatus(body)?.vitals).toHaveLength(1);
  });

  it('drops a vitals line whose subscription is not one of the two', () => {
    const body = { ...overTheWire(WHOLE), vitals: [{ sessionId: SESSION, subscription: 'aws' }] };

    // Dropped, never coerced to a default subscription: a row attributed to the wrong config dir
    // is worse than a row nobody printed (CODING-STANDARDS §11 rule 1).
    expect(parseCoreStatus(body)?.vitals).toEqual([]);
  });

  it('tolerates a counter that is not a number, because a counter has one resting value', () => {
    const body = { ...overTheWire(WHOLE), audit: { written: 'lots', dropped: null } };

    expect(parseCoreStatus(body)?.audit).toEqual({ written: 0, dropped: 0 });
  });
});
