// The mute half of the `Store` contract, run against every implementation — P6-T3.
//
// A fourth file for the reason the third one gives — the others are at their line limit — and for
// one of its own: this is the first table in here that is neither an observation nor a row keyed
// by something the owner can see. It is a standing decision keyed by a session id, which is a key
// that DIES, so the bound is not an optimisation and the composite key is not a nicety. An
// implementation that got either wrong would silence the wrong session, or the right one for one
// afternoon and never again.
import { describe, expect, it } from 'vitest';
import { MAX_SESSION_MUTES, type Store } from '../../../core/ports/store.ts';

const ALPHA = '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const BETA = '4d5e6f70-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

/** A distinct, shape-valid session id per index — for the bound, which needs more than two. */
function uuidFor(index: number): string {
  return `337975f9-1a2b-4c3d-8e4f-${index.toString(16).padStart(12, '0')}`;
}

export function describeMuteStoreContract(name: string, make: () => Store): void {
  describe(`${name} — muted sessions`, () => {
    it('holds nothing until something is muted', () => {
      expect(make().mutedSessions()).toEqual([]);
    });

    it('remembers a mute, with the two ids and the instant it was set', () => {
      const store = make();

      store.muteSession('365', ALPHA, 1_700_000_000_000);

      expect(store.mutedSessions()).toEqual([
        { subscription: '365', sessionId: ALPHA, mutedAt: 1_700_000_000_000 },
      ]);
    });

    // The composite key. A session id is unique only within a config dir, so the same uuid under
    // the other subscription is a different session and a second row.
    it('keeps the same uuid on both subscriptions apart', () => {
      const store = make();

      store.muteSession('365', ALPHA, 1);
      store.muteSession('isg', ALPHA, 2);

      expect(store.mutedSessions().length).toBe(2);
    });

    it('replaces rather than duplicates when the same session is muted twice', () => {
      const store = make();

      store.muteSession('365', ALPHA, 1);
      store.muteSession('365', ALPHA, 9);

      expect(store.mutedSessions()).toEqual([
        { subscription: '365', sessionId: ALPHA, mutedAt: 9 },
      ]);
    });

    it('answers newest mute first', () => {
      const store = make();

      store.muteSession('365', ALPHA, 1);
      store.muteSession('isg', BETA, 2);

      expect(store.mutedSessions().map((one) => one.sessionId)).toEqual([BETA, ALPHA]);
    });

    // Really removed, not tombstoned: the port says so, and a reader that missed a tombstone would
    // leave a session silent forever.
    it('removes a row on unmute, and says that it did', () => {
      const store = make();
      store.muteSession('365', ALPHA, 1);

      expect(store.unmuteSession('365', ALPHA)).toBe(true);
      expect(store.mutedSessions()).toEqual([]);
    });

    it('tells a caller that there was nothing to unmute', () => {
      expect(make().unmuteSession('365', ALPHA)).toBe(false);
    });

    it('unmutes only the subscription it was asked about', () => {
      const store = make();
      store.muteSession('365', ALPHA, 1);
      store.muteSession('isg', ALPHA, 1);

      store.unmuteSession('365', ALPHA);

      expect(store.mutedSessions()).toEqual([
        { subscription: 'isg', sessionId: ALPHA, mutedAt: 1 },
      ]);
    });

    /**
     * The bound, which is the part an implementation can get wrong silently.
     *
     * A session id dies with its session, so nothing else would ever shrink this table: without
     * the prune it grows with every session ever muted, for as long as Flightdeck is installed.
     */
    it('keeps only the newest MAX_SESSION_MUTES', () => {
      const store = make();

      for (let index = 0; index <= MAX_SESSION_MUTES; index += 1) {
        store.muteSession('365', uuidFor(index), index);
      }

      const kept = store.mutedSessions();
      expect(kept.length).toBe(MAX_SESSION_MUTES);
      // The newest survives and the oldest is the one that went.
      expect(kept[0]?.sessionId).toBe(uuidFor(MAX_SESSION_MUTES));
      expect(kept.some((one) => one.sessionId === uuidFor(0))).toBe(false);
    });
  });
}
