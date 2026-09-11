// Which subscription a hook came from — SEC-FS-1, SEC-ING-1 (P1-T5).
//
// A hook payload does not say. It carries a `transcript_path`, and that path lives under the config
// directory of the subscription that produced it (`…\.claude-isg\projects\…`, RESEARCH.md F.1.2),
// so the subscription is *evidence in the payload* rather than a claim about it. That matters: the
// same token authenticates both subscriptions' hooks, so a field saying "I am isg" would be worth
// exactly as much as the sender's honesty. A path that has to fall under one of two known roots
// cannot be talked into a third.
//
// **A path that matches neither root is refused, not guessed at.** Fail closed: an event attributed
// to the wrong subscription is worse than one that was never accepted, because every consumer
// downstream — the deck's rows, the store, `gone` detection — keys off the pair.
//
// Pure string comparison rather than `node:path`, and deliberately: this is the application layer,
// where the rule is that nothing reaches for the filesystem (CODING-STANDARDS §2). Nothing here
// resolves, opens or normalises a real path — it compares a string against two strings. P1-T7 is
// the task that opens a transcript, and it is an adapter's job when it does.
import type { SubscriptionId } from '../../contracts/session.ts';

/** Windows, so both separators appear and case does not matter. */
function canonical(path: string): string {
  return path.replaceAll('/', '\\').toLowerCase();
}

export class SubscriptionPaths {
  private readonly roots: readonly (readonly [SubscriptionId, string])[];

  /**
   * @param roots the config directory of each subscription, from `ClaudeInstall.configDirFor`.
   * Passed as data rather than as the adapter, so this stays testable and inward-pointing.
   */
  constructor(roots: Readonly<Record<SubscriptionId, string>>) {
    this.roots = Object.entries(roots).map(([id, root]) => [idOf(id), canonical(root)]);
  }

  /**
   * The subscription whose config directory contains `path`, or `undefined`.
   *
   * The separator check is not fussiness: a bare `startsWith` would read
   * `…\.claude-365-backup\…` as the `365` subscription, and a sibling directory an unrelated tool
   * created would start attributing events to a real subscription.
   */
  public of(path: string | undefined): SubscriptionId | undefined {
    if (path === undefined || path === '') return undefined;
    const candidate = canonical(path);
    const match = this.roots.find(([, root]) => root !== '' && candidate.startsWith(`${root}\\`));
    return match?.[0];
  }
}

/**
 * `Object.entries` widens the key to `string`; this narrows it back without an `as`.
 *
 * It cannot fail — the parameter type is a full `Record<SubscriptionId, string>`, so every key is
 * one of the two — and `'365'` is the honest answer for the impossible branch rather than a throw
 * in a constructor.
 */
function idOf(key: string): SubscriptionId {
  return key === 'isg' ? 'isg' : '365';
}
