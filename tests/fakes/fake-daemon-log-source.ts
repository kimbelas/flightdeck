// An in-memory `daemon.log` — the fake for `DaemonLogSource` (CODING-STANDARDS §10.1).
//
// It holds TEXT, as the real adapter returns it, so the parse under test is the real one
// (contracts/daemon-log.ts) rather than a second opinion about what a line means.
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DaemonLogSource } from '../../core/ports/daemon-log-source.ts';

export class FakeDaemonLogSource implements DaemonLogSource {
  /** Which subscriptions were asked about, in order. */
  public readonly reads: SubscriptionId[] = [];

  private readonly logs = new Map<SubscriptionId, string>();

  /** Gives one subscription a log. One with none answers `undefined`, as the real one does. */
  public willReturn(subscription: SubscriptionId, text: string): this {
    this.logs.set(subscription, text);
    return this;
  }

  public tail(subscription: SubscriptionId): Promise<string | undefined> {
    this.reads.push(subscription);
    return Promise.resolve(this.logs.get(subscription));
  }
}

/** One log line in Claude Code's own format, at an instant given in ms. */
export function logLine(at: number, channel: 'bg' | 'supervisor', message: string): string {
  return `[${new Date(at).toISOString()}] [${channel}] ${message}`;
}
