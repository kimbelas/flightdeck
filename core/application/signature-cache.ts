// Reuse a value until its signature moves or its TTL lapses — P3-T2, lifted from `statusline.py`.
//
// **This is the whole of the approach the task says to lift**, and it is more specific than
// "cached". `statusline.py`'s `cached(key, ttl, sig, fn)` recomputes when EITHER the signature has
// changed OR the time-to-live has run out, and the two do different jobs:
//
// - the **signature** is what makes it correct. For git that is `mtime(.git/HEAD)/mtime(.git/index)`
//   — two stats, microseconds — and any commit, checkout, stage or merge moves one of them. So a
//   cached reading is not stale in the way a plain TTL cache is stale: the common case is that
//   nothing happened, and nothing happened is something this can prove rather than assume.
// - the **TTL** is what keeps it honest when the signature cannot see the change. `git status`
//   also reports the working tree, and editing a tracked file moves neither `HEAD` nor `index`.
//   Four seconds is `statusline.py`'s number for exactly this, measured against a person watching
//   a status line.
//
// **In memory, not on disk.** `statusline.py` writes its cache to a JSON file under `%TEMP%`
// because it is a fresh process on every render and has nowhere else to keep anything. Core is a
// long-lived process, so the same design costs a `Map`. It also means the cache dies with the
// process, which is the right lifetime for a reading about now.
//
// **A failure is a value and is cached like any other.** A `git` that exited non-zero answers
// `undefined`, and that answer is held for the TTL rather than retried on every request — a
// repository core cannot read is not a reason to spawn a process four times a second.
import type { Clock } from '../ports/clock.ts';

interface Entry<T> {
  readonly signature: string;
  readonly expiresAt: number;
  readonly value: T;
}

export class SignatureCache<T> {
  private readonly clock: Clock;
  private readonly entries = new Map<string, Entry<T>>();

  constructor(clock: Clock) {
    this.clock = clock;
  }

  /**
   * The held value, or a freshly computed one.
   *
   * @param key what is being cached. One namespace per cache instance, so two callers cannot
   * collide by both keying on a project path.
   * @param signature the cheap observation that proves nothing has changed. `''` is a legitimate
   * value and means "there is nothing cheap to observe" — a linked worktree whose git directory
   * lies outside every imported root is the case that has one — and then the TTL is the only
   * thing keeping the entry alive, which is the honest degradation rather than a special case.
   * @param ttlMs how long a value survives even when its signature has not moved.
   * @returns whatever `compute` answered, which may be a failure. @throws whatever `compute` does.
   */
  public async value(
    key: string,
    signature: string,
    ttlMs: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const now = this.clock.now().getTime();
    const held = this.entries.get(key);
    // `signature` is never `undefined`, so a matching optional chain also proves `held` is there.
    if (held?.signature === signature && held.expiresAt > now) return held.value;
    const value = await compute();
    this.entries.set(key, { signature, expiresAt: now + ttlMs, value });
    return value;
  }

  /**
   * Drops every entry whose key is not in `keys`.
   *
   * Called with the imported projects on each sweep, so forgetting a folder takes its cached
   * reading with it. Not an optimisation — the registry holds a handful of rows — but a cache that
   * only grows is a cache that remembers a project after the owner revoked permission to read it,
   * and that is the wrong thing for this particular cache to do (SEC-FS-1).
   */
  public keep(keys: readonly string[]): void {
    for (const key of this.entries.keys()) {
      if (!keys.includes(key)) this.entries.delete(key);
    }
  }
}
