// What Claude is configured to do in one imported folder — P3-T3, SPEC §5.1(a).
//
// The aggregate over the seven readings this task ships, and the answer to SPEC's own framing of
// F1: "what does Claude do in this repo?", entirely from the repo's own config. Its sibling is
// `ProjectStatus`, which is the same shape of thing for the two rows P3-T2 shipped — a reading
// taken a moment ago, on its own route, keyed by path, and never in the store (DECISIONS.md D37).
//
// **One type and one request for all seven, not seven routes.** They come out of one directory,
// share one cache signature — anything that changes the map moves `.claude`'s mtime — and are
// drawn on one panel. Seven routes would be seven round trips through the rewrite for a panel that
// opens once.
//
// **Everything here is a list, and an empty list is an answer.** `docs-tool` is the P3 gate's
// second half and has no `.claude` at all: it comes back with every list empty, its instruction
// stack holding only a `CLAUDE.md`, and it renders as a project with no workflow rather than as a
// failure. Nothing in this type is optional for that case, because "no agents" and "could not read
// the agents" draw the same thing and neither is worth a distinct state.
//
// **The three config rows come from the PROJECT's `settings.json`, not the machine's.** Plugins,
// marketplaces and permissions are read from `<project>\.claude\settings.json`, which is the file
// the row is about — the config dirs have their own and they belong to the subscription rather
// than to the repository. The one machine-wide thing in here is the user `CLAUDE.md` of both
// config dirs, which is in the instruction stack because SPEC puts it there: it is part of what
// Claude is told when it runs in this folder (DECISIONS.md D38).
import { parseClaudeAsset, type ClaudeAsset } from './claude-assets.ts';
import {
  parseMcpServers,
  parseNameList,
  parsePermissionRules,
  type McpServer,
  type PermissionRules,
} from './claude-settings.ts';
import { parseHookSteps, type HookStep } from './hook-timeline.ts';
import { parseInstructionStack, type InstructionFile } from './instruction-stack.ts';
import { MAX_PROJECT_PATH_CHARS } from './project.ts';
import { parseProjectGatesReply, type ProjectGates } from './project-gates.ts';
import { parseWorktrees, type Worktree } from './worktree.ts';

/**
 * The `.claude/` folders SPEC §5.1 names as conventions and in-flight work.
 *
 * Counted rather than listed, which is SPEC's own word ("file counts"). The contents are the
 * repository's working notes — 28 files under `state/` in the acceptance target — and a panel that
 * listed them would be a file browser. The count answers the question the row is for: does this
 * repository keep rules and specs, and is there work in flight.
 */
export const CONVENTION_FOLDERS = [
  'rules',
  'specs',
  'state',
  'maps',
  'reference',
  'prompts',
] as const;

export type ConventionFolder = (typeof CONVENTION_FOLDERS)[number];

export interface ConventionCount {
  readonly folder: ConventionFolder;
  /** Entries directly inside it. `0` for a folder that is not there — see `WorkflowMap`. */
  readonly files: number;
}

export interface WorkflowMap {
  /** Which project this is about — the stored path, so the deck can match it to a row. */
  readonly path: string;
  /** When the reading was taken, not when it was asked for (`ProjectStatus` gives the reasoning). */
  readonly at: number;
  /** Every source, present or absent, in resolution order. See `instruction-stack.ts`. */
  readonly instructions: readonly InstructionFile[];
  /** Agents, commands and skills in one list, each carrying its `kind`. */
  readonly assets: readonly ClaudeAsset[];
  /** Flattened into run order — one row per thing that can fire (`hook-timeline.ts`). */
  readonly hooks: readonly HookStep[];
  readonly servers: readonly McpServer[];
  readonly plugins: readonly string[];
  readonly marketplaces: readonly string[];
  readonly permissions: PermissionRules;
  /** All six, always, so a repository that keeps none of them says so. */
  readonly conventions: readonly ConventionCount[];
  /**
   * Every checkout of this repository, main first — P3-T4, `worktree.ts`.
   *
   * The one reading in here that is not about `.claude` at all, and it is in the map rather than
   * on `ProjectStatus` because SPEC §5.1(a)'s table puts it here: a worktree is a place to start a
   * session, and the map is the catalogue of what a session in this folder would be. Empty for a
   * folder that is not in a repository and for a repository with only a main checkout core may not
   * read — the deck draws the same nothing for both.
   */
  readonly worktrees: readonly Worktree[];
  /**
   * What `.claude/gates.json` configures, or `undefined` on a project coach does not gate — P3-T6.
   *
   * It is in the map for the reason everything else here is: it comes out of `.claude`, it shares
   * the cache signature, and it answers "what does Claude do in this repo?". What it is NOT is a
   * verdict — that word is SPEC's and the file does not carry one (`project-gates.ts`). The deck
   * shows the gates and links to coach, which is whose verdict it is (D12).
   */
  readonly gates: ProjectGates | undefined;
  /**
   * Whether the folder has a `.claude` directory at all.
   *
   * The one flag in here, and it earns its place: it is the difference between "this repository
   * configures nothing" and "this repository configures nothing that this build can read", and it
   * is exactly the distinction the P3 gate's `docs-tool` half is about. Without it the deck would
   * have to infer it from seven empty lists, which is the inference this type exists to spare it.
   */
  readonly configured: boolean;
}

/** One map, from a `GET /projects/map` body. @throws never. */
export function parseWorkflowMap(value: unknown): WorkflowMap | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value));
  const path = fields['path'];
  const at = fields['at'];
  if (typeof path !== 'string' || path === '' || path.length > MAX_PROJECT_PATH_CHARS) {
    return undefined;
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  return {
    path,
    at,
    instructions: parseInstructionStack(fields['instructions']),
    assets: assetList(fields['assets']),
    hooks: parseHookSteps(fields['hooks']),
    servers: parseMcpServers(fields['servers']),
    plugins: parseNameList(fields['plugins']),
    marketplaces: parseNameList(fields['marketplaces']),
    permissions: parsePermissionRules(fields['permissions']),
    conventions: conventionList(fields['conventions']),
    worktrees: parseWorktrees(fields['worktrees']),
    gates: parseProjectGatesReply(fields['gates']),
    configured: fields['configured'] === true,
  };
}

/**
 * Every map, from a `GET /projects/map` body.
 *
 * Drops what it cannot read rather than refusing the whole list — one unreadable row must not cost
 * the deck the other nine, which is the rule every parser in this folder follows.
 *
 * @throws never.
 */
export function parseWorkflowMapList(value: unknown): readonly WorkflowMap[] {
  if (typeof value !== 'object' || value === null) return [];
  const maps: unknown = Object.fromEntries(Object.entries(value))['maps'];
  if (!Array.isArray(maps)) return [];
  const parsed: WorkflowMap[] = [];
  for (const entry of maps) {
    const map = parseWorkflowMap(entry);
    if (map !== undefined) parsed.push(map);
  }
  return parsed;
}

/** The assets the wire carried that this build can name, in the order they arrived. */
function assetList(value: unknown): readonly ClaudeAsset[] {
  if (!Array.isArray(value)) return [];
  const assets: ClaudeAsset[] = [];
  for (const entry of value) {
    const asset = parseClaudeAsset(entry);
    if (asset !== undefined) assets.push(asset);
  }
  return assets;
}

/**
 * All six folders, in `CONVENTION_FOLDERS` order, whatever the wire sent.
 *
 * Rebuilt from the declared tuple for the reason `parseInstructionStack` is: the order is a
 * property of this build, and a folder nobody here named is not drawn under a heading that does
 * not exist.
 */
function conventionList(value: unknown): readonly ConventionCount[] {
  const counts = new Map<string, number>();
  if (Array.isArray(value)) {
    for (const entry of value) countOf(counts, entry);
  }
  return CONVENTION_FOLDERS.map((folder) => ({ folder, files: counts.get(folder) ?? 0 }));
}

function countOf(counts: Map<string, number>, entry: unknown): void {
  if (typeof entry !== 'object' || entry === null) return;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(entry));
  const folder = fields['folder'];
  const files = fields['files'];
  if (typeof folder !== 'string') return;
  if (typeof files !== 'number' || !Number.isFinite(files) || files < 0) return;
  counts.set(folder, Math.trunc(files));
}
