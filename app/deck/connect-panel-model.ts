// The Connect panel, as a class — P4-T6, CODING-STANDARDS §3 (React is the view).
//
// `KeyboardHelperModel`'s twin, and deliberately so: the two are the only things in the deck that
// ask core to rewrite a file in the owner's Claude Code config, and they are the same two steps in
// the same order. `load` asks what would be written and `write` does it; the panel shows the diff
// in between, and a model that could apply without having planned would make D13's promise a
// matter of which button a component happened to call.
//
// **Nothing here is deck state.** Whether a diff is on screen is a fact about this tab and this
// minute, not part of the picture of the machine, so it stays out of `DeckState` — the argument
// P5a-T7 made for the keyboard helper, which is why this is a model and not a seventh slice.
import {
  connectRefusal,
  parseConnectPlanReply,
  parseConnectWrite,
  refusedApplied,
  type AppliedChange,
  type ConnectDirection,
  type ConnectPlan,
  type ConnectWrite,
} from '../../contracts/connect-plan.ts';
import { CORE_CONNECT_PATH } from '../../contracts/deck-routes.ts';
import type { DeckApi } from './deck-api.ts';

/** What the panel is showing. `undefined` everywhere is the state before anything was asked. */
export interface ConnectPanelState {
  readonly plan: ConnectPlan | undefined;
  readonly written: ConnectWrite | undefined;
  /**
   * What a REFUSED write had already put on disk before it stopped.
   *
   * Its own field rather than a corner of `written`, because it is the field that matters most and
   * only appears when something went wrong: `Connector.apply` stops at the first failure and
   * reports what it had applied, and every one of those entries names a backup the owner can
   * restore from. An error message without them would be the panel hiding the recovery path.
   */
  readonly partial: readonly AppliedChange[];
  readonly error: string | undefined;
  readonly busy: boolean;
}

export const IDLE: ConnectPanelState = {
  plan: undefined,
  written: undefined,
  partial: [],
  error: undefined,
  busy: false,
};

export class ConnectPanelModel {
  private readonly api: DeckApi;

  constructor(api: DeckApi) {
    this.api = api;
  }

  /** What would be written, without writing it. Safe to press at any time, in either direction. */
  public async load(direction: ConnectDirection): Promise<ConnectPanelState> {
    const reply = await this.api.get(`${CORE_CONNECT_PATH}?direction=${direction}`);
    if (reply === undefined) return { ...IDLE, error: 'could not reach core' };
    const plan = parseConnectPlanReply(reply.body);
    if (plan === undefined) return { ...IDLE, error: `core answered ${String(reply.status)}` };
    return { ...IDLE, plan };
  }

  /**
   * Writes it, and keeps the plan on screen.
   *
   * The plan is carried through rather than cleared, for `KeyboardHelperModel.write`'s reason: the
   * diff the owner just read is the explanation for the backup paths that replace the button, and
   * clearing it would answer "what did that do?" with an empty panel.
   *
   * @param plan only to be carried through — core re-plans from disk and takes nothing from here.
   */
  public async write(
    direction: ConnectDirection,
    plan: ConnectPlan | undefined,
  ): Promise<ConnectPanelState> {
    const reply = await this.api.post(CORE_CONNECT_PATH, { direction });
    if (reply === undefined) return { ...IDLE, plan, error: 'could not reach core' };

    const written = parseConnectWrite(reply.body);
    if (written !== undefined) return { ...IDLE, plan, written };
    return {
      ...IDLE,
      plan,
      partial: refusedApplied(reply.body),
      error: connectRefusal(reply.body) ?? `core answered ${String(reply.status)}`,
    };
  }
}
