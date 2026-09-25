// What a stopped row says about how it stopped — D62.
//
// The listing says `done` for a stop, a finish and a retirement (F.2.3), and a session retired
// while blocked keeps saying `blocked` with no `pid` (F.2.15). Core now reads the ending off
// `daemon.log` onto the row; this is the deck saying it.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../contracts/session-row.ts';
import { SessionRowViewModel } from '../../app/deck/session-row-view-model.ts';

const STOPPED: SessionRow = {
  sessionId: '57218c6e-c9c0-454a-a22a-2d53a86e0ea9',
  shortId: '57218c6e',
  subscription: 'isg',
  kind: 'background',
  name: 'fd-spike-c',
  cwd: 'C:\\work\\flightdeck',
  startedAt: 1_000_000,
  live: false,
  runState: 'blocked',
  status: undefined,
  attachable: false,
  notAttachableBecause: 'Not running. Resume it to attach.',
  endReason: 'unknown',
  retireReason: undefined,
};

function view(overrides: Partial<SessionRow>): SessionRowViewModel {
  return new SessionRowViewModel({ ...STOPPED, ...overrides });
}

describe('SessionRowViewModel — how a stopped session ended (D62)', () => {
  it('says a retirement while blocked was a retirement while waiting for you', () => {
    const row = view({ endReason: 'retired', retireReason: 'idle-prompt' });

    expect(row.stateLabel).toBe('retired while waiting for you');
  });

  it.each([
    [{ endReason: 'stopped', runState: 'done' }, 'stopped'],
    [{ endReason: 'finished', runState: 'done' }, 'finished'],
    [
      { endReason: 'retired', retireReason: 'settled', runState: 'done' },
      'retired after finishing',
    ],
    [{ endReason: 'retired', retireReason: 'empty-idle' }, 'retired before its first turn'],
  ] satisfies [Partial<SessionRow>, string][])('says %o as "%s"', (fields, label) => {
    expect(view(fields).stateLabel).toBe(label);
  });

  it('keeps the listing’s word when nothing knows how it ended', () => {
    expect(view({}).stateLabel).toBe('blocked');
    expect(view({ runState: 'done' }).stateLabel).toBe('done');
  });

  // G.24: a dead session must not look like one waiting on you, however it died. The words say
  // what happened; the tone stays the ended one, and the sort order is `needsAttention`'s.
  it('stays dimmed as ended — the words change, the tone does not', () => {
    expect(view({ endReason: 'retired', retireReason: 'idle-prompt' }).tone).toBe('ended');
  });

  it('is findable by its ending with the / filter', () => {
    expect(view({ endReason: 'retired', retireReason: 'idle-prompt' }).matches('retired')).toBe(
      true,
    );
  });
});
