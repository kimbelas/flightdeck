// What Claude was configured to do in a folder, so that what it is now can be a CHANGE — P3-T7.
//
// SPEC §5.1's first enhancement: "config-change detection (snapshot the map; diff when
// hooks/agents/permissions change)". The map answers what is configured; this answers what moved,
// and the second question is the one nothing else on the machine can answer at all — a hook added
// in a commit three days ago is invisible until it fires.
//
// **A digest, not the map.** What is stored is a per-facet list of stable NAMES, so a diff is set
// arithmetic over strings rather than a structural comparison of a type with eleven shapes in it.
// It also decides what counts as a change, which is the whole design:
//
//   - **Byte sizes are not in it.** `CLAUDE.md` is edited most days; a snapshot that reported
//     "instructions changed" every time somebody wrote a sentence would be a row nobody reads. An
//     instruction SOURCE appearing or disappearing is a config change; its contents growing is
//     work. The same argument excludes the convention folders' file counts — `state/` gains a file
//     per ticket — while keeping whether the folder exists at all.
//   - **Worktrees are not in it**, because they are git rather than `.claude`. A branch created
//     this morning is not a change to what Claude is configured to do, and it would drown every
//     real change on a machine that makes a worktree per ticket.
//   - **`at` is not in it.** The map carries the instant it was read, and a digest that included it
//     would differ from itself every time.
//
// **A first sighting is not a change.** Importing a folder records a snapshot and reports nothing,
// because "everything was added" is true of every project the moment it is first seen and is not
// what anybody means by a change.
import type { WorkflowMap } from './workflow-map.ts';

/**
 * The eleven things that can change, and the order they are reported in.
 *
 * SPEC names three — hooks, agents, permissions — and the rest are here because they come out of
 * the same two files and a reader who saw "3 changes" and only three possible causes would
 * reasonably conclude the fourth kind is not detected. The order is the map panel's own.
 */
export const CONFIG_FACETS = [
  'instructions',
  'agents',
  'commands',
  'skills',
  'hooks',
  'servers',
  'plugins',
  'marketplaces',
  'permissions',
  'conventions',
  'gates',
] as const;

export type ConfigFacet = (typeof CONFIG_FACETS)[number];

/** One facet's contents, as the sorted names a change is measured against. */
export type ConfigDigest = Readonly<Record<ConfigFacet, readonly string[]>>;

/** What moved in one facet. Never both empty — a facet with nothing in it is not reported. */
export interface ConfigChange {
  readonly facet: ConfigFacet;
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * The last time this folder's configuration changed, and what changed.
 *
 * It is the LAST change rather than a change since the deck last looked: a row saying "hooks
 * changed nine days ago" is the useful sentence, and one that went blank because you reloaded
 * would be a feature that erases itself.
 */
export interface ConfigDrift {
  /** The project this is about — the stored path, so the deck can match it to a row. */
  readonly path: string;
  /** When the change was first observed, epoch ms. */
  readonly at: number;
  /** When the configuration it replaced was first observed. The config stood this long. */
  readonly previousAt: number;
  readonly changes: readonly ConfigChange[];
}

/**
 * How many snapshots of one folder are kept.
 *
 * A bound rather than a target, like `MAX_TRANSCRIPTS`: config changes a few times a week, so
 * twenty is months of history per folder, and the table is then bounded by how many folders are
 * imported rather than by how long Flightdeck has been installed. The historian reads two.
 */
export const MAX_CONFIG_SNAPSHOTS = 20;

/** How many entries a facet reports before it stops. A rename of `.claude` is not a change list. */
export const MAX_CHANGE_ENTRIES = 12;

/** The names in a facet, capped where they are composed rather than where they are drawn. */
const MAX_ENTRY_CHARS = 160;

/**
 * One folder's configuration, reduced to what a change is about.
 *
 * Every list is sorted, so two digests of the same config are equal whatever order the directory
 * listing came back in — which is the property that stops a re-read reporting a change.
 */
export function configDigest(map: WorkflowMap): ConfigDigest {
  return {
    // Which sources EXIST, never their size. The stack always lists all five, present or absent
    // (`instruction-stack.ts`), so a digest over every entry would be a constant — and `bytes` is
    // what the header excludes. `bytes !== undefined` is the file being there at all.
    instructions: names(
      map.instructions.filter((file) => file.bytes !== undefined).map((file) => file.source),
    ),
    agents: names(assetNames(map, 'agent')),
    commands: names(assetNames(map, 'command')),
    skills: names(assetNames(map, 'skill')),
    // What RUNS is the identity of a hook: the event it fires on, what it matches, and the
    // command. A timeout that moves is not a new hook and does not need its own row.
    hooks: names(map.hooks.map((step) => `${step.event} ${step.matcher ?? '*'} ${step.command}`)),
    servers: names(map.servers.map((server) => `${server.name} (${server.transport})`)),
    plugins: names(map.plugins),
    marketplaces: names(map.marketplaces),
    permissions: names(permissionNames(map)),
    // Whether the folder is kept, not how much is in it — `state/` gains a file per ticket.
    conventions: names(map.conventions.filter((one) => one.files > 0).map((one) => one.folder)),
    gates: names(gateNames(map)),
  };
}

/** Every facet that moved, in `CONFIG_FACETS` order. Empty when the two digests agree. */
export function diffDigests(before: ConfigDigest, after: ConfigDigest): readonly ConfigChange[] {
  return CONFIG_FACETS.flatMap((facet) => {
    const was = new Set(before[facet]);
    const now = new Set(after[facet]);
    const added = after[facet].filter((entry) => !was.has(entry)).slice(0, MAX_CHANGE_ENTRIES);
    const removed = before[facet].filter((entry) => !now.has(entry)).slice(0, MAX_CHANGE_ENTRIES);
    if (added.length === 0 && removed.length === 0) return [];
    return [{ facet, added, removed }];
  });
}

/** Whether two digests describe the same configuration. The question the historian asks. */
export function sameDigest(before: ConfigDigest, after: ConfigDigest): boolean {
  return CONFIG_FACETS.every(
    (facet) =>
      before[facet].length === after[facet].length &&
      before[facet].every((entry, index) => entry === after[facet][index]),
  );
}

/**
 * One digest out of the store's TEXT column. @throws never.
 *
 * A row this build cannot read comes back as an empty digest rather than as `undefined`, and the
 * caller treats that as "no snapshot" — the same shape every parser here takes, and the reason a
 * Claude Code release that adds a facet cannot make the history throw.
 */
export function parseConfigDigest(value: unknown): ConfigDigest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  // Written out rather than built from `CONFIG_FACETS`, because the type is what makes this
  // exhaustive: adding a facet has to fail here, and an `Object.fromEntries` over the list would
  // need a cast to claim it did not.
  return {
    instructions: names(stringList(fields['instructions'])),
    agents: names(stringList(fields['agents'])),
    commands: names(stringList(fields['commands'])),
    skills: names(stringList(fields['skills'])),
    hooks: names(stringList(fields['hooks'])),
    servers: names(stringList(fields['servers'])),
    plugins: names(stringList(fields['plugins'])),
    marketplaces: names(stringList(fields['marketplaces'])),
    permissions: names(stringList(fields['permissions'])),
    conventions: names(stringList(fields['conventions'])),
    gates: names(stringList(fields['gates'])),
  };
}

/** One drift off a `GET /projects/map` body. @throws never. */
export function parseConfigDrift(value: unknown): ConfigDrift | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const path = fields['path'];
  const at = fields['at'];
  if (typeof path !== 'string' || path === '') return undefined;
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  const changes = changeList(fields['changes']);
  // A drift with nothing in it is not a drift. Dropping it here rather than drawing an empty
  // sentence is the same rule `parseWorkflowMap` follows about a map it cannot read.
  if (changes.length === 0) return undefined;
  return { path, at, previousAt: whole(fields['previousAt']), changes };
}

/** The drifts in a `GET /projects/map` reply, dropping any the build cannot read. @throws never. */
export function parseConfigDrifts(value: unknown): readonly ConfigDrift[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const drift = parseConfigDrift(entry);
    return drift === undefined ? [] : [drift];
  });
}

function changeList(value: unknown): readonly ConfigChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(entry));
    const facet = CONFIG_FACETS.find((known) => known === fields['facet']);
    if (facet === undefined) return [];
    const added = stringList(fields['added']).slice(0, MAX_CHANGE_ENTRIES);
    const removed = stringList(fields['removed']).slice(0, MAX_CHANGE_ENTRIES);
    if (added.length === 0 && removed.length === 0) return [];
    return [{ facet, added, removed }];
  });
}

function assetNames(map: WorkflowMap, kind: 'agent' | 'command' | 'skill'): readonly string[] {
  return map.assets.filter((asset) => asset.kind === kind).map((asset) => asset.name);
}

/**
 * Every permission rule, said with which list it is on.
 *
 * `Read(.env)` moving from `deny` to `ask` is the most consequential single change this whole
 * feature can report, and a digest of bare rule strings would see it as no change at all.
 */
function permissionNames(map: WorkflowMap): readonly string[] {
  const { allow, deny, ask, defaultMode } = map.permissions;
  return [
    ...allow.map((rule) => `allow ${rule}`),
    ...deny.map((rule) => `deny ${rule}`),
    ...ask.map((rule) => `ask ${rule}`),
    ...(defaultMode === undefined ? [] : [`defaultMode ${defaultMode}`]),
  ];
}

/**
 * The gate definitions, and the two path counts beside them.
 *
 * The counts are entries rather than a separate facet because they live in the same file and
 * change with it — `denies 4` becoming `denies 5` reads as one line in the same list.
 */
function gateNames(map: WorkflowMap): readonly string[] {
  if (map.gates === undefined) return [];
  return [
    `denies ${String(map.gates.denyPaths)}`,
    `asks ${String(map.gates.askPaths)}`,
    ...map.gates.gates.map((gate) => `${gate.kind} ${gate.label}`),
  ];
}

/** Sorted, capped, de-duplicated. Two identical hook commands on one event are one entry. */
function names(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.slice(0, MAX_ENTRY_CHARS)))].sort();
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) =>
    typeof entry === 'string' && entry !== '' ? [entry.slice(0, MAX_ENTRY_CHARS)] : [],
  );
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
