// What the presets section of a project row renders — P4-T1, CODING-STANDARDS §3.
//
// A class rather than logic in the component, for `ProjectsViewModel`'s two reasons. **Turning a
// refusal code into a sentence is a decision**: core answers with a closed union precisely so that
// nothing it says was composed from what the request contained, and the English lives here because
// that is where the reader is. **So is working out what a preset would actually send** — a `ticket`
// preset's prompt is computed from the ticket id (`TicketPrompt`), so the panel has to show the
// four sentences that are about to go out rather than a box the owner has to imagine the contents
// of. Neither belongs inside JSX.
//
// **The subscription is derived, never carried.** A preset names a profile function and the
// function IS the config directory (`subscriptionOfProfileFunction`), so the badge on the row
// cannot disagree with the command line.
import {
  pinsAgent,
  pinsSessionName,
  presetPrompt,
  subscriptionOfProfileFunction,
  type LaunchPreset,
  type PresetRefusal,
  type ProfileFunction,
  type PromptSource,
} from '../../contracts/launch-preset.ts';
import { projectKey } from '../../contracts/project.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { TicketPrompt } from '../../contracts/ticket-prompt.ts';
import { canonicalWindowsPath, isUnder } from '../../contracts/windows-path.ts';

/** One line per refusal. Exhaustive over the union by construction — a `Record` of it. */
const SENTENCES: Readonly<Record<PresetRefusal, string>> = {
  empty: 'That preset was missing something core needs — a name, a folder and a profile function.',
  bad_name: 'Give the preset a name with a letter or a number in it.',
  bad_cwd:
    'That folder is not inside this project. Name a worktree under it, or leave it blank for the project root.',
  unknown_project: 'That project is not imported any more. Import it again first.',
  too_many: 'This project already holds as many saved presets as it can. Forget one first.',
  pins_agent:
    'claude-isg-orch already runs the orchestrator agent, so it cannot take a second one. Pick none.',
  unknown_agent:
    'That agent is not in this project .claude/agents roster. Pick one from the list, or none.',
};

/** What the `where` field says when the preset starts in the project root itself. */
const ROOT = 'project root';

/** One preset, ready to draw. */
export interface PresetLine {
  /** The React key, and what the forget button sends back with the project path. */
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly profileFn: ProfileFunction;
  /** Derived from the function, never carried beside it — see the header. */
  readonly subscription: SubscriptionId;
  readonly builtIn: boolean;
  readonly group: string | undefined;
  /** The absolute folder the session starts in. */
  readonly cwd: string;
  /** The same folder as somebody reads it: `project root`, or the part below it. */
  readonly where: string;
  /** Whether `cwd` IS the project root — which is what an empty folder box means. */
  readonly isRoot: boolean;
  readonly sessionName: string;
  readonly promptSource: PromptSource;
  /** What this preset would send as its first prompt, as it stands. `''` means it cannot start. */
  readonly prompt: string;
  /** Whether the profile function already passes `-n` and the name field is not the launcher's. */
  readonly namesItself: boolean;
  /** The saved `--agent`, or `undefined` for none (P9-T1). */
  readonly agent: string | undefined;
  /**
   * What the agent select offers after `none`: the project's roster, plus the saved agent when the
   * roster no longer holds it — so the select can show what the preset says, and core's launch-time
   * check is what refuses it. Empty for a function that pins its own agent.
   */
  readonly agentChoices: readonly string[];
  /** The saved agent is no longer on the roster, and a press will be refused. */
  readonly agentMissing: boolean;
  /** `claude-isg-orch` pins `--agent orchestrator`, so no select is drawn (`pinsAgent`). */
  readonly pinsAgent: boolean;
  /**
   * The ticket ids the name box offers — P9-T3. The project's own `specs/` and `state/` names, for
   * a `ticket` preset only, newest first; empty otherwise, which draws a plain text box. An offer,
   * not an allowlist: a typed id that is not here is still sent, because its spec may be next.
   */
  readonly ticketChoices: readonly string[];
  /**
   * `skill fix-review` for a draft a workflow-map row opened (P9-T2, `AssetPresets`), `undefined`
   * for a preset core holds. A draft has no row to forget and is not saved until somebody saves it.
   */
  readonly origin?: string | undefined;
}

/** The two lists a project's workflow map hands its presets. */
export interface MapLists {
  readonly roster?: readonly string[];
  readonly tickets?: readonly string[];
}

export class PresetsViewModel {
  private readonly presets: readonly LaunchPreset[];
  private readonly root: string;
  private readonly refusal: PresetRefusal | undefined;
  private readonly roster: readonly string[];
  private readonly tickets: readonly string[];

  /**
   * @param presets every preset the deck holds, for every project. Filtered here rather than by the
   * caller so that the key used to select them is the same one core filed them under.
   * @param projectPath the folder this section belongs to, as the registry spells it.
   * @param from what the project's workflow map says: its agent roster (`agentRoster`, P9-T1) and
   * its ticket ids (P9-T3). Both empty before the map has arrived, which draws no select and a
   * plain name box rather than controls with nothing in them.
   */
  constructor(
    presets: readonly LaunchPreset[],
    projectPath: string,
    refusal?: PresetRefusal,
    from: MapLists = {},
  ) {
    this.root = projectPath;
    this.roster = from.roster ?? [];
    this.tickets = from.tickets ?? [];
    const key = projectKey(projectPath);
    this.presets = presets.filter((preset) => preset.projectKey === key);
    this.refusal = refusal;
  }

  /** The rows, in core's order — by name, so the four built-ins do not move as saves arrive. */
  public get lines(): readonly PresetLine[] {
    return this.presets.map((preset) => ({
      key: `${preset.projectKey}|${preset.id}`,
      id: preset.id,
      name: preset.name,
      profileFn: preset.profileFn,
      subscription: subscriptionOfProfileFunction(preset.profileFn),
      builtIn: preset.builtIn,
      group: preset.group,
      cwd: preset.cwd,
      where: relativeTo(preset.cwd, this.root),
      isRoot: canonicalWindowsPath(preset.cwd) === canonicalWindowsPath(this.root),
      sessionName: preset.sessionName,
      promptSource: preset.promptSource,
      prompt: presetPrompt(preset),
      namesItself: pinsSessionName(preset.profileFn),
      ...this.agentFacts(preset),
      ticketChoices: preset.promptSource === 'ticket' ? this.tickets : [],
    }));
  }

  /** True only before core has answered: every imported project has four built-ins. */
  public get isEmpty(): boolean {
    return this.presets.length === 0;
  }

  /** The refusal in English, or `undefined` when the last save was taken. */
  public get problem(): string | undefined {
    return this.refusal === undefined ? undefined : SENTENCES[this.refusal];
  }
  /** The four agent fields of a line — see `PresetLine.agentChoices`. */
  private agentFacts(
    preset: LaunchPreset,
  ): Pick<PresetLine, 'agent' | 'agentChoices' | 'agentMissing' | 'pinsAgent'> {
    const pinned = pinsAgent(preset.profileFn);
    const { agent } = preset;
    const missing = agent !== undefined && !this.roster.includes(agent);
    const extra = agent !== undefined && missing ? [agent] : [];
    return {
      agent: preset.agent,
      agentChoices: pinned ? [] : [...this.roster, ...extra],
      agentMissing: missing,
      pinsAgent: pinned,
    };
  }
}

/**
 * What a preset would send, given what is currently typed into its two boxes.
 *
 * The rule `presetPrompt` applies to a stored preset, applied to one being edited: a `ticket`
 * preset's prompt is computed from the name and the box for it is read-only, because the four
 * sentences are the routing (see `TicketPrompt` on why plan mode is asked for rather than flagged).
 */
export function draftPrompt(source: PromptSource, sessionName: string, typed: string): string {
  return source === 'ticket' ? new TicketPrompt(sessionName).text : typed;
}

/**
 * A folder as somebody reads it: `project root`, the part below the root, or the whole path.
 *
 * The third case is not dead. A saved preset keeps the cwd core resolved at save time, and the
 * project can be re-imported at a different casing or through a different junction; showing the
 * absolute path then is more honest than showing nothing.
 */
function relativeTo(cwd: string, root: string): string {
  const cwdKey = canonicalWindowsPath(cwd);
  const rootKey = canonicalWindowsPath(root);
  if (cwdKey === rootKey) return ROOT;
  if (!isUnder(cwdKey, rootKey)) return cwd;
  return cwd.slice(root.length).replace(/^[\\/]+/u, '');
}
