// A named set of presets that start together — P6-T4, DECISIONS.md D17, SPEC §5.7.
//
// D17 is the whole feature in one sentence: *"A named preset group ("morning: app-core
// orchestrator + ticket + reports") launches in one click from the palette."* And the sentence
// before it is the constraint — **no auto-launch on boot, because it would spend quota
// unattended.** A group is therefore something the owner presses, never something that fires.
//
// **A group is DERIVED, not stored.** `LaunchPreset.group` has been a field since P4-T1 and
// `presets.preset_group` has been a column just as long; a group is every preset wearing that
// name. Nothing creates a group, nothing deletes one, and the last preset losing the name is the
// group ceasing to exist — which is the behaviour a free-text field already implies and the only
// one that cannot drift from what is on the presets.
//
// **It spans projects, and that is the point.** `PresetBook.list()` answers for every imported
// folder at once, and "morning" means the owner's morning rather than one repository's. D17's own
// example is three presets that happen to share a project; nothing about the field says they must.
//
// **Case-insensitive by key, first spelling wins for display.** `Morning` and `morning` are one
// group, because two buttons a capital letter apart is a bug the owner would file against
// themselves.
import { byProjectThenName, type LaunchPreset } from './launch-preset.ts';

/**
 * How many sessions one press may start.
 *
 * Six, and the number is a quota decision rather than a technical limit. A morning is two to four
 * sessions; a group of forty is somebody having tagged a whole project by accident, and the cost of
 * finding that out is forty first turns of the owner's 5-hour window. The cap refuses the whole
 * press rather than launching the first six — a group that half-fired would leave the owner working
 * out which half.
 */
export const MAX_GROUP_LAUNCH = 6;

/** One group, ready to draw and to launch. */
export interface PresetGroup {
  /** Lower-cased, for matching. What a request names and what two spellings collapse to. */
  readonly key: string;
  /** The first spelling seen, in preset order. What a person reads on a button. */
  readonly name: string;
  /** Its presets, in `byProjectThenName` order — the order they will be launched in. */
  readonly presets: readonly LaunchPreset[];
}

/** The group key for a name, or `undefined` when the name is not one. */
export function groupKey(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  return key === '' ? undefined : key;
}

/**
 * Every group in a list of presets, ordered by name.
 *
 * Ordered so the palette does not reshuffle between reads, for `byProjectThenName`'s reason: the
 * entries are a keyed React list, and a list that reorders is one React rebuilds rather than
 * reconciles.
 *
 * Built here rather than in either end because both need the same answer: core resolves what a
 * press launches, the deck draws what there is to press, and a group that existed on one side only
 * would be a button that 404s or a set nobody can reach.
 */
export function presetGroups(presets: readonly LaunchPreset[]): readonly PresetGroup[] {
  const groups = new Map<string, { name: string; presets: LaunchPreset[] }>();
  for (const preset of [...presets].sort(byProjectThenName)) {
    const key = preset.group === undefined ? undefined : groupKey(preset.group);
    if (key === undefined || preset.group === undefined) continue;
    // The first spelling wins: `??=` rather than an overwrite, so the display name is stable
    // whatever order the presets arrive in.
    const held = groups.get(key) ?? { name: preset.group.trim(), presets: [] };
    held.presets.push(preset);
    groups.set(key, held);
  }
  return [...groups.entries()]
    .map(([key, held]) => ({ key, name: held.name, presets: held.presets }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

/** One group by key, or `undefined`. The lookup a launch does, spelled once. */
export function findGroup(presets: readonly LaunchPreset[], name: string): PresetGroup | undefined {
  const key = groupKey(name);
  if (key === undefined) return undefined;
  return presetGroups(presets).find((group) => group.key === key);
}

/**
 * Why a whole group press was refused, before anything was started.
 *
 * A closed union rather than a sentence, as every refusal here is: core names the cause and the
 * deck writes the English, so nothing on screen was composed by core out of the request.
 *
 * `busy` is the one that is not about the request. A group launch holds the machine for seconds
 * and spends quota per session; a second press while one is in flight is a double-click, not a
 * second intention, and the cheapest place to notice is before anything starts.
 */
export const GROUP_REFUSALS = ['unknown_group', 'too_many', 'busy'] as const;

export type GroupRefusal = (typeof GROUP_REFUSALS)[number];

/** What happened to ONE preset in a group. Either a session id or a reason, never both. */
export interface GroupLaunchOutcome {
  readonly presetId: string;
  readonly name: string;
  /** Present when it started. The deck opens no pane from here — the reconciler publishes the row. */
  readonly sessionId: string | undefined;
  /** Present when it did not. A `LaunchFailure` code, which the deck already has sentences for. */
  readonly failure: string | undefined;
}

/** What `POST /sessions/group` answers with when the press was accepted. */
export interface GroupLaunchReport {
  readonly group: string;
  readonly outcomes: readonly GroupLaunchOutcome[];
}

/** How many of them started. Here so the deck and a smoke check count the same way. */
export function startedCount(report: GroupLaunchReport): number {
  return report.outcomes.filter((outcome) => outcome.sessionId !== undefined).length;
}

/**
 * Rebuilds a report off the wire, or `undefined` if it is not one.
 *
 * A parser rather than a cast, for `parseLaunchAccepted`'s reason: what it carries becomes a
 * sentence about the owner's quota having been spent, and "core answered 200 with something else"
 * has to be distinguishable from "three sessions started". An outcome that is neither a start nor
 * a failure is dropped rather than shown as either.
 *
 * @throws never.
 */
export function parseGroupLaunchReport(value: unknown): GroupLaunchReport | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const group = fields['group'];
  const outcomes = fields['outcomes'];
  if (typeof group !== 'string' || !Array.isArray(outcomes)) return undefined;
  return {
    group,
    outcomes: outcomes
      .map((entry: unknown) => outcomeOf(entry))
      .filter((outcome): outcome is GroupLaunchOutcome => outcome !== undefined),
  };
}

function outcomeOf(value: unknown): GroupLaunchOutcome | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const presetId = nonEmpty(fields['presetId']);
  const name = nonEmpty(fields['name']);
  const sessionId = nonEmpty(fields['sessionId']);
  const failure = nonEmpty(fields['failure']);
  if (presetId === undefined || name === undefined) return undefined;
  // Exactly one of the two. A row claiming both, or neither, is one this build cannot draw.
  if ((sessionId === undefined) === (failure === undefined)) return undefined;
  return { presetId, name, sessionId, failure };
}

/** A string with something in it, or `undefined`. The empty string is not an id or a reason. */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
