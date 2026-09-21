// Two live sessions in one working tree, on two accounts — P6-T5, SPEC §5.6.
//
// The cases that carry the design are the ones that say NOTHING: the same folder twice on ONE
// account is a normal day, and a session that has finished is editing nothing. A warning that
// fired on either would be a warning about the product working.
import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../contracts/session-row.ts';
import { duplicateCwdKeys, sharedCwdWarning, sharesCwd } from '../../contracts/duplicate-cwd.ts';

function rowOf(over: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    shortId: '337975f9',
    subscription: '365',
    kind: 'background',
    name: 'alpha',
    cwd: 'C:\\repo',
    startedAt: 1,
    live: true,
    runState: 'working',
    status: 'busy',
    attachable: true,
    notAttachableBecause: undefined,
    ...over,
  };
}

describe('duplicateCwdKeys', () => {
  it('finds nothing in an empty list', () => {
    expect(duplicateCwdKeys([])).toEqual(new Set());
  });

  it('finds the folder two accounts are both live in', () => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: '365' }),
      rowOf({ sessionId: 'b', subscription: 'isg' }),
    ]);

    expect([...keys]).toEqual(['c:\\repo']);
  });

  /**
   * One account, same folder, twice — and nothing is said.
   *
   * `claude-isg-orch` and `claude-isg-ticket` are two of the four built-in presets and both default
   * to the project root, so this is what a normal morning looks like. SPEC scopes the warning to
   * "under both subscriptions" for exactly this reason.
   */
  it('says nothing about two sessions in one folder on the SAME account', () => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: 'isg' }),
      rowOf({ sessionId: 'b', subscription: 'isg' }),
    ]);

    expect(keys.size).toBe(0);
  });

  // A finished session holds nothing open and is editing nothing. `runState` is the last state a
  // row was SEEN in (G.24), so anything that reads as a hazard has to check that it is still live.
  it('says nothing when the other account’s session has ended', () => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: '365' }),
      rowOf({ sessionId: 'b', subscription: 'isg', live: false, runState: 'done' }),
    ]);

    expect(keys.size).toBe(0);
  });

  it('says nothing about two accounts in DIFFERENT folders', () => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: '365', cwd: 'C:\\one' }),
      rowOf({ sessionId: 'b', subscription: 'isg', cwd: 'C:\\two' }),
    ]);

    expect(keys.size).toBe(0);
  });

  /**
   * The two sessions were almost certainly started from two different places, so the two spellings
   * of the folder are the most likely shape of this — not the least.
   */
  it.each([
    { left: 'C:\\Repo', right: 'c:\\repo', why: 'a different case' },
    { left: 'C:\\repo', right: 'C:\\repo\\', why: 'a trailing separator' },
    { left: 'C:\\repo', right: 'C:/repo', why: 'the other separator' },
  ])('treats $why as the same working tree', ({ left, right }) => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: '365', cwd: left }),
      rowOf({ sessionId: 'b', subscription: 'isg', cwd: right }),
    ]);

    expect(keys.size).toBe(1);
  });

  it('ignores a row with no folder at all, rather than grouping them under one', () => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: '365', cwd: '' }),
      rowOf({ sessionId: 'b', subscription: 'isg', cwd: '' }),
    ]);

    expect(keys.size).toBe(0);
  });

  it('finds more than one shared folder', () => {
    const keys = duplicateCwdKeys([
      rowOf({ sessionId: 'a', subscription: '365', cwd: 'C:\\one' }),
      rowOf({ sessionId: 'b', subscription: 'isg', cwd: 'C:\\one' }),
      rowOf({ sessionId: 'c', subscription: '365', cwd: 'C:\\two' }),
      rowOf({ sessionId: 'd', subscription: 'isg', cwd: 'C:\\two' }),
    ]);

    expect(keys.size).toBe(2);
  });
});

describe('sharesCwd', () => {
  it('says yes for a live row in a shared folder', () => {
    expect(sharesCwd(rowOf(), new Set(['c:\\repo']))).toBe(true);
  });

  it('matches whatever way the row spells the folder', () => {
    expect(sharesCwd(rowOf({ cwd: 'C:/Repo/' }), new Set(['c:\\repo']))).toBe(true);
  });

  it.each([
    { row: rowOf({ live: false }), why: 'a row that is not live' },
    { row: rowOf({ cwd: '' }), why: 'a row with no folder' },
    { row: rowOf({ cwd: 'C:\\elsewhere' }), why: 'a row in another folder' },
  ])('says no for $why', ({ row }) => {
    expect(sharesCwd(row, new Set(['c:\\repo']))).toBe(false);
  });
});

describe('sharedCwdWarning', () => {
  // The useful half is which OTHER window to go and look in, so it names the other account rather
  // than saying "both".
  it.each([
    { subscription: '365' as const, other: 'isg' },
    { subscription: 'isg' as const, other: '365' },
  ])('names the other account for a $subscription session', ({ subscription, other }) => {
    expect(sharedCwdWarning(rowOf({ subscription }))).toContain(other);
  });

  it('says what is actually wrong with it', () => {
    expect(sharedCwdWarning(rowOf())).toContain('one working tree');
  });
});
