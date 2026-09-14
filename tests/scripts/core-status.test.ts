// What `flightdeck-core status` prints — P1's gate sentence, as assertions (P1-T12).
//
// The gate is "every live session with subscription, name, state, flags, model, context %, cost
// and 5h/7d quota". The layout is a pure function of two wire values, so the columns are testable
// without a core to ask; the fetching half is proven by running it.
import { describe, expect, it } from 'vitest';
import type { CoreStatus, SessionVitalsLine } from '../../contracts/core-status.ts';
import type { DeckSnapshot, SessionRow } from '../../contracts/session-row.ts';
import { renderStatus, type StatusReading } from '../../scripts/core-status.ts';

const NOW = 1_789_000_100_000;
const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';
const OTHER = 'd1b2f43c-1111-4222-a333-444444444444';

function vitals(overrides: Partial<SessionVitalsLine> = {}): SessionVitalsLine {
  return {
    sessionId: SESSION,
    subscription: 'isg',
    at: NOW - 5000,
    sessionName: 'the-one',
    modelName: 'Opus 5',
    claudeVersion: '2.1.7',
    usedPercentage: 42,
    costUsd: 1.25,
    fiveHourPercentage: 23,
    fiveHourResetsAt: NOW + 7_200_000,
    sevenDayPercentage: 88,
    sevenDayResetsAt: NOW + 400_000_000,
    ...overrides,
  };
}

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: SESSION,
    shortId: 'cb5e8102',
    subscription: 'isg',
    kind: 'background',
    name: 'the-one',
    cwd: 'C:\\dev\\thing',
    startedAt: NOW - 600_000,
    live: true,
    runState: 'working',
    status: 'busy',
    attachable: true,
    notAttachableBecause: undefined,
    ...overrides,
  };
}

function status(overrides: Partial<CoreStatus> = {}): CoreStatus {
  return {
    version: '0.0.1',
    runtime: { pid: 4242, uptimeSeconds: 3720, nodeVersion: '26.3.0' },
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
    vitals: [vitals()],
    ...overrides,
  };
}

function snapshot(
  rows: readonly SessionRow[],
  unreadable: DeckSnapshot['unreadable'] = [],
): DeckSnapshot {
  return { rows, unreadable, takenAt: NOW - 2000 };
}

function render(reading: StatusReading): string {
  return renderStatus(reading, NOW).join('\n');
}

describe('renderStatus — the header and the paths', () => {
  it('names the build, the process and how long it has been up', () => {
    const screen = render({ status: status(), sessions: snapshot([row()]) });

    expect(screen).toContain('flightdeck-core 0.0.1');
    expect(screen).toContain('pid 4242');
    expect(screen).toContain('up 1h 02m');
    expect(screen).toContain('node 26.3.0');
  });

  it('names the three files and the binary an operator has to be able to find', () => {
    const screen = render({ status: status(), sessions: snapshot([row()]) });

    expect(screen).toContain('C:\\data\\token');
    expect(screen).toContain('C:\\data\\ingest-key');
    expect(screen).toContain('C:\\data\\flightdeck.db   schema 2');
    expect(screen).toContain('C:\\bin\\claude.exe');
  });

  it('says out loud when claude.exe is missing, because panes cannot open without it', () => {
    const screen = render({
      status: status({ claudePath: undefined }),
      sessions: snapshot([row()]),
    });

    expect(screen).toContain('NOT FOUND');
  });
});

describe('renderStatus — the counters', () => {
  it('prints the five the store side keeps', () => {
    const screen = render({ status: status(), sessions: snapshot([]) });

    expect(screen).toContain('17 stored · 3 snapshots · 0 dropped');
    expect(screen).toContain('4 written · 0 dropped');
    expect(screen).toContain('2 transcripts · 900 ignored · 0 unknown · 1 oversize');
  });

  it('flags a failing store rather than leaving the number to be noticed', () => {
    const screen = render({
      status: status({
        store: { path: 'db', schemaVersion: 2, stored: 1, snapshots: 0, dropped: 9 },
        audit: { written: 0, dropped: 2 },
        transcripts: { tracked: 1, ignored: 0, unknown: 3, oversize: 0 },
      }),
      sessions: snapshot([]),
    });

    expect(screen).toContain('the store is failing');
    expect(screen).toContain('the audit trail has holes');
    // The number that says this build is behind Claude Code (SPEC §8 R2).
    expect(screen).toContain('npm run transcript:probe');
  });
});

describe("renderStatus — the table, which is P1's gate", () => {
  it('prints subscription, name, state, flags, model, context, cost and both quotas', () => {
    const screen = render({ status: status(), sessions: snapshot([row()]) });
    const line = screen.split('\n').find((text) => text.includes('cb5e8102')) ?? '';

    expect(line).toContain('isg');
    expect(line).toContain('the-one');
    expect(line).toContain('working/busy');
    expect(line).toContain('live');
    expect(line).toContain('Opus 5');
    expect(line).toContain('42%');
    expect(line).toContain('$1.25');
    expect(line).toContain('23%');
    expect(line).toContain('88%');
  });

  it('leaves out the state axis a record does not carry, rather than dashing it', () => {
    // An interactive session's listing has no `state` at all (RESEARCH.md F.2.1). The first
    // printing of this said `—/busy`, which is a dash standing in for an absent field.
    const screen = render({
      status: status({ vitals: [] }),
      sessions: snapshot([row({ runState: undefined, status: 'busy' })]),
    });

    expect(screen).toContain('busy');
    expect(screen).not.toContain('—/busy');
  });

  it('badges needs-you on a blocked session', () => {
    const screen = render({
      status: status({ vitals: [] }),
      sessions: snapshot([row({ runState: 'blocked', live: false })]),
    });

    expect(screen).toContain('needs-you');
  });

  it('badges context pressure off the vitals, at the domain threshold', () => {
    const screen = render({
      status: status({ vitals: [vitals({ usedPercentage: 80 })] }),
      sessions: snapshot([row()]),
    });

    expect(screen).toContain('context-pressure');
  });

  it('prints a row with no vitals as dashes, not as zeros', () => {
    const screen = render({ status: status({ vitals: [] }), sessions: snapshot([row()]) });
    const line = screen.split('\n').find((text) => text.includes('cb5e8102')) ?? '';

    // A session that has not rendered a status line yet has no numbers — `0%` would be a lie
    // about a context window, and `$0.00` a lie about cost (RESEARCH.md F.3.5).
    expect(line).not.toContain('0%');
    expect(line).not.toContain('$0.00');
    expect(line).toContain('—');
  });

  it('prints vitals for a session the listing did not return', () => {
    // The interesting direction of the outer join: something is posting from a session
    // `agents --json` does not list, which is worth seeing rather than dropping.
    const screen = render({
      status: status({ vitals: [vitals({ sessionId: OTHER, sessionName: 'orphan' })] }),
      sessions: snapshot([]),
    });

    expect(screen).toContain('orphan');
    expect(screen).toContain('not listed');
  });

  it('says so when there are no sessions at all', () => {
    const screen = render({ status: status({ vitals: [] }), sessions: snapshot([]) });

    expect(screen).toContain('no sessions on either subscription');
  });
});

describe('renderStatus — the footer', () => {
  it('counts the sessions, the live ones and the ones with vitals', () => {
    const screen = render({
      status: status(),
      sessions: snapshot([row(), row({ sessionId: OTHER, shortId: 'd1b2f43c', live: false })]),
    });

    expect(screen).toContain('2 session(s), 1 live · 1 with vitals · swept 2s ago');
  });

  it('names a subscription whose sweep failed, rather than showing it as empty', () => {
    const screen = render({ status: status(), sessions: snapshot([row()], ['365']) });

    // "No sessions" and "I could not look" are different answers (DeckQuery).
    expect(screen).toContain('365   UNREADABLE');
  });

  it('still prints the counters when the whole sweep failed', () => {
    const screen = render({ status: status(), sessions: undefined });

    expect(screen).toContain('17 stored');
    expect(screen).toContain('sessions   UNREADABLE');
  });
});
