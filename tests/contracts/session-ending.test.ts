// The one word for how a session ended — D62. The deck's label and the toast's title both read it.
import { describe, expect, it } from 'vitest';
import { ENDING_LABELS, endingOf } from '../../contracts/session-ending.ts';
import type { SessionRow } from '../../contracts/session-row.ts';

type EndFields = Pick<SessionRow, 'live' | 'endReason' | 'retireReason'>;

const stopped = (over: Partial<EndFields>): EndFields => ({
  live: false,
  endReason: 'unknown',
  retireReason: undefined,
  ...over,
});

describe('endingOf', () => {
  it.each([
    [{ endReason: 'finished' }, 'finished'],
    [{ endReason: 'stopped' }, 'stopped'],
    [{ endReason: 'retired', retireReason: 'settled' }, 'retired-finished'],
    [{ endReason: 'retired', retireReason: 'idle-prompt' }, 'retired-waiting'],
    [{ endReason: 'retired', retireReason: 'empty-idle' }, 'retired-unused'],
    [{ endReason: 'retired' }, 'retired'],
  ] satisfies [Partial<EndFields>, string][])('reads %o as %s', (fields, ending) => {
    expect(endingOf(stopped(fields))).toBe(ending);
  });

  it('names nothing while the session runs, whatever an old ending says', () => {
    expect(endingOf(stopped({ live: true, endReason: 'retired' }))).toBeUndefined();
  });

  // `failed` is the listing's own word and the errored toast's; `unknown` is nobody knowing.
  it('names nothing for an unknown ending or a failure', () => {
    expect(endingOf(stopped({}))).toBeUndefined();
    expect(endingOf(stopped({ endReason: 'failed' }))).toBeUndefined();
  });

  // F.2.15: an idle-prompt retirement is an abandoned request for attention, not a completion.
  it('never calls a retirement while waiting "finished"', () => {
    expect(ENDING_LABELS['retired-waiting']).toBe('retired while waiting for you');
    expect(ENDING_LABELS['retired-waiting']).not.toMatch(/finish/u);
  });
});
