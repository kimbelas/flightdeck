// The state machine, as a value object that returns its successor or a typed error (R6, R7).
//
// The important thing about this machine is what it does NOT try to know. Claude Code owns the
// state; Flightdeck observes it. So the transitions here are not "what may this session do next",
// they are "what may we believe next" — and the only genuinely impossible observation is a session
// that was finished and is running again under the same uuid, because resuming forks a copy under
// a NEW id unless it is exactly `--resume <full-uuid>` (RESEARCH.md F.2.7).
//
// Liveness is carried here because it is not derivable from `runState`: the presence of `pid` is
// the liveness test, and `status` is absent often enough that nothing may key off it (F.2.1).
import type { ActivityStatus, EndReason, RunState } from '../../contracts/session.ts';
import { err, ok, type Result } from '../shared/result.ts';
import { FlightdeckError } from '../shared/typed-error.ts';

/** Run states from which a session is not coming back without an explicit resume. */
const TERMINAL: readonly RunState[] = ['done', 'failed'];

export class TransitionError extends FlightdeckError {
  constructor(reason: string, details: Readonly<Record<string, unknown>>) {
    super('illegal_transition', reason, details);
  }
}

export interface Observation {
  /** Absent on an interactive record, which carries no `state` at all. */
  readonly runState: RunState | undefined;
  /** Absent surprisingly often, including on a live 3-second-old session (F.2.1). */
  readonly status: ActivityStatus | undefined;
  /** Presence of `pid` in the record. The liveness test; not inferred from runState. */
  readonly live: boolean;
}

export class SessionState {
  private readonly observation: Observation;
  private readonly reason: EndReason;

  private constructor(observation: Observation, reason: EndReason) {
    this.observation = observation;
    this.reason = reason;
  }

  public get runState(): RunState | undefined {
    return this.observation.runState;
  }

  public get status(): ActivityStatus | undefined {
    return this.observation.status;
  }

  public get isLive(): boolean {
    return this.observation.live;
  }

  /**
   * Why the session stopped running, or `unknown`.
   *
   * `unknown` is the honest answer for most of P1: `claude stop` and a daemon retirement both leave
   * `state: done`, and only `daemon.log` separates them (F.2.3).
   */
  public get endReason(): EndReason {
    return this.reason;
  }

  public get isTerminal(): boolean {
    return this.observation.runState !== undefined && TERMINAL.includes(this.observation.runState);
  }

  public static initial(observation: Observation): SessionState {
    return new SessionState(observation, 'unknown');
  }

  /**
   * Folds in a fresh observation from the listing.
   *
   * @returns the next state, or a TransitionError if the session appears to have come back from a
   *   terminal state under the same id — which the CLI's own resume semantics make impossible, so
   *   it means the shape changed and P1-T3's parser is reading something it does not understand.
   */
  public observe(next: Observation): Result<SessionState, TransitionError> {
    if (this.isTerminal && next.runState !== undefined && !TERMINAL.includes(next.runState)) {
      return err(
        new TransitionError('a terminal session cannot run again under the same id', {
          from: this.observation.runState,
          to: next.runState,
        }),
      );
    }
    // A terminal session keeps the reason it was given; a running one has nothing to keep.
    return ok(new SessionState(next, this.isTerminal ? this.reason : 'unknown'));
  }

  /**
   * Records why the session ended, from a source that actually knows — Flightdeck's own audit row
   * for actions it took (SEC-PROC-3), `daemon.log` for everything else (P7-T4).
   *
   * @returns a TransitionError if the session is still running, or if a known reason would be
   *   overwritten by a different one. A reason that changes is two sources disagreeing, and
   *   silently taking the last writer would hide it.
   */
  public endedBecause(reason: EndReason): Result<SessionState, TransitionError> {
    if (!this.isTerminal) {
      return err(
        new TransitionError('a running session has not ended', { runState: this.runState, reason }),
      );
    }
    if (this.reason !== 'unknown' && this.reason !== reason) {
      return err(
        new TransitionError('the end reason is already known', { was: this.reason, reason }),
      );
    }
    return ok(new SessionState(this.observation, reason));
  }

  /** A resume of this exact session — the only form that does not fork a copy (F.2.7). */
  public resume(): Result<SessionState, TransitionError> {
    if (!this.isTerminal) {
      return err(
        new TransitionError('only a terminal session resumes', { runState: this.runState }),
      );
    }
    return ok(new SessionState({ runState: 'working', status: undefined, live: true }, 'unknown'));
  }

  public equals(other: SessionState): boolean {
    return (
      this.runState === other.runState &&
      this.status === other.status &&
      this.isLive === other.isLive &&
      this.reason === other.endReason
    );
  }
}
