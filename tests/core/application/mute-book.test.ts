// Which sessions are silenced, and the two things that would make a mute a lie — P6-T3.
//
// Both are about the copy: the set is held in memory because the reader is on the toast path, and
// held in the store because core raises the toast with no browser open. So every test below is
// really one question — do the two agree — asked from a different side.
import { describe, expect, it } from 'vitest';
import { MuteBook } from '../../../core/application/mute-book.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';
import { MAX_SESSION_MUTES } from '../../../core/ports/store.ts';

const ALPHA = { sessionId: '337975f9-1a2b-4c3d-8e4f-5a6b7c8d9e0f', subscription: '365' } as const;
const BETA = { sessionId: '4d5e6f70-1a2b-4c3d-8e4f-5a6b7c8d9e0f', subscription: 'isg' } as const;

function build(store: FakeStore = new FakeStore()): { book: MuteBook; store: FakeStore } {
  return { book: new MuteBook({ store, clock: new FakeClock(), logger: new FakeLogger() }), store };
}

describe('MuteBook', () => {
  it('knows nothing until something is muted', () => {
    const { book } = build();

    expect(book.isMuted(ALPHA)).toBe(false);
    expect(book.keys()).toEqual([]);
  });

  it('mutes and unmutes one session', () => {
    const { book } = build();

    book.set(ALPHA, true);
    expect(book.isMuted(ALPHA)).toBe(true);

    book.set(ALPHA, false);
    expect(book.isMuted(ALPHA)).toBe(false);
  });

  // The whole reason this is in the store rather than in the page: core toasts with nothing open.
  it('survives a restart, because a second book over the same store reads the same set', () => {
    const { book, store } = build();
    book.set(ALPHA, true);

    const { book: afterRestart } = build(store);

    expect(afterRestart.isMuted(ALPHA)).toBe(true);
  });

  // `sessionKey`, not the uuid: the same uuid under the other config dir is a different session.
  it('keys on the subscription as well, so one mute does not silence two sessions', () => {
    const { book } = build();

    book.set({ sessionId: ALPHA.sessionId, subscription: 'isg' }, true);

    expect(book.isMuted({ sessionId: ALPHA.sessionId, subscription: 'isg' })).toBe(true);
    expect(book.isMuted(ALPHA)).toBe(false);
  });

  it('answers with the whole set, sorted, so two replies compare equal', () => {
    const { book } = build();

    book.set(BETA, true);
    const set = book.set(ALPHA, true);

    expect(set).toEqual([`365:${ALPHA.sessionId}`, `isg:${BETA.sessionId}`]);
  });

  it('is idempotent — muting a muted session adds nothing', () => {
    const { book } = build();

    book.set(ALPHA, true);
    expect(book.set(ALPHA, true).length).toBe(1);
  });

  it('unmuting a session nobody muted is not an error', () => {
    const { book } = build();

    expect(book.set(ALPHA, false)).toEqual([]);
  });

  /**
   * The failure the write order exists for.
   *
   * A book that updated memory first and the store second would report this mute as set, silence
   * the session for the rest of the day, and lose it at the next restart. Reporting the truth —
   * that it did not happen — is what makes the switch in the deck honest.
   */
  it('does not believe in a mute the store refused to keep', () => {
    const { book, store } = build();
    store.breakWrites();

    const set = book.set(ALPHA, true);

    expect(set).toEqual([]);
    expect(book.isMuted(ALPHA)).toBe(false);
  });

  // The key is a session id: it dies with its session, so nothing else would ever bound this.
  it('keeps the table bounded, because a session id is not a key that gets reused', () => {
    const { book, store } = build();

    for (let index = 0; index <= MAX_SESSION_MUTES; index += 1) {
      book.set({ sessionId: uuidFor(index), subscription: '365' }, true);
    }

    expect(store.mutedSessions().length).toBe(MAX_SESSION_MUTES);
  });
});

/** A distinct, shape-valid session id per index. */
function uuidFor(index: number): string {
  const tail = index.toString(16).padStart(12, '0');
  return `337975f9-1a2b-4c3d-8e4f-${tail}`;
}
