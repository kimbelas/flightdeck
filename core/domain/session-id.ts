// The identifier every boundary uses, instead of a bare string (CODING-STANDARDS §8).
//
// Two ids exist for one session and they are not independent: `claude agents --json` prints a short
// id AND a session uuid, and the short id is the uuid's first segment — confirmed on all eight
// sessions P0-T4 observed and on every roster worker since (RESEARCH.md F.2.1, F.7.5). So the pair
// is one value, not two fields that happen to agree, and nothing needs a lookup table to get from
// one to the other.
//
// Modelling it as a pair is also what stops the class of bug P0-T9 hit: a fixture whose short id
// and uuid had drifted apart parsed fine and asserted a relationship that no longer held.
import { InvalidValueError } from '../shared/typed-error.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT_LENGTH = 8;

export class SessionId {
  private readonly uuid: string;

  private constructor(uuid: string) {
    this.uuid = uuid;
  }

  /** The full lowercase uuid. `--resume` accepts nothing else (RESEARCH.md F.2.7). */
  public get full(): string {
    return this.uuid;
  }

  /** The short form the listing prints and `stop`, `rm`, `logs` and `attach` take. */
  public get short(): string {
    return this.uuid.slice(0, SHORT_LENGTH);
  }

  /**
   * @throws InvalidValueError when the text is not a lowercase uuid.
   *
   * Lowercase specifically: `--resume` is documented to take the full uuid and F.2.7 measured that
   * anything it does not recognise silently FORKS a copy under a new id instead of failing. A
   * parser that quietly upper-cases is a parser that loses a session.
   */
  public static parse(text: string): SessionId {
    if (!UUID_PATTERN.test(text)) {
      throw new InvalidValueError('SessionId', { length: text.length });
    }
    return new SessionId(text);
  }

  /** True when `short` is this session's id — the listing's own relationship, checkable. */
  public matchesShort(short: string): boolean {
    return this.short === short;
  }

  public equals(other: SessionId): boolean {
    return this.uuid === other.uuid;
  }

  public toString(): string {
    return this.short;
  }
}
