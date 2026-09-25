// A workflow-map row turned into a preset draft — P9-T2, CODING-STANDARDS §3.
//
// The map lists a project's agents, commands and skills (P3-T3), and this is what makes a row of
// it pressable: `make a preset` opens the presets editor with a draft filled in from the asset.
// **Nothing here writes anything.** A draft is a `PresetLine` that core has never seen; it reaches
// the store only when the owner presses save in the editor, and a session starts only when they
// press start after reading the prompt (P4-T1's rule, D26's habit).
//
// **The rest of the draft is decided by kind**, and that is the whole of this file:
//
// - A **skill or command** becomes the prompt `/<name> ` — a slash line is a prompt Claude Code
//   runs when `--bg` sends it first (P9's phase notes), so the preset is a one-press skill. The
//   trailing space is where the owner types the arguments, and the editor puts the cursor there.
// - An **agent** becomes the draft's `agent` (P9-T1) and leaves the prompt empty for the owner to
//   write, because an agent is a system prompt and a set of tools, not a task.
//
// **The function is the one this folder usually runs under**, read off the observed-behaviour
// tally (P3-T5) when somebody has pressed for one, and `claude-365` otherwise. Only the plain pair
// is a candidate: the tally counts subscriptions, and a subscription maps back to a function only
// for `ROUTABLE_PROFILE_FUNCTIONS` — `claude-isg-ticket` pins a model and `claude-isg-orch` pins an
// agent, and neither is what "this folder usually runs on isg" means.
//
// **What is offered is screened before it is offered.** An agent is pressable only when it is on
// the roster (`agentRoster`), which is the rule core checks the save and the launch with — a button
// whose draft core would refuse is a button that teaches the owner not to trust the others. A slash
// name must look like one (`SLASH_NAME`), because a name Claude Code would not read as a command
// would send a sentence beginning with a slash, not run a skill. The name is text from a file an
// imported repository controls, and it only ever reaches a text box and an environment variable
// (SEC-UI-2, SEC-PROC-1).
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import {
  MAX_PRESET_NAME_CHARS,
  MAX_SESSION_NAME_CHARS,
  subscriptionOfProfileFunction,
  type ProfileFunction,
} from '../../contracts/launch-preset.ts';
import type { ObservedBehaviour } from '../../contracts/observed-behaviour.ts';
import { projectKey } from '../../contracts/project.ts';
import type { PresetLine } from './presets-view-model.ts';

/** What a command or skill name must look like to become `/<name> `. See the header. */
const SLASH_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u;

/** The function a draft starts on when nothing has been observed in this folder. */
const DEFAULT_FUNCTION: ProfileFunction = 'claude-365';

export interface AssetPresetsInput {
  /** The project root, as the registry spells it. The draft starts there. */
  readonly root: string;
  /** The project's agent roster (`agentRoster` over its map). */
  readonly roster: readonly string[];
  /** The folder's transcript tally, or `undefined` when nobody has asked for one. */
  readonly observed: ObservedBehaviour | undefined;
}

export class AssetPresets {
  private readonly input: AssetPresetsInput;

  constructor(input: AssetPresetsInput) {
    this.input = input;
  }

  /** The function a draft starts on — see the header. */
  public get profileFn(): ProfileFunction {
    const shares = this.input.observed?.shares ?? [];
    const on365 = shares.find((share) => share.subscription === '365')?.sessions ?? 0;
    const onIsg = shares.find((share) => share.subscription === 'isg')?.sessions ?? 0;
    // A tie keeps the default rather than guessing: it is a folder with no habit to follow.
    return onIsg > on365 ? 'claude-isg' : DEFAULT_FUNCTION;
  }

  /** Whether this row gets a `make a preset` button at all. */
  public pressable(asset: ClaudeAsset): boolean {
    return this.draftFor(asset) !== undefined;
  }

  /**
   * The unsaved preset a press opens, or `undefined` for an asset that cannot become one.
   *
   * @param press a counter, so pressing the same row twice remounts the editor with a fresh draft
   * rather than keeping what was half-typed into the last one — the key is what resets the boxes.
   */
  public draftFor(asset: ClaudeAsset, press = 0): PresetLine | undefined {
    const agent = asset.kind === 'agent' ? this.rosterName(asset.name) : undefined;
    if (asset.kind === 'agent' && agent === undefined) return undefined;
    if (asset.kind !== 'agent' && !SLASH_NAME.test(asset.name)) return undefined;
    const { root, roster } = this.input;
    const profileFn = this.profileFn;
    return {
      key: `${projectKey(root)}|draft|${asset.kind}|${asset.name}|${String(press)}`,
      id: asset.name,
      name: asset.name.slice(0, MAX_PRESET_NAME_CHARS),
      profileFn,
      subscription: subscriptionOfProfileFunction(profileFn),
      builtIn: false,
      group: undefined,
      cwd: root,
      where: 'project root',
      isRoot: true,
      sessionName: asset.name.slice(0, MAX_SESSION_NAME_CHARS),
      promptSource: 'literal',
      prompt: agent === undefined ? `/${asset.name} ` : '',
      namesItself: false,
      agent,
      agentChoices: roster,
      agentMissing: false,
      pinsAgent: false,
      origin: `${asset.kind} ${asset.name}`,
    };
  }

  private rosterName(name: string): string | undefined {
    return this.input.roster.includes(name) ? name : undefined;
  }
}
