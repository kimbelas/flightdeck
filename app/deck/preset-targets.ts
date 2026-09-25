// Single presets, and a typed ticket, as things the palette can press — P9-T4.
//
// **A LEAF module, for `group-targets.ts`'s reason** (RESEARCH.md G.53): it reaches `contracts/`
// and `routing-view-model.ts`, which reaches only `contracts/`, so a unit test of it does not drag
// `deck-keyboard.ts` and its `document` into the DOM-less project. The entries themselves — the
// part that presses — are in `preset-commands.ts`.
//
// **What a press sends is decided here, and it is exactly what the presets panel would send.** A
// `PresetLaunch` built from the preset as it stands: its function, its folder, its name, its agent
// and `presetPrompt`. Nothing new reaches core (P9-T4's notes). **A preset that could not start as
// it stands is not launched from here** — the four built-ins store no prompt, and `--bg` will not
// start without one (RESEARCH.md B.4). Its entry opens its editor instead, which is where the
// missing prompt is typed; an entry that pressed and was refused would be the no-op the palette's
// header warns about. A saved agent the roster has lost opens the editor for the same reason: that
// is where the sentence explaining the refusal is.
//
// **The routing hint is the description** (P4-T3), so the account a press lands on is read before
// the press, with the numbers behind the advice — `RoutingViewModel`'s sentence, unchanged.
import {
  agentRoster,
  byProjectThenName,
  presetPrompt,
  subscriptionOfProfileFunction,
  type LaunchPreset,
  type PresetLaunch,
  type ProfileFunction,
} from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { recommendRouting } from '../../contracts/quota-routing.ts';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import { TICKET_SHAPE, TicketPrompt } from '../../contracts/ticket-prompt.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import { RoutingViewModel } from './routing-view-model.ts';

/** One pressable preset. `launch` is what start sends, or `undefined` when its editor opens. */
export interface PresetTarget {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly launch: PresetLaunch | undefined;
  /** The preset's chip (`PresetLine.key`) — what the press opens when `launch` is `undefined`. */
  readonly chip: string;
  /** Which box the opened editor puts the caret in: the ticket id, or the prompt. */
  readonly box: PresetBox;
}

export type PresetBox = 'name' | 'prompt';

/** Everything the deck already holds that the entries are derived from. Nothing is fetched. */
export interface PresetSources {
  readonly presets: readonly LaunchPreset[];
  readonly projects: readonly ProjectRecord[];
  readonly maps: Readonly<Record<string, WorkflowMap>>;
  /** The current project's key (P3-T6), or `undefined` when the deck shows every project. */
  readonly current: string | undefined;
  readonly quota: QuotaSummary | undefined;
  readonly now: number;
}

/**
 * `Launch <project> · <preset>` for every preset of every imported project.
 *
 * In `byProjectThenName` order, the current project's first — the one somebody looking at a
 * project most likely means, and the rest in the order the panels draw them. A preset whose project
 * is not in the registry has no name to label it with and is left out, which is what core's own
 * list does with one (`PresetBook.list`).
 */
export function presetTargets(sources: PresetSources): readonly PresetTarget[] {
  const names = projectNames(sources.projects);
  const sorted = [...sources.presets].sort(byProjectThenName);
  const ordered = [
    ...sorted.filter((preset) => preset.projectKey === sources.current),
    ...sorted.filter((preset) => preset.projectKey !== sources.current),
  ];
  return ordered.flatMap((preset) => {
    const project = names.get(preset.projectKey);
    return project === undefined ? [] : [presetTarget(preset, project, sources)];
  });
}

/**
 * `Plan <id> in <project>` for a ticket-shaped term in the query, or `undefined`.
 *
 * **Only in the current project, and nothing without one.** A ticket id does not say which
 * repository it belongs to, and a guess is the wrong session started in the wrong folder (P9-T4).
 * The press is the project's `ticket` preset with the name filled in — the one a `ticket` chip
 * would send with the id typed into it. An id that is not on disk is still offered, as the picker
 * accepts it (P9-T3): its spec may be about to be written. The hint says which it is.
 */
export function ticketTarget(query: string, sources: PresetSources): PresetTarget | undefined {
  const typed = query.split(/\s+/u).find((term) => TICKET_SHAPE.test(term));
  const { current } = sources;
  if (typed === undefined || current === undefined) return undefined;
  const project = projectNames(sources.projects).get(current);
  const preset = ticketPreset(sources.presets, current);
  if (project === undefined || preset === undefined) return undefined;
  const ticket = new TicketPrompt(typed);
  const listed = (sources.maps[current]?.tickets ?? []).includes(ticket.name);
  return {
    key: `plan:${current}|${ticket.name}`,
    label: `Plan ${ticket.name} in ${project}`,
    hint: `${routingHint(preset.profileFn, sources)} · ${listed ? 'on disk' : 'not on disk yet'}`,
    launch: { ...launchOf(preset), name: ticket.name, prompt: ticket.text },
    chip: chipKey(preset),
    box: 'name',
  };
}

function presetTarget(preset: LaunchPreset, project: string, sources: PresetSources): PresetTarget {
  const launch = launchOf(preset);
  const startable = launch.prompt.trim() !== '' && !agentLost(preset, sources.maps);
  const routing = routingHint(preset.profileFn, sources);
  return {
    key: `preset:${chipKey(preset)}`,
    label: `Launch ${project} · ${preset.name}`,
    hint: startable ? routing : `${routing} · ${whyItOpens(preset)}`,
    launch: startable ? launch : undefined,
    chip: chipKey(preset),
    box: preset.promptSource === 'ticket' ? 'name' : 'prompt',
  };
}

/** What a press on an editor-opening entry is for — the thing that is missing. */
function whyItOpens(preset: LaunchPreset): string {
  if (preset.agent !== undefined && presetPrompt(preset).trim() !== '') {
    return `opens it — ${preset.agent} is no longer on the roster`;
  }
  return preset.promptSource === 'ticket' ? 'opens it for a ticket id' : 'opens it for a prompt';
}

/** The press, as the presets panel's start builds it for an untouched editor. */
function launchOf(preset: LaunchPreset): PresetLaunch {
  return {
    profileFn: preset.profileFn,
    prompt: presetPrompt(preset),
    name: preset.sessionName,
    cwd: preset.cwd,
    agent: preset.agent,
  };
}

/** The saved agent is not on the roster the map carries, so core would refuse the press. */
function agentLost(preset: LaunchPreset, maps: PresetSources['maps']): boolean {
  if (preset.agent === undefined) return false;
  return !agentRoster(maps[preset.projectKey]?.assets ?? []).includes(preset.agent);
}

/**
 * The project's `ticket` preset: the one with that id if it still computes its prompt, else any
 * other that does. A saved `ticket` with a literal prompt is not a way to plan a ticket.
 */
function ticketPreset(presets: readonly LaunchPreset[], key: string): LaunchPreset | undefined {
  const own = presets.filter((preset) => preset.projectKey === key);
  const planners = own.filter((preset) => preset.promptSource === 'ticket').sort(byProjectThenName);
  return planners.find((preset) => preset.id === 'ticket') ?? planners[0];
}

/** `365 · claude-365`, then the recommendation when there is a reading to base one on. */
function routingHint(profileFn: ProfileFunction, sources: PresetSources): string {
  const lands = `${subscriptionOfProfileFunction(profileFn)} · ${profileFn}`;
  if (sources.quota === undefined) return lands;
  const routing = recommendRouting(sources.quota, { now: sources.now, chosen: profileFn });
  return `${lands} · ${new RoutingViewModel(routing, profileFn).sentence}`;
}

/** `PresetLine.key`, spelled once for both ends — the chip carries it as `data-preset-chip`. */
export function chipKey(preset: LaunchPreset): string {
  return `${preset.projectKey}|${preset.id}`;
}

function projectNames(projects: readonly ProjectRecord[]): ReadonlyMap<string, string> {
  return new Map(projects.map((project) => [projectKey(project.path), project.name]));
}
