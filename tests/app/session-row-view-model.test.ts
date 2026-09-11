// The row's presentation, tested without React — CODING-STANDARDS §3 and §10.4.
//
// "Can this row open a pane, and what does it say if not" is the deck's most important question.
// Answering it should not require rendering a page.
import { describe, expect, it } from 'vitest';
import { INTERACTIVE_NOT_ATTACHABLE, type SessionRow } from '../../contracts/session-row.ts';
import { SessionRowViewModel } from '../../app/deck/session-row-view-model.ts';

const BASE: SessionRow = {
  sessionId: '337975f9-c9c0-454a-a22a-2d53a86e0ea9',
  shortId: '337975f9',
  subscription: '365',
  kind: 'background',
  name: 'fd-pane-1',
  cwd: 'C:\\Users\\dev\\Documents\\development\\flightdeck',
  startedAt: 1_000_000,
  live: true,
  runState: 'working',
  status: 'busy',
  attachable: true,
  notAttachableBecause: undefined,
};

function view(overrides: Partial<SessionRow> = {}): SessionRowViewModel {
  return new SessionRowViewModel({ ...BASE, ...overrides });
}

describe('SessionRowViewModel — identity', () => {
  it('keys on subscription and session, because ids are only unique within a config dir', () => {
    expect(view().key).toBe('365:337975f9-c9c0-454a-a22a-2d53a86e0ea9');
  });

  it('falls back to the short id when a session has no name', () => {
    expect(view({ name: undefined }).title).toBe('337975f9');
  });

  it('shows the last path segment, not the whole cwd', () => {
    expect(view().project).toBe('flightdeck');
  });

  it('does not crash on an empty cwd, which a malformed record can carry', () => {
    expect(view({ cwd: '' }).project).toBe('—');
  });
});

describe('SessionRowViewModel — attachability', () => {
  it('offers a pane on an attachable row', () => {
    expect(view().canOpenPane).toBe(true);
    expect(view().blockedReason).toBeUndefined();
  });

  it('carries core’s reason verbatim rather than inventing one', () => {
    const row = view({
      kind: 'interactive',
      attachable: false,
      notAttachableBecause: INTERACTIVE_NOT_ATTACHABLE,
    });

    expect(row.canOpenPane).toBe(false);
    expect(row.blockedReason).toBe(INTERACTIVE_NOT_ATTACHABLE);
  });

  it('builds a target carrying the FULL uuid and the subscription', () => {
    // The wire takes the uuid; narrowing it to the short form `attach` wants is core's job
    // (RESEARCH.md G.1). A view model that shortened it here would reintroduce that bug.
    expect(view().target).toEqual({
      kind: 'session',
      sessionId: '337975f9-c9c0-454a-a22a-2d53a86e0ea9',
      subscription: '365',
    });
  });
});

describe('SessionRowViewModel — tone', () => {
  it.each([
    {
      why: 'blocked means needs-you (D29)',
      row: { runState: 'blocked' as const },
      tone: 'needs-you',
    },
    { why: 'working', row: { runState: 'working' as const }, tone: 'working' },
    {
      why: 'busy with no run state',
      row: { runState: undefined, status: 'busy' as const },
      tone: 'working',
    },
    { why: 'idle', row: { runState: undefined, status: 'idle' as const }, tone: 'idle' },
    { why: 'not running at all', row: { live: false }, tone: 'ended' },
  ])('$why', ({ row, tone }) => {
    expect(view(row).tone).toBe(tone);
  });

  it('never reads needs-you off a dead session', () => {
    expect(view({ live: false, runState: 'blocked' }).tone).toBe('ended');
  });
});

describe('SessionRowViewModel — age', () => {
  it.each([
    { ago: 5_000, shown: '5s' },
    { ago: 90_000, shown: '2m' },
    { ago: 3_600_000 + 300_000, shown: '1h 5m' },
  ])('renders $shown', ({ ago, shown }) => {
    expect(view().startedAgo(BASE.startedAt + ago)).toBe(shown);
  });

  it('never shows a negative age when the clocks disagree', () => {
    expect(view().startedAgo(BASE.startedAt - 60_000)).toBe('0s');
  });
});
