// Scaffolding for reconciler.test.ts — the same split as tests/core/http/pty-socket-harness.ts.
//
// The reconciler takes six collaborators, and a test that built all six inline would bury the one
// line that matters under the five that never vary. Everything here is fakes: no timers, no
// filesystem, no `claude.exe`.
import { setImmediate } from 'node:timers';
import type { SubscriptionId } from '../../../contracts/session.ts';
import { Reconciler } from '../../../core/application/reconciler.ts';
import { Session } from '../../../core/domain/session.ts';
import { SessionId } from '../../../core/domain/session-id.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeDirectoryWatcher } from '../../fakes/fake-directory-watcher.ts';
import { FakeEventSink } from '../../fakes/fake-event-sink.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';
import { FakeSessionSource } from '../../fakes/fake-session-source.ts';

export interface Spec {
  readonly id: string;
  readonly kind?: 'interactive' | 'background';
  readonly live?: boolean;
  readonly runState?: 'working' | 'blocked' | 'done';
  readonly name?: string;
}

/** One session. The short id is the uuid's first segment, so `id` is what tests assert on. */
export function session(spec: Spec, subscription: SubscriptionId): Session {
  return Session.start(
    {
      id: SessionId.parse(`${spec.id}-0000-0000-0000-000000000000`),
      subscription,
      kind: spec.kind ?? 'background',
      name: spec.name ?? spec.id,
      cwd: 'C:\\work',
      startedAt: new Date(1000),
    },
    { runState: spec.runState, status: undefined, live: spec.live ?? true },
  );
}

export interface Rig {
  readonly reconciler: Reconciler;
  readonly source: FakeSessionSource;
  readonly sink: FakeEventSink;
  readonly scheduler: FakeScheduler;
  readonly watcher: FakeDirectoryWatcher;
  readonly logger: FakeLogger;
}

export function rig(): Rig {
  const source = new FakeSessionSource();
  const sink = new FakeEventSink();
  const scheduler = new FakeScheduler();
  const watcher = new FakeDirectoryWatcher();
  const logger = new FakeLogger();
  const reconciler = new Reconciler({
    source,
    sink,
    scheduler,
    watcher,
    clock: new FakeClock(),
    logger,
  });
  return { reconciler, source, sink, scheduler, watcher, logger };
}

/**
 * Lets a reconcile started by a timer or a nudge run to completion.
 *
 * `start()` and the debounce both fire `void this.reconcile()`, so there is no promise for a test
 * to await. Every fake here settles immediately, which makes one turn of the macrotask queue
 * enough — and deterministic, rather than a sleep that is usually long enough.
 */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export function typesOf(sink: FakeEventSink): readonly string[] {
  return sink.published.map((event) => event.type);
}
