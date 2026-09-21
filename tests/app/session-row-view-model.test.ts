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

describe('SessionRowViewModel — deleting (P4-T2)', () => {
  it('offers rm on every background session, live or not', () => {
    // The one getter in this family that is not the complement of another. `rm` deletes a live
    // session as readily as a stopped one (F.2.8) — that is what the confirm step exists for, not
    // a reason to hide the verb where it works.
    expect(view({ live: true }).canRemove).toBe(true);
    expect(view({ live: false }).canRemove).toBe(true);
  });

  it('never offers it for an interactive session, which is not core’s to delete', () => {
    expect(view({ kind: 'interactive' }).canRemove).toBe(false);
  });

  it('says a live session is ended as well as deleted', () => {
    const warning = view({ live: true }).removeWarning;

    expect(warning).toContain('running');
    expect(warning).toContain('There is no resume.');
  });

  it('says only what a stopped one loses, which is not the same sentence', () => {
    const warning = view({ live: false }).removeWarning;

    expect(warning).not.toContain('running');
    expect(warning).toContain('conversation is deleted');
  });
});

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

describe('SessionRowViewModel — the / filter (P2-T5)', () => {
  it('keeps everything for an empty or blank query', () => {
    expect(view().matches('')).toBe(true);
    expect(view().matches('   ')).toBe(true);
  });

  it('matches what the row actually shows — name, project, subscription, kind and state', () => {
    expect(view().matches('fd-pane')).toBe(true);
    expect(view().matches('flightdeck')).toBe(true);
    expect(view().matches('365')).toBe(true);
    expect(view().matches('background')).toBe(true);
    expect(view().matches('working')).toBe(true);
  });

  it('matches the short id, which is the identifier a person can actually read off the row', () => {
    expect(view({ name: undefined }).matches('337975f9')).toBe(true);
  });

  it('does not match on the full session id — a UUID nobody types would match too much', () => {
    expect(view().matches('c9c0-454a')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(view().matches('FLIGHTDECK')).toBe(true);
  });

  it('requires every term, so a second word narrows the list', () => {
    expect(view().matches('365 flightdeck')).toBe(true);
    expect(view().matches('isg flightdeck')).toBe(false);
  });
});
