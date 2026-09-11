// The Session entity — one session on one subscription, and the transitions it owns (R5, R7).
//
// Every mutation returns a NEW Session rather than changing this one. The reconciler compares a
// fresh sweep against what it holds and the deck renders immutable snapshots, so a session that
// mutates in place turns "did anything change?" into a question neither can answer.
//
// The entity deliberately knows nothing about `claude agents --json`. It is handed facts; P1-T3's
// adapter is what knows that the presence of `pid` means live and that a short id is the uuid's
// first segment.
import type {
  SessionFlag,
  SessionKind,
  SubscriptionId,
  EndReason,
} from '../../contracts/session.ts';
import { deriveFlags } from './session-flags.ts';
import type { SessionId } from './session-id.ts';
import { SessionState, type Observation, type TransitionError } from './session-state.ts';
import { SessionVitals } from './session-vitals.ts';
import { ok, type Result } from '../shared/result.ts';

export interface SessionFacts {
  readonly id: SessionId;
  readonly subscription: SubscriptionId;
  readonly kind: SessionKind;
  /** The session's name, or undefined — an unnamed session is ordinary, not an error. */
  readonly name: string | undefined;
  readonly cwd: string;
  readonly startedAt: Date;
}

/** Everything about a session that changes. `SessionFacts` is everything that does not. */
interface SessionSnapshot {
  readonly state: SessionState;
  readonly vitals: SessionVitals;
  /** When this session last produced an event, or undefined if it never has. */
  readonly lastEventAt: Date | undefined;
  /** Set by the hooks feed for the needs-you signals the listing cannot carry (P1-T5). */
  readonly attentionSignal: boolean;
}

export class Session {
  private readonly facts: SessionFacts;
  private readonly snapshot: SessionSnapshot;

  private constructor(facts: SessionFacts, snapshot: SessionSnapshot) {
    this.facts = facts;
    this.snapshot = snapshot;
  }

  public get id(): SessionId {
    return this.facts.id;
  }

  public get subscription(): SubscriptionId {
    return this.facts.subscription;
  }

  public get kind(): SessionKind {
    return this.facts.kind;
  }

  public get name(): string | undefined {
    return this.facts.name;
  }

  public get cwd(): string {
    return this.facts.cwd;
  }

  public get startedAt(): Date {
    return this.facts.startedAt;
  }

  public get state(): SessionState {
    return this.snapshot.state;
  }

  public get vitals(): SessionVitals {
    return this.snapshot.vitals;
  }

  public static start(facts: SessionFacts, observation: Observation): Session {
    return new Session(facts, {
      state: SessionState.initial(observation),
      vitals: SessionVitals.unknown(),
      lastEventAt: undefined,
      attentionSignal: false,
    });
  }

  /** Every flag that applies as of `now` (D7). `now` is a parameter so nothing here reads a clock. */
  public flagsAt(now: Date): readonly SessionFlag[] {
    const { lastEventAt } = this.snapshot;
    return deriveFlags({
      state: this.snapshot.state,
      vitals: this.snapshot.vitals,
      sinceLastEventMs:
        lastEventAt === undefined ? undefined : now.getTime() - lastEventAt.getTime(),
      attentionSignal: this.snapshot.attentionSignal,
    });
  }

  public needsYouAt(now: Date): boolean {
    return this.flagsAt(now).includes('needs-you');
  }

  /** Folds in a fresh sweep. Propagates the state machine's refusal rather than swallowing it. */
  public observe(observation: Observation): Result<Session, TransitionError> {
    const next = this.snapshot.state.observe(observation);
    if (!next.ok) return next;
    return ok(this.with({ state: next.value }));
  }

  /**
   * Records why the session ended, from the audit row or `daemon.log` (F.2.3).
   *
   * Clearing the attention signal is part of it: a session that was blocked when it ended is not
   * still asking for anything, and leaving the flag set would keep a finished row at the top of
   * the deck forever.
   */
  public endedBecause(reason: EndReason): Result<Session, TransitionError> {
    const next = this.snapshot.state.endedBecause(reason);
    if (!next.ok) return next;
    return ok(this.with({ state: next.value, attentionSignal: false }));
  }

  public resume(): Result<Session, TransitionError> {
    const next = this.snapshot.state.resume();
    if (!next.ok) return next;
    return ok(this.with({ state: next.value, attentionSignal: false }));
  }

  public withVitals(vitals: SessionVitals): Session {
    return this.with({ vitals });
  }

  /** An event arrived — a hook firing, a transcript line. What `wedged` measures silence against. */
  public sawEventAt(at: Date): Session {
    return this.with({ lastEventAt: at });
  }

  /** The hooks feed's contribution to `needs-you`: the signals the listing cannot carry (P1-T5). */
  public withAttentionSignal(attentionSignal: boolean): Session {
    return this.with({ attentionSignal });
  }

  private with(changes: Partial<SessionSnapshot>): Session {
    return new Session(this.facts, { ...this.snapshot, ...changes });
  }
}
