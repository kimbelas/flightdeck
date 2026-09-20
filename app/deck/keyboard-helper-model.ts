// The `?` sheet's keyboard helper, as a class — P5a-T7, CODING-STANDARDS §3 (React is the view).
//
// A component may not fetch, and this is the whole reason the rule is worth keeping here: what
// this object does is ask core to rewrite a file in the owner's Claude Code config, and that is
// testable without a browser only if it is not tangled up in a render.
//
// **Two steps, never one.** `load` asks what would be written and `write` does it. The sheet shows
// the diff between them, and a helper that could apply without having planned would make D13's
// promise a matter of which button the component happened to call.
import {
  parseKeybindingPlan,
  parseKeybindingWrite,
  type KeybindingDirection,
  type KeybindingPlan,
  type KeybindingWrite,
} from '../../contracts/keybinding-plan.ts';
import type { DeckApi } from './deck-api.ts';

const ROUTE = '/api/core/keybindings';

/** What the sheet is showing. `undefined` everywhere is the state before anything was asked. */
export interface KeyboardHelperState {
  readonly plan: KeybindingPlan | undefined;
  readonly written: KeybindingWrite | undefined;
  readonly error: string | undefined;
  readonly busy: boolean;
}

export const IDLE: KeyboardHelperState = {
  plan: undefined,
  written: undefined,
  error: undefined,
  busy: false,
};

export class KeyboardHelperModel {
  private readonly api: DeckApi;

  constructor(api: DeckApi) {
    this.api = api;
  }

  /** What would be written, without writing it. */
  public async load(direction: KeybindingDirection): Promise<KeyboardHelperState> {
    const reply = await this.api.get(`${ROUTE}?direction=${direction}`);
    if (reply === undefined) return { ...IDLE, error: 'could not reach core' };
    const plan = parseKeybindingPlan(reply.body);
    if (plan === undefined) return { ...IDLE, error: `core answered ${String(reply.status)}` };
    return { ...IDLE, plan };
  }

  /**
   * Writes it, and keeps the plan on screen.
   *
   * The plan is carried through rather than cleared, because the diff the owner just read is the
   * explanation for the backup paths that replace the button — clearing it would answer "what did
   * that do?" with an empty panel.
   */
  public async write(
    direction: KeybindingDirection,
    plan: KeybindingPlan | undefined,
  ): Promise<KeyboardHelperState> {
    const reply = await this.api.post(ROUTE, { direction });
    if (reply === undefined) return { ...IDLE, plan, error: 'could not reach core' };

    const written = parseKeybindingWrite(reply.body);
    if (written === undefined) {
      return {
        ...IDLE,
        plan,
        error: refusalFrom(reply.body) ?? `core answered ${String(reply.status)}`,
      };
    }
    return { ...IDLE, plan, written };
  }
}

/** Core's own sentence when it refused, so the sheet does not invent one. */
function refusalFrom(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const refusals: unknown = (body as Record<string, unknown>)['refusals'];
  if (!Array.isArray(refusals)) return undefined;
  const reasons = refusals
    .map((refusal) =>
      typeof refusal === 'object' && refusal !== null
        ? (refusal as Record<string, unknown>)['reason']
        : undefined,
    )
    .filter((reason): reason is string => typeof reason === 'string');
  return reasons.length > 0 ? reasons.join(' ') : undefined;
}
