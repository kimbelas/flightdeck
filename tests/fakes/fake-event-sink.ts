// In-memory EventSink — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// It records rather than asserts, so a test says what it cares about. `failNext` exists because
// the port's contract is that publishing NEVER throws at the caller: a producer that is only ever
// tested against a sink that works has not been tested against the contract at all.
import type { DraftEvent } from '../../contracts/fd-event.ts';
import type { EventSink } from '../../core/ports/event-sink.ts';

export class FakeEventSink implements EventSink {
  public readonly published: DraftEvent[] = [];
  /** Makes the next `publish` fail internally. The failure is swallowed, as a real sink must. */
  public failNext = false;
  public swallowed = 0;

  public get last(): DraftEvent | undefined {
    return this.published.at(-1);
  }

  /** Everything published with this `type`, in order. */
  public ofType(type: string): readonly DraftEvent[] {
    return this.published.filter((event) => event.type === type);
  }

  public publish(event: DraftEvent): void {
    if (this.failNext) {
      this.failNext = false;
      this.swallowed += 1;
      return;
    }
    this.published.push(event);
  }
}
