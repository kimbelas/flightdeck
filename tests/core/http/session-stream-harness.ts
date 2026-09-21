// The rig both `GET /stream` test files build on — the same role reconciler-harness.ts plays.
//
// It exists because the route's two replays are tested separately: session-stream-route.test.ts
// asks what reaches a subscriber about SESSIONS, session-stream-quota.test.ts asks what reaches one
// about QUOTA, and neither file should own half a fake stream.
//
// `FakeQuota` counts how often it is asked on purpose. The count is an assertion in both files: the
// route must ask once per subscriber and once per vitals event, and must never relay what the event
// itself carried — a `statusline` payload is a whole `StatuslineReport`, with a `transcript_path`
// in it (SEC-DATA-2).
import type { DraftEvent } from '../../../contracts/fd-event.ts';
import type { QuotaSummary } from '../../../contracts/quota-summary.ts';
import type { DeckSnapshot, SessionRow } from '../../../contracts/session-row.ts';
import { AskBroadcast } from '../../../core/application/ask-broadcast.ts';
import { EventHub } from '../../../core/application/event-hub.ts';
import type { EventStream } from '../../../core/http/route.ts';
import { SessionStreamRoute, type LiveQuota } from '../../../core/http/session-stream-route.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';

interface SentFrame {
  readonly name: string;
  readonly data: unknown;
}

export class FakeStream implements EventStream {
  public readonly sent: SentFrame[] = [];
  public comments = 0;
  public closed = false;
  private readonly handlers: (() => void)[] = [];

  public get names(): readonly string[] {
    return this.sent.map((frame) => frame.name);
  }

  public send(name: string, data: unknown): void {
    this.sent.push({ name, data });
  }

  public comment(): void {
    this.comments += 1;
  }

  public onClose(handler: () => void): void {
    this.handlers.push(handler);
  }

  public close(): void {
    this.closed = true;
    for (const handler of this.handlers) handler();
  }
}

export const ROW: SessionRow = {
  sessionId: 'aaaaaaaa-0000-0000-0000-000000000000',
  shortId: 'aaaaaaaa',
  subscription: '365',
  kind: 'background',
  name: 'fd-one',
  cwd: 'C:\\work',
  startedAt: 1000,
  live: true,
  runState: 'working',
  status: undefined,
  attachable: true,
  notAttachableBecause: undefined,
};

export function snapshotOf(rows: readonly SessionRow[] = [ROW]): DeckSnapshot {
  return { rows, unreadable: ['isg'], takenAt: 5000 };
}

/**
 * A quota source that counts how often it is asked.
 *
 * The count is the assertion, not decoration: the route must ask it once per subscriber and once
 * per vitals event and never relay what a `statusline` event actually carried, because that payload
 * is a whole `StatuslineReport` with a `transcript_path` in it (SEC-DATA-2).
 */
export class FakeQuota implements LiveQuota {
  public asked = 0;
  private readonly value: QuotaSummary;

  constructor(value: QuotaSummary) {
    this.value = value;
  }

  public summary(): QuotaSummary {
    this.asked += 1;
    return this.value;
  }
}

export function quotaOf(usedPercentage: number | undefined = 42): QuotaSummary {
  return {
    at: 9000,
    subscriptions: [
      {
        subscription: 'isg',
        at: 8000,
        fiveHour: { usedPercentage, resetsAt: 20_000, at: 8000 },
        sevenDay: { usedPercentage: 7, resetsAt: 900_000, at: 8000 },
        claudeVersion: '2.1.7',
        spendUsd: 1.25,
        spendingSessions: 1,
      },
    ],
  };
}

export interface Rig {
  readonly route: SessionStreamRoute;
  readonly hub: EventHub;
  readonly quota: FakeQuota;
  readonly scheduler: FakeScheduler;
  readonly logger: FakeLogger;
}

export function rig(snapshot: DeckSnapshot = snapshotOf()): Rig {
  const hub = new EventHub(new FakeLogger());
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const quota = new FakeQuota(quotaOf());
  const route = new SessionStreamRoute({
    sessions: { snapshot: () => snapshot },
    quota,
    feed: hub,
    ask: new AskBroadcast(),
    scheduler,
    logger,
  });
  return { route, hub, quota, scheduler, logger };
}

export function reconcileEvent(type: string, payload: unknown): DraftEvent {
  return {
    at: 1000,
    sessionId: ROW.sessionId,
    subscription: '365',
    source: 'reconcile',
    type,
    payload,
  };
}
