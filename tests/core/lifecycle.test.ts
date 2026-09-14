// `startCore` and `stopCore` cover the same set — P2-T4.
//
// This file exists because of one bug and it is worth being blunt about it. Feed 4 has a 1 s poll
// that the caller is supposed to start, the caller started the reconciler and not it, and from
// P1-T7 until P2-T4 the transcript reader tracked every transcript it was told about and read none
// of them. Nothing in 1 155 unit tests noticed, because every one of them calls the class it is
// testing directly; nothing in `/status` looked wrong, because a feed that has read nothing and a
// feed that has read only uninteresting lines print the same three zeroes.
//
// So the assertion is not "does `start` work" — it is **"is anything startable left unstarted"**,
// which is the shape the bug actually had.
import { describe, expect, it } from 'vitest';
import { startCore } from '../../core/shutdown.ts';

/** Every timer-owning collaborator, reduced to "was I started". */
class Startable {
  public started = 0;

  public start(): void {
    this.started += 1;
  }

  public stop(): void {
    // Not exercised here; `core-server.test.ts` owns the stop order.
  }
}

describe('startCore', () => {
  it('starts BOTH feeds with timers, not just the reconciler', () => {
    const reconciler = new Startable();
    const transcripts = new Startable();

    startCore({ reconciler, transcripts });

    expect(reconciler.started).toBe(1);
    // The one that was missing. Feed 4 polls every second and reads nothing until this is called.
    expect(transcripts.started).toBe(1);
  });

  it('is idempotent, so a caller that starts twice does not run two polls', () => {
    const reconciler = new Startable();
    const transcripts = new Startable();

    startCore({ reconciler, transcripts });
    startCore({ reconciler, transcripts });

    // `startCore` forwards every call; idempotence is each `start`'s own, and both use `??=` on
    // their timer. Asserting the forwarding here keeps this test about the list rather than about
    // somebody else's timer.
    expect(reconciler.started).toBe(2);
    expect(transcripts.started).toBe(2);
  });
});
