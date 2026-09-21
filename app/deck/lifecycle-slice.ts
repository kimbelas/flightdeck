// The four verbs that change what a session IS — P4-T2a, P4-T2b, P4-T2, P6-T2.
//
// `DeckStore` went back over its 250-line limit when the fourth arrived, and these are the
// coherent piece to lift out: each one POSTs a session to its own literal path, says why in
// English if it is refused, and answers whether core did it. That is one shape, four times.
//
// **None of them re-reads anything afterwards, and that is the rule rather than an omission.**
// The reconciler's next sweep publishes the change and it arrives on the stream, so a row goes on
// saying "running" for a sweep after it was stopped — which is honest. It is running until core
// has seen that it is not, and a deck that edited the row itself would be guessing at the outcome
// of a write (the argument `forgetProject` makes one layer over).
//
// **It is a slice, not a second store.** There is one `DeckState` and one set of subscribers; this
// is handed the API port and a way to publish, and holds nothing of its own.
import {
  CORE_POPOUT_PATH,
  CORE_REMOVE_PATH,
  CORE_RESUME_PATH,
  CORE_STOP_PATH,
} from '../../contracts/deck-routes.ts';
import type { SessionRef } from '../../contracts/session-ref.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { DeckApi, JsonReply } from './deck-api.ts';
import { whyNotPoppedOut, whyNotRemoved, whyNotResumed, whyNotStopped } from './deck-replies.ts';

/** The two fields of `DeckState` every verb here touches. */
export interface LifecycleHeld {
  readonly loading: boolean;
  readonly error: string | undefined;
}

export class LifecycleSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: Partial<LifecycleHeld>) => void;

  constructor(api: DeckApi, publish: (changes: Partial<LifecycleHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Wakes a stopped background session so a pane can attach to it — P4-T2a.
   *
   * The subscription and the FULL id, because `--resume` refuses anything else: a short id forks a
   * copy and succeeds, which is the one failure mode nothing reports (RESEARCH.md F.2.7).
   */
  public resume(subscription: SubscriptionId, sessionId: string): Promise<boolean> {
    return this.send(CORE_RESUME_PATH, { subscription, sessionId }, whyNotResumed);
  }

  /**
   * Stops a running background session, without deleting it — P4-T2b.
   *
   * The whole ref goes over, both ids: `stop` takes the SHORT one (F.2.8b) and the deck does not
   * derive it (contracts/session-ref.ts).
   */
  public stop(ref: SessionRef): Promise<boolean> {
    return this.send(CORE_STOP_PATH, ref, whyNotStopped);
  }

  /**
   * Hands a session to Windows Terminal, detaching its pane first — P6-T2.
   *
   * The title and the folder ride along because core cannot look them up: they are on the row
   * already on screen, and core screens both (`PopoutRoute`).
   *
   * @returns whether the terminal opened. The caller closes the card on a `true`, which is
   * reading core's answer rather than guessing at it: core says `detached` when it released
   * the hold. Left open, the card would say "evicted" — the right word for somebody ELSE
   * taking the attach (F.2.6), and the wrong one for a button you pressed on purpose.
   */
  public popOut(ref: SessionRef, title: string, cwd: string | undefined): Promise<boolean> {
    return this.send(CORE_POPOUT_PATH, { ...ref, title, cwd }, whyNotPoppedOut);
  }

  /**
   * Deletes a background session and its conversation — P4-T2.
   *
   * The confirm step is the ROW's (`SessionRowCard`), not this method's: one that asked would be
   * one nothing else could call.
   */
  public remove(ref: SessionRef): Promise<boolean> {
    return this.send(CORE_REMOVE_PATH, ref, whyNotRemoved);
  }

  /**
   * One POST, and the sentence for when it is refused.
   *
   * Every verb here has its OWN `whyNot…`, which is passed in rather than chosen from the path:
   * the four unions are deliberately separate (`launch-reply.ts`) because the verbs sound alike
   * and are not, and a sentence saying "could not stop" after a failed delete would be worse than
   * no sentence at all.
   */
  private async send(
    path: string,
    body: unknown,
    why: (reply: JsonReply | undefined) => string,
  ): Promise<boolean> {
    this.publish({ loading: true, error: undefined });
    const reply = await this.api.post(path, body);
    const done = reply?.status === 200;
    this.publish({ loading: false, error: done ? undefined : why(reply) });
    return done;
  }
}
