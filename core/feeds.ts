// The event side of the composition root — lifted out of `main.ts` in P1-T12.
//
// It is still composition: these are real adapters, constructed in one place and injected
// (CODING-STANDARDS.md §2). What made it a second file is that `main.ts` reached its size limit,
// and of the three things it did — issue the secrets, wire the feeds, wire the server — this is
// the one with a story of its own, so it is the seam that costs a reader the least. `shutdown.ts`
// was split off the same file for the same kind of reason.
import { SUBSCRIPTION_IDS } from '../contracts/session.ts';
import { AskBroadcast } from './application/ask-broadcast.ts';
import { EventHub } from './application/event-hub.ts';
import { HookQueue } from './application/hook-queue.ts';
import { QuotaReport } from './application/quota-report.ts';
import { Reconciler } from './application/reconciler.ts';
import { StatuslineQueue } from './application/statusline-queue.ts';
import { TranscriptReader } from './application/transcript-reader.ts';
import { VitalsRegistry } from './application/vitals-registry.ts';
import { type ClaudeCliSessionSource } from './adapters/claude-cli/claude-cli-session-source.ts';
import { type ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { FanOutEventSink } from './adapters/fan-out-event-sink.ts';
import { LoggingEventSink } from './adapters/logging-event-sink.ts';
import { FsDirectoryWatcher } from './adapters/node/fs-directory-watcher.ts';
import { FsTranscriptFile } from './adapters/node/fs-transcript-file.ts';
import { NodeScheduler } from './adapters/node/node-scheduler.ts';
import { StoringEventSink } from './adapters/storing-event-sink.ts';
import { ReadPolicy } from './domain/read-policy.ts';
import { SessionStreamRoute } from './http/session-stream-route.ts';
import { type SystemClock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';
import type { Store } from './ports/store.ts';

/** The event side: what notices things, what is told about them, and what hands them to a browser. */
export interface Feeds {
  readonly reconciler: Reconciler;
  readonly stream: SessionStreamRoute;
  readonly hooks: HookQueue;
  readonly statusline: StatuslineQueue;
  readonly transcripts: TranscriptReader;
  /** The newest vitals per session. `flightdeck-core status` (P1-T12) and the header (P2-T3). */
  readonly vitals: VitalsRegistry;
  /** Held only so `GET /status` can print how many events reached the store (P1-T12). */
  readonly storing: StoringEventSink;
  /** Where `AskRunner` publishes and the stream subscribes — P4-T4, D48. */
  readonly ask: AskBroadcast;
}

export interface FeedParts {
  readonly install: ClaudeInstall;
  readonly sessions: ClaudeCliSessionSource;
  readonly store: Store;
  readonly clock: SystemClock;
  readonly logger: Logger;
}

/**
 * The 10 s sweep and the `fs.watch` nudge (DECISIONS.md D3 feeds 3 and 5), and the fan-out.
 *
 * Built together because they share two things and both would be bugs if they did not. **One
 * scheduler**: the sweep, the watcher's 2 s stat poll and every stream's heartbeat run on it, so
 * there is a single place timers are created and, more to the point, cancelled — `NodeScheduler`
 * deliberately does not `unref`, and the one nobody cancelled keeps core alive after Ctrl+C.
 * **One hub**: the reconciler publishes into it without knowing who is listening, and the log is
 * still one of the listeners — an operator reading `.flightdeck-core.log` an hour later needs
 * what the browser saw, and the browser is not there an hour later (P1-T9).
 */
export function buildFeeds(parts: FeedParts): Feeds {
  const { install, sessions, store, clock, logger } = parts;
  const scheduler = new NodeScheduler();
  const hub = new EventHub(logger);
  // Feed 4 rides the fan-out as a SUBSCRIBER, not as a producer: it learns which transcripts are
  // live from the `transcript_path` the hook and statusLine payloads already carry, so nothing
  // walks 1.1 GB of `projects/` looking for them and no existing class had to change (P1-T7).
  const transcripts = new TranscriptReader({
    file: new FsTranscriptFile(),
    // SEC-FS-2: what a reported `transcript_path` is allowed to be, checked before any open. The
    // two config dirs are the only roots, so a policy built from them says both "whose" and
    // "what" (P1-T12).
    policy: new ReadPolicy(SUBSCRIPTION_IDS.map((id) => install.configDirFor(id))),
    scheduler,
    logger,
  });
  // Four listeners, and none of them is redundant: the log is what an operator reads an hour
  // later, the hub is what a browser sees now, the store is what can still answer next month, and
  // the transcript reader is only here to learn which files are live (P1-T7).
  const storing = new StoringEventSink(store, logger);
  const sink = new FanOutEventSink([new LoggingEventSink(logger), hub, storing, transcripts]);
  const vitals = new VitalsRegistry();
  const reconciler = new Reconciler({
    source: sessions,
    sink,
    scheduler,
    watcher: new FsDirectoryWatcher(install.watchTargets(), scheduler, logger),
    clock,
    logger,
  });
  const ask = new AskBroadcast();
  return {
    reconciler,
    ask,
    // The stream replays two things on connect and they come from different places: the session
    // table from the reconciler's map, the quota gauges from the vitals registry (P2-T3). Neither
    // costs a sweep.
    stream: new SessionStreamRoute({
      sessions: reconciler,
      quota: new QuotaReport({ vitals, clock }),
      feed: hub,
      ask,
      scheduler,
      logger,
    }),
    // A hook publishes into the same sink and then asks the reconciler to look — evidence that
    // something happened, never a claim about what is true now (D3, P1-T5).
    hooks: new HookQueue({ sink, trigger: reconciler, scheduler, clock, logger }),
    // The statusLine posts on every render and asks for nothing: it records vitals and publishes
    // only when they moved. No nudge — a sweep per repaint would be `agents --json` twice a
    // second for news that is already in the payload (P1-T6).
    statusline: new StatuslineQueue({ sink, registry: vitals, scheduler, clock, logger }),
    transcripts,
    vitals,
    storing,
  };
}
