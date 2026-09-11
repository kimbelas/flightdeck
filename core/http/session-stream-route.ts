// `GET /stream` — the deck's live feed, with the current state as its first frame (P1-T9).
//
// Two things arrive by different routes and must not contradict each other: what core knows NOW,
// and what changed SINCE. A stream that only sent deltas would leave a deck that connected one
// second after a sweep showing nothing until something moved — so every subscriber is sent a
// `snapshot` before its first delta, built from the reconciler's own map rather than from a fresh
// sweep. Replay is therefore free: no `claude.exe`, no 1.5 s, no second opinion about what is true
// (BUILD-PLAN §4, "Replays current state on connect").
//
// **Only `reconcile` events are forwarded, and that is a security boundary, not an omission.**
// `DraftEvent.payload` is `unknown` because it is the producer's raw material, and the hook
// payloads P1-T5 will publish carry model text — `Stop` carries `last_assistant_message`
// (SEC-UI-2). Nothing reaches a browser here that core did not itself derive into a `SessionRow`,
// and the row is re-parsed on the way out rather than trusted. When P1-T5 lands, it decides what of
// a hook event is safe to show and adds the frame for it; silence until then is the fail-closed
// answer.
//
// **`unreadable` only moves on the snapshot.** A subscription that becomes unreadable mid-stream
// does not publish an event at all — the reconciler counts it and touches nothing (trap 1) — and
// `DraftEvent` has no shape for a subscription-level fact, since `sessionId` is required. So the
// banner about a subscription core cannot read is as old as the connection, and `refresh` is what
// updates it. Widening the event shape is P1-T8's call, where the store decides what an event is.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import { parseSessionRow, type DeckSnapshot } from '../../contracts/session-row.ts';
import { CORE_STREAM_PATH, type StreamFrame } from '../../contracts/stream-event.ts';
import type { EventFeed } from '../application/event-hub.ts';
import type { Logger } from '../ports/logger.ts';
import type { Scheduler } from '../ports/scheduler.ts';
import type { EventStream, StreamRoute } from './route.ts';

/**
 * How often a comment frame goes out on an idle stream.
 *
 * Not for the browser — `EventSource` ignores comments. It is for core: a write is the only way to
 * find out that a peer has gone without telling us, and a subscriber that is never written to is a
 * subscription that could outlive its socket for as long as the deck is open.
 */
const HEARTBEAT_MS = 20_000;

/** What the stream replays. `Reconciler` is what supplies it; a test supplies a snapshot directly. */
export interface LiveSessions {
  snapshot(): DeckSnapshot;
}

export interface StreamRouteParts {
  readonly sessions: LiveSessions;
  readonly feed: EventFeed;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

export class SessionStreamRoute implements StreamRoute {
  public readonly method = 'GET';
  public readonly path = CORE_STREAM_PATH;

  private readonly sessions: LiveSessions;
  private readonly feed: EventFeed;
  private readonly scheduler: Scheduler;
  private readonly logger: Logger;
  private readonly streams = new Set<EventStream>();

  constructor(parts: StreamRouteParts) {
    this.sessions = parts.sessions;
    this.feed = parts.feed;
    this.scheduler = parts.scheduler;
    this.logger = parts.logger;
  }

  /** How many subscribers are connected. One per deck tab; zero when nothing is watching. */
  public get openCount(): number {
    return this.streams.size;
  }

  /**
   * Sends the replay, then subscribes.
   *
   * In that order, and it matters: an event published between the snapshot and the subscription
   * would be lost, while one published in the other order is at worst sent twice — and an upsert is
   * idempotent, so a duplicate costs a re-render and a missed one costs a wrong deck.
   */
  public open(stream: EventStream): void {
    stream.send('snapshot', this.sessions.snapshot());
    const subscription = this.feed.subscribe((event) => {
      relay(stream, event);
    });
    const heartbeat = this.scheduler.every(HEARTBEAT_MS, () => {
      stream.comment('hb');
    });
    this.streams.add(stream);
    stream.onClose(() => {
      subscription.cancel();
      heartbeat.cancel();
      this.streams.delete(stream);
      this.logger.info('stream_closed', { streams: this.streams.size });
    });
    this.logger.info('stream_open', { streams: this.streams.size });
  }

  /**
   * Ends every open stream — shutdown, called before the server is closed.
   *
   * Without it `server.close()` never resolves: it waits for connections to end, and an SSE
   * response is a connection that by design never does. Core would not exit on Ctrl+C for as long
   * as one deck tab was open.
   */
  public closeAll(): void {
    for (const stream of [...this.streams]) stream.close();
  }
}

/**
 * One event to one frame, or nothing.
 *
 * `gone` carries the identity alone because by the time it is published the row has already been
 * removed from the reconciler's map — there is nothing left to send, and the deck only needs to
 * know which row to drop.
 */
function relay(stream: EventStream, event: DraftEvent): void {
  const frame = toFrame(event);
  if (frame === undefined) return;
  stream.send(frame.name, frame.data);
}

function toFrame(event: DraftEvent): StreamFrame | undefined {
  if (event.source !== 'reconcile') return undefined;
  if (event.type === 'gone') {
    return {
      name: 'session.gone',
      data: { sessionId: event.sessionId, subscription: event.subscription },
    };
  }
  if (event.type !== 'seen' && event.type !== 'changed') return undefined;
  const row = parseSessionRow(event.payload);
  return row === undefined ? undefined : { name: 'session.upsert', data: row };
}
