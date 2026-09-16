// The cache `statusline.py` uses, as a class — P3-T2.
//
// Two conditions, and the cases below are about the difference between them. The SIGNATURE is what
// makes reuse correct: nothing happened, and that is provable rather than assumed. The TTL is what
// keeps it honest when the signature cannot see the change — editing a tracked file moves neither
// `.git/HEAD` nor `.git/index`, so a cache with only a signature would hold a stale dirty count
// for ever.
import { describe, expect, it } from 'vitest';
import { SignatureCache } from '../../../core/application/signature-cache.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';

const TTL = 4000;

interface Harness {
  readonly cache: SignatureCache<number>;
  readonly clock: FakeClock;
  /** How many times the cache has had to compute rather than answer. */
  readonly computed: () => number;
  readonly get: (signature: string) => Promise<number>;
}

function build(): Harness {
  const clock = new FakeClock(1000);
  const cache = new SignatureCache<number>(clock);
  let calls = 0;
  return {
    cache,
    clock,
    computed: () => calls,
    get: (signature: string) =>
      cache.value('project', signature, TTL, () => {
        calls += 1;
        return Promise.resolve(calls);
      }),
  };
}

describe('SignatureCache', () => {
  it('computes the first time it is asked', async () => {
    const harness = build();
    expect(await harness.get('a/b')).toBe(1);
    expect(harness.computed()).toBe(1);
  });

  it('reuses the value while the signature holds and the TTL has not lapsed', async () => {
    const harness = build();
    await harness.get('a/b');
    harness.clock.advance(TTL - 1);
    expect(await harness.get('a/b')).toBe(1);
    expect(harness.computed()).toBe(1);
  });

  it('recomputes when the signature moves, however recently it was computed', async () => {
    const harness = build();
    await harness.get('a/b');
    // A commit moved `.git/HEAD`. There is no waiting for a TTL after that.
    expect(await harness.get('a/c')).toBe(2);
  });

  it('recomputes when the TTL lapses, although the signature has not moved', async () => {
    const harness = build();
    await harness.get('a/b');
    // Editing a tracked file moves neither mtime. This is the case the TTL exists for.
    harness.clock.advance(TTL + 1);
    expect(await harness.get('a/b')).toBe(2);
  });

  it('holds a failure like any other value, so a broken repository is not spawned at repeatedly', async () => {
    const clock = new FakeClock(1000);
    const cache = new SignatureCache<string | undefined>(clock);
    let calls = 0;
    const failing = (): Promise<undefined> => {
      calls += 1;
      return Promise.resolve(undefined);
    };
    await cache.value('p', 'sig', TTL, failing);
    await cache.value('p', 'sig', TTL, failing);
    expect(calls).toBe(1);
  });

  it('treats an empty signature as a signature, leaving the TTL as the only thing holding it', async () => {
    // A linked worktree whose main repository was not imported has nothing cheap to stat. That is
    // a degradation rather than a special case, and it has to go through the same code.
    const harness = build();
    await harness.get('');
    expect(await harness.get('')).toBe(1);
    harness.clock.advance(TTL + 1);
    expect(await harness.get('')).toBe(2);
  });

  it('keeps one namespace per instance, so two keys cannot answer for each other', async () => {
    const clock = new FakeClock(1000);
    const cache = new SignatureCache<string>(clock);
    await cache.value('a', 'sig', TTL, () => Promise.resolve('first'));
    expect(await cache.value('b', 'sig', TTL, () => Promise.resolve('second'))).toBe('second');
  });

  it('drops what is not kept, so a forgotten project takes its reading with it', async () => {
    const clock = new FakeClock(1000);
    const cache = new SignatureCache<string>(clock);
    await cache.value('gone', 'sig', TTL, () => Promise.resolve('held'));
    cache.keep(['still-here']);
    // Recomputed rather than answered from a cache filled while permission still existed.
    expect(await cache.value('gone', 'sig', TTL, () => Promise.resolve('fresh'))).toBe('fresh');
  });

  it('keeps what is kept', async () => {
    const clock = new FakeClock(1000);
    const cache = new SignatureCache<string>(clock);
    await cache.value('here', 'sig', TTL, () => Promise.resolve('held'));
    cache.keep(['here']);
    expect(await cache.value('here', 'sig', TTL, () => Promise.resolve('fresh'))).toBe('held');
  });
});
