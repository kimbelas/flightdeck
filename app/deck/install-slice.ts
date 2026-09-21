// The version chip's panel state — P4-T5.
//
// `PresetsSlice`'s sibling, for the reason all six slices exist: `DeckStore` owns the stream, the
// retry and the session verbs, and it is at its line limit.
//
// **Nothing here is fetched until the chip is pressed.** `claude doctor` costs ~2 s per
// subscription (RESEARCH.md F.10.1) and answers a question nobody is asking while they watch the
// session list. This is the habit `PreviewSlice` set for `claude logs`: a read that spawns a
// process happens on a click and at no other time.
//
// **A respawn reply carries the ids the CLI named, and the panel prints those.** `--all` skips a
// session that has finished (F.10.4), so "respawned 1 of 2" is the only honest thing to say and it
// can only be said from the answer.
import {
  CORE_DOCTOR_PATH,
  CORE_RESPAWN_PATH,
  CORE_UPDATE_PATH,
} from '../../contracts/deck-routes.ts';
import {
  parseInstallHealthReply,
  type InstallHealth,
  type UpdateResult,
} from '../../contracts/install-health.ts';
import type { SubscriptionId } from '../../contracts/session.ts';

/** What one `respawn` answered — the ids, never a count this side assumed. */
export interface RespawnReport {
  readonly subscription: SubscriptionId;
  readonly respawned: readonly string[];
}

/** The three fields of `DeckState` this slice owns. */
export interface InstallHeld {
  /** Health per subscription, keyed by id. A key absent means nobody has asked. */
  readonly health: Readonly<Record<string, InstallHealth | undefined>>;
  /** What the last update attempt said, or `undefined` before one. */
  readonly update: UpdateResult | undefined;
  /** What the last respawn restarted, or `undefined` before one. */
  readonly respawn: RespawnReport | undefined;
}

interface DeckApiLike {
  get(path: string): Promise<{ readonly status: number; readonly body: unknown } | undefined>;
  post(
    path: string,
    body: unknown,
  ): Promise<{ readonly status: number; readonly body: unknown } | undefined>;
}

export class InstallSlice {
  private readonly api: DeckApiLike;
  private readonly publish: (changes: Partial<InstallHeld>) => void;
  private held: Readonly<Record<string, InstallHealth | undefined>> = {};

  constructor(api: DeckApiLike, publish: (changes: Partial<InstallHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Reads one subscription's installation health.
   *
   * The key is set to `undefined` first, which is what draws the spinner: a key present and empty
   * means "asked, still waiting", a key absent means nobody asked. `DetailSlice`'s rule.
   */
  public async check(subscription: SubscriptionId): Promise<void> {
    this.remember(subscription, undefined);
    const reply = await this.api.get(`${CORE_DOCTOR_PATH}?subscription=${subscription}`);
    if (reply?.status !== 200) return;
    const health = parseInstallHealthReply(reply.body);
    if (health !== undefined) this.remember(subscription, health);
  }

  /**
   * Checks for an update and installs one if there is one.
   *
   * There is no check-only form of this verb (F.10.2), so this is the one button on the panel that
   * can change the machine — which is why it is a button rather than something the panel does when
   * it opens.
   */
  public async update(subscription: SubscriptionId): Promise<void> {
    this.publish({ update: undefined });
    const reply = await this.api.post(CORE_UPDATE_PATH, { subscription });
    if (reply?.status !== 200) return;
    const result = updateOf(reply.body);
    if (result !== undefined) this.publish({ update: result });
    // Re-read, so `Last update attempt` and the version on screen agree with what just happened.
    await this.check(subscription);
  }

  /** Restarts what the CLI chooses to restart on one subscription. */
  public async respawnAll(subscription: SubscriptionId): Promise<void> {
    this.publish({ respawn: undefined });
    const reply = await this.api.post(CORE_RESPAWN_PATH, { subscription, all: true });
    if (reply?.status !== 200) return;
    const report = respawnOf(subscription, reply.body);
    if (report !== undefined) this.publish({ respawn: report });
  }

  private remember(subscription: SubscriptionId, health: InstallHealth | undefined): void {
    this.held = { ...this.held, [subscription]: health };
    this.publish({ health: this.held });
  }
}

/** @throws never. */
function updateOf(value: unknown): UpdateResult | undefined {
  const fields = asRecord(value);
  const subscription = fields?.['subscription'];
  if (typeof subscription !== 'string') return undefined;
  const version = fields?.['version'];
  return {
    subscription: subscription === 'isg' ? 'isg' : '365',
    changed: fields?.['changed'] === true,
    version: typeof version === 'string' && version !== '' ? version : undefined,
  };
}

/** @throws never. */
function respawnOf(subscription: SubscriptionId, value: unknown): RespawnReport | undefined {
  const held = asRecord(value)?.['respawned'];
  if (!Array.isArray(held)) return undefined;
  return {
    subscription,
    respawned: held.filter((one: unknown): one is string => typeof one === 'string' && one !== ''),
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}
