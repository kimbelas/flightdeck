// Context and cost, as one immutable value (R6).
//
// Both arrive from the statusLine payload, and P0-T5 measured the trap this class exists to hold:
// before the first turn the numbers are present and NULL — not absent, and not zero
// (RESEARCH.md F.3.5). A model that cannot tell "no data yet" from "0 % used" will draw an empty
// context bar on a session that simply has not spoken yet, which is exactly the reading the deck
// is supposed to make trustworthy.
//
// So every field here is explicitly `| undefined` and the flag derivation asks `>= threshold`,
// which is false for undefined rather than accidentally true.
import { InvalidValueError } from '../shared/typed-error.ts';

/** SPEC §5 — the point at which the deck says a session is running out of room. */
export const CONTEXT_PRESSURE_PERCENT = 80;

export interface VitalsInput {
  readonly usedPercentage: number | undefined;
  readonly costUsd: number | undefined;
}

export class SessionVitals {
  private readonly used: number | undefined;
  private readonly cost: number | undefined;

  private constructor(used: number | undefined, cost: number | undefined) {
    this.used = used;
    this.cost = cost;
  }

  /** Percent of the context window used, or `undefined` before the first turn. */
  public get usedPercentage(): number | undefined {
    return this.used;
  }

  /** Cost comes from Claude Code, never from token arithmetic (D5). */
  public get costUsd(): number | undefined {
    return this.cost;
  }

  public get isUnderPressure(): boolean {
    return this.used !== undefined && this.used >= CONTEXT_PRESSURE_PERCENT;
  }

  /** Nothing known yet — the shape a session has before its first turn. */
  public static unknown(): SessionVitals {
    return new SessionVitals(undefined, undefined);
  }

  /**
   * @throws InvalidValueError on a percentage outside 0–100 or a negative cost. Both are shape
   *   surprises rather than user input, so they throw rather than returning a Result: a context
   *   window 130 % full means the payload changed and the parser above has stopped understanding it.
   */
  public static of(input: VitalsInput): SessionVitals {
    const { usedPercentage, costUsd } = input;
    if (usedPercentage !== undefined && (usedPercentage < 0 || usedPercentage > 100)) {
      throw new InvalidValueError('usedPercentage', { usedPercentage });
    }
    if (costUsd !== undefined && costUsd < 0) {
      throw new InvalidValueError('costUsd', { costUsd });
    }
    return new SessionVitals(usedPercentage, costUsd);
  }

  public equals(other: SessionVitals): boolean {
    return this.used === other.usedPercentage && this.cost === other.costUsd;
  }
}
