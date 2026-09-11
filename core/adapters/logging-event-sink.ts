// The EventSink core runs on until the store and the SSE stream exist (P1-T7, P1-T9).
//
// Not a placeholder that does nothing: an operator tailing the log can watch the reconciler find
// sessions, notice them change and retire them, which is the only way to see P1-T4 working before
// there is anything to see it in. It is also the cheapest possible subscriber, which keeps the
// "publishing must not cost the producer anything" promise honest from the first day.
//
// **The payload does not go in the log.** A `SessionRow` carries the session's name and cwd —
// user data, and `LogDetails` refuses anything but scalars anyway (SEC-DATA-2). What is recorded
// is what happened and to which session, which is what a log is for.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { EventSink } from '../ports/event-sink.ts';
import type { Logger } from '../ports/logger.ts';

export class LoggingEventSink implements EventSink {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  public publish(event: DraftEvent): void {
    try {
      this.logger.info('event', {
        source: event.source,
        type: event.type,
        sessionId: event.sessionId,
        subscription: event.subscription,
      });
    } catch {
      // The port promises the producer never sees a failure, and a closed stdout is a real way
      // for one to happen. There is nowhere left to report it, which is why this is empty.
    }
  }
}
