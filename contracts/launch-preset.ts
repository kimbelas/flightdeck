// A named way to start a session in one folder — P4-T1, SPEC §5.6, DECISIONS.md D44.
//
// **A preset names a PROFILE FUNCTION and nothing about the model.** BUILD-PLAN §3 sketches
// `model`, `agent` and `effort` fields and they are deliberately absent, because D4 already
// decided where model routing lives: `claude-isg-ticket` pins `opusplan[1m]` and two environment
// variables, `claude-isg-orch` pins `claude-sonnet-5 --agent orchestrator`, and every spawn goes
// through one of those functions rather than a hand-built flag string. A preset carrying `--model`
// would be the second place model routing lives, which is the drift P4-T0 has just finished
// deleting from `~/.bashrc`. Wanting a different model is a new function in one file — which is
// D4's whole point, and is what "encoding the five profile functions" means.
//
// **There is no `subscription` field either, for a stronger version of the same reason.** The
// function IS the config directory: `claude-365` exports `~\.claude-365` and the other three
// export `~\.claude-isg`. Two fields could disagree, and the one that would win is the one on the
// command line. P4-T3's quota routing therefore has exactly two functions it may swap between —
// see `ROUTABLE_PROFILE_FUNCTIONS`.
//
// **`agent` came back in P9-T1, and it is the one of the three that is not routing** (D59). The
// function chooses the account and the model; an agent chooses the system prompt and the tools, and
// the docs compose the two (`claude --agent <name> --bg "<prompt>"`). It is allowlisted by the
// project's own `.claude/agents` roster rather than typed, screened by shape here, and refused on
// the one function that already pins an agent (`pinsAgent`). `model` and `effort` stay dropped.
//
// **Everything here is capped where it is parsed**, the rule `job-state.ts` set: a preset arrives
// from a text box, goes into a database, and comes back out into a command line and onto a screen.
import type { ClaudeAsset } from './claude-assets.ts';
import type { SubscriptionId } from './session.ts';
import { TicketPrompt } from './ticket-prompt.ts';

/**
 * The profile functions a preset may name — SEC-PROC-2's allowlist, in one place.
 *
 * **Four, where SPEC §5.7 says five, and the fifth is not an oversight.** `claude-isg-agents` runs
 * `claude agents …`, which opens the agents browser: it is a terminal UI over sessions, not a way
 * to start one, and there is no `--bg` form of it. SEC-PROC-2 has always allowlisted these four for
 * that reason. The fifth function is reachable from the deck as the thing it actually is — the
 * session list — and a preset for it would be a button that starts nothing.
 */
export const PROFILE_FUNCTIONS = [
  'claude-365',
  'claude-isg',
  'claude-isg-ticket',
  'claude-isg-orch',
] as const;

export type ProfileFunction = (typeof PROFILE_FUNCTIONS)[number];

/**
 * The two a quota recommendation may choose between — P4-T3.
 *
 * The other two are `~\.claude-isg` by construction (`claude-isg-ticket` pins `opusplan[1m]` with
 * two environment variables, `claude-isg-orch` pins an agent), so "run this on whichever
 * subscription has more headroom" is only a question that can be asked about the plain pair.
 * Naming it here rather than discovering it in P4-T3 is what stops that task offering a swap it
 * cannot make.
 */
export const ROUTABLE_PROFILE_FUNCTIONS: readonly ProfileFunction[] = ['claude-365', 'claude-isg'];

/** Which config directory a function exports. The function is the subscription — see the header. */
export function subscriptionOfProfileFunction(profileFn: ProfileFunction): SubscriptionId {
  return profileFn === 'claude-365' ? '365' : 'isg';
}

/**
 * Whether the function already passes `-n` and the launcher must not pass a second one.
 *
 * `claude-isg-orch` is `… --model claude-sonnet-5 --agent orchestrator -n orchestrator @args`, so
 * a preset adding `-n` to it puts two `-n` flags on one command line. Nothing has measured which
 * one wins, and P4-T2 is where the argv is built, so the fact is recorded here beside the
 * allowlist rather than discovered there.
 */
export function pinsSessionName(profileFn: ProfileFunction): boolean {
  return profileFn === 'claude-isg-orch';
}

/**
 * Whether the function already passes `--agent` and a preset may not name a second one — P9-T1.
 *
 * `claude-isg-orch` is `… --agent orchestrator -n orchestrator @args`, so a preset agent on it is
 * two `--agent` flags on one command line. It is REFUSED at save time (`pins_agent`) and again at
 * launch, the way `pinsSessionName` keeps a second `-n` off the command line — except that a name
 * the function overrides is harmless to drop, and an agent silently dropped is a session that is
 * not what the button said.
 */
export function pinsAgent(profileFn: ProfileFunction): boolean {
  return profileFn === 'claude-isg-orch';
}

/**
 * What an agent name may look like — P9-T1.
 *
 * Lower case, digits and hyphens, at most 64: the shape Claude Code's own agent names take, and a
 * shape that is safe in every place this string goes — an argv element, a JSON body, a database
 * column and a log line. A name in the roster that is not this shape is not offered at all rather
 * than escaped, because the roster is the allowlist and a name that needs escaping is not on it.
 */
export const AGENT_SHAPE = /^[a-z0-9-]{1,64}$/u;

/** The name if it is agent-shaped, `undefined` otherwise. Never coerced — see `AGENT_SHAPE`. */
export function agentName(value: unknown): string | undefined {
  return typeof value === 'string' && AGENT_SHAPE.test(value) ? value : undefined;
}

/**
 * A project's agent roster out of its assets: the agent-shaped agent names, unique and sorted.
 *
 * The one rule both ends read — core's `AgentRoster` checks a save and a launch with it, and the
 * presets panel draws its select from the workflow map with it — so a name the deck offers is a
 * name core will accept, and one it hides is one core would refuse.
 */
export function agentRoster(assets: readonly ClaudeAsset[]): readonly string[] {
  const names = assets
    .filter((asset) => asset.kind === 'agent')
    .map((asset) => agentName(asset.name))
    .filter((name): name is string => name !== undefined);
  return [...new Set(names)].sort((left, right) => (left < right ? -1 : 1));
}

/**
 * Where a preset's opening prompt comes from.
 *
 * Two values and no template engine. `ticket` means the prompt is COMPUTED from `sessionName` by
 * `TicketPrompt` — the plan-first prompt names the ticket three times, so freezing one ticket id
 * into a stored string would make the preset good for exactly one ticket. `literal` means the
 * prompt is the text the owner wrote.
 */
export const PROMPT_SOURCES = ['literal', 'ticket'] as const;
export type PromptSource = (typeof PROMPT_SOURCES)[number];

export const MAX_PRESET_NAME_CHARS = 60;
/** Matches `SessionLauncher`'s own cap, so a preset cannot be saved that a launch would refuse. */
export const MAX_SESSION_NAME_CHARS = 80;
/** The same agreement for the prompt. */
export const MAX_PRESET_PROMPT_CHARS = 8000;
export const MAX_PRESET_GROUP_CHARS = 40;
export const MAX_PRESET_CWD_CHARS = 1024;

/**
 * How many presets one project may hold.
 *
 * A bound on a table written from a text box, not a judgement about how many are useful. Built-in
 * presets do not count against it — they are computed, not stored.
 */
export const MAX_PRESETS_PER_PROJECT = 24;

export interface LaunchPreset {
  /** `projectKey(project.path)` — which imported folder this preset is filed under. */
  readonly projectKey: string;
  /** `presetId(name)`. Unique within a project: saving `ticket` replaces the built-in `ticket`. */
  readonly id: string;
  readonly name: string;
  readonly profileFn: ProfileFunction;
  /** Where the session starts — the project root, or a worktree under it. */
  readonly cwd: string;
  /** What `-n` will be given, unless `pinsSessionName` says the function names itself. */
  readonly sessionName: string;
  readonly promptSource: PromptSource;
  /** The literal prompt. Ignored — and stored empty — when `promptSource` is `ticket`. */
  readonly prompt: string;
  /** `morning`, or `undefined`. Preset groups launch together in P6-T4. */
  readonly group: string | undefined;
  /**
   * The agent the session starts under (`--agent`), or `undefined` for none — P9-T1.
   *
   * A name from the project's `.claude/agents` roster, checked at save AND at launch: a roster file
   * deleted between the two refuses the launch rather than starting an agent Claude Code will not
   * find. Always `undefined` on the four built-ins and on `claude-isg-orch` (`pinsAgent`).
   */
  readonly agent: string | undefined;
  /**
   * Whether core computed this one rather than reading it out of the store.
   *
   * Built-ins are derived from the project and the four profile functions every time they are
   * asked for, which is why nothing is seeded into the owner's database when a folder is imported
   * (the D26 habit: what ships is empty). The deck draws them the same and offers `forget` only on
   * the saved ones, because forgetting a computed row would remove it until the next request.
   */
  readonly builtIn: boolean;
}

/** What a preset will actually send as its first prompt — the one rule both ends read. */
export function presetPrompt(preset: LaunchPreset): string {
  return preset.promptSource === 'ticket'
    ? new TicketPrompt(preset.sessionName).text
    : preset.prompt;
}

/**
 * A preset's id, derived from its name.
 *
 * Derived rather than generated, for `projectKey`'s reason: an id from a counter would make saving
 * the same preset twice two rows, and there would be no way to replace the built-in `ticket` with
 * your own. Lower case, non-alphanumerics folded to one hyphen, capped.
 */
export function presetId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_PRESET_NAME_CHARS);
}

/**
 * Why a preset would not be saved.
 *
 * A closed union rather than a sentence, exactly as `ImportRefusal` is: core names the cause, the
 * deck writes the English, and nothing on screen was composed by core out of the request.
 *
 * Seven, and every one of them is reachable — a union with a member nothing can produce is a
 * sentence in the deck nobody will ever read. `empty` is the body that was not a draft at all,
 * which includes a `profileFn` or a `promptSource` this build does not know: `parsePresetDraft`
 * refuses those rather than coercing them, so they never reach a refusal of their own. An agent that
 * is not agent-shaped is the same case. `pins_agent` is an agent on `claude-isg-orch`, and
 * `unknown_agent` a well-shaped name the project's roster does not hold (P9-T1).
 */
export const PRESET_REFUSALS = [
  'empty',
  'bad_name',
  'bad_cwd',
  'unknown_project',
  'too_many',
  'pins_agent',
  'unknown_agent',
] as const;

export type PresetRefusal = (typeof PRESET_REFUSALS)[number];

/** What the deck asks core to save. The project is named by PATH; core keys it. */
export interface PresetDraft {
  readonly projectPath: string;
  readonly name: string;
  readonly profileFn: ProfileFunction;
  readonly cwd: string;
  readonly sessionName: string;
  readonly promptSource: PromptSource;
  readonly prompt: string;
  readonly group: string | undefined;
  /** A roster name, or `undefined` for none. Screened by shape in the parser, by roster in core. */
  readonly agent: string | undefined;
}

/**
 * What pressing a preset sends to `POST /sessions` — P4-T1.
 *
 * Here rather than composed at the call site, because it is the point where a preset stops being a
 * preset: the subscription is `subscriptionOfProfileFunction(preset.profileFn)`, the prompt is
 * `presetPrompt(preset)` or what the owner typed over it, and the cwd is the folder the preset
 * names. `LaunchRoute` has parsed these four fields since P2-T2 — this names the shape so the two
 * ends cannot spell it differently.
 *
 * **The profile function is the routing, as of P4-T2, and `subscription` is gone.** P4-T1 sent a
 * subscription because the launcher ran `claude.exe` with a config directory; the launcher now
 * runs the function itself through PowerShell (D4), so the function decides the account, the model
 * and the agent. Sending both would be two fields the command line could contradict, and core
 * derives the one it audits with (`subscriptionOfProfileFunction`) rather than trusting it.
 */
export interface PresetLaunch {
  readonly profileFn: ProfileFunction;
  readonly prompt: string;
  /** Ignored by a function that names itself (`pinsSessionName`); required by every other. */
  readonly name: string;
  readonly cwd: string;
  /**
   * `--agent`, or `undefined` for none — P9-T1. Core checks it against the roster of the project
   * `cwd` is in, at launch, whatever the deck believed when it drew the select.
   */
  readonly agent: string | undefined;
}

/** Which saved preset to remove — the project it is filed under, and its id. */
export interface PresetRef {
  readonly projectPath: string;
  readonly id: string;
}

/** One preset off the wire, or `undefined` if it is not one. @throws never. */
export function parseLaunchPreset(value: unknown): LaunchPreset | undefined {
  const fields = asFields(value);
  if (fields === undefined) return undefined;
  const profileFn = PROFILE_FUNCTIONS.find((known) => known === fields['profileFn']);
  const promptSource = PROMPT_SOURCES.find((known) => known === fields['promptSource']);
  const id = text(fields['id'], MAX_PRESET_NAME_CHARS);
  const projectKeyOf = text(fields['projectKey'], MAX_PRESET_CWD_CHARS);
  const cwd = text(fields['cwd'], MAX_PRESET_CWD_CHARS);
  if (profileFn === undefined || promptSource === undefined) return undefined;
  if (id === '' || projectKeyOf === '' || cwd === '') return undefined;
  return {
    projectKey: projectKeyOf,
    id,
    name: nameOr(fields['name'], id),
    profileFn,
    cwd,
    sessionName: text(fields['sessionName'], MAX_SESSION_NAME_CHARS),
    promptSource,
    prompt: text(fields['prompt'], MAX_PRESET_PROMPT_CHARS),
    group: group(fields['group']),
    agent: agentName(fields['agent']),
    builtIn: fields['builtIn'] === true,
  };
}

/**
 * The list from `GET /projects/presets`.
 *
 * Drops what it cannot read rather than refusing the whole body — one unreadable row must not cost
 * the deck the other nine, which is the rule every parser in this folder follows.
 */
export function parseLaunchPresetList(value: unknown): readonly LaunchPreset[] {
  const fields = asFields(value);
  const presets = fields?.['presets'];
  if (!Array.isArray(presets)) return [];
  return presets
    .map((entry: unknown) => parseLaunchPreset(entry))
    .filter((preset): preset is LaunchPreset => preset !== undefined);
}

/** A draft out of a request body, or `undefined` for a body that is not one. @throws never. */
export function parsePresetDraft(body: string): PresetDraft | undefined {
  const fields = asFields(readJson(body));
  if (fields === undefined) return undefined;
  const profileFn = PROFILE_FUNCTIONS.find((known) => known === fields['profileFn']);
  const promptSource = PROMPT_SOURCES.find((known) => known === fields['promptSource']);
  const projectPath = text(fields['projectPath'], MAX_PRESET_CWD_CHARS);
  if (profileFn === undefined || promptSource === undefined || projectPath === '') return undefined;
  const agent = optionalAgent(fields['agent']);
  if (agent === false) return undefined;
  return {
    projectPath,
    name: text(fields['name'], MAX_PRESET_NAME_CHARS),
    profileFn,
    cwd: text(fields['cwd'], MAX_PRESET_CWD_CHARS),
    sessionName: text(fields['sessionName'], MAX_SESSION_NAME_CHARS),
    promptSource,
    // A `ticket` preset stores no prompt: it is computed from the name every time it is read.
    prompt: promptSource === 'ticket' ? '' : text(fields['prompt'], MAX_PRESET_PROMPT_CHARS),
    group: group(fields['group']),
    agent,
  };
}

/** The two fields `POST /projects/presets/forget` takes. @throws never. */
export function parsePresetRef(body: string): PresetRef | undefined {
  const fields = asFields(readJson(body));
  if (fields === undefined) return undefined;
  const projectPath = text(fields['projectPath'], MAX_PRESET_CWD_CHARS);
  const id = text(fields['id'], MAX_PRESET_NAME_CHARS);
  return projectPath === '' || id === '' ? undefined : { projectPath, id };
}

/** The refusal in an error body, or `undefined` for one this build does not know. @throws never. */
export function parsePresetRefusal(value: unknown): PresetRefusal | undefined {
  const error: unknown = asFields(value)?.['error'];
  return PRESET_REFUSALS.find((refusal) => refusal === error);
}

/** Presets in one stable order: by project, then by the name the owner reads. */
export function byProjectThenName(left: LaunchPreset, right: LaunchPreset): number {
  if (left.projectKey !== right.projectKey) return left.projectKey < right.projectKey ? -1 : 1;
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  return left.id < right.id ? -1 : 1;
}

/**
 * An optional agent on a request: absent, `null` and `''` are none; a string must be agent-shaped.
 *
 * `false` for a value that is present and not a name, so the caller refuses the body rather than
 * saving a preset with the agent quietly dropped — a button that starts something other than what
 * it was saved as is the failure this field exists to avoid. Exported because `POST /sessions`
 * reads the same field with the same rule.
 *
 * @throws never.
 */
export function optionalAgent(value: unknown): string | undefined | false {
  if (value === undefined || value === null || value === '') return undefined;
  return agentName(value) ?? false;
}

function asFields(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function readJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** The stored name, or the id when a row lost it — a preset nobody can read is one nobody presses. */
function nameOr(value: unknown, id: string): string {
  const held = text(value, MAX_PRESET_NAME_CHARS);
  return held === '' ? id : held;
}

function text(value: unknown, cap: number): string {
  return typeof value === 'string' ? value.trim().slice(0, cap) : '';
}

function group(value: unknown): string | undefined {
  const held = text(value, MAX_PRESET_GROUP_CHARS);
  return held === '' ? undefined : held;
}
