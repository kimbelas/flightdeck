// What the workflow-map panel renders — P3-T3, CODING-STANDARDS §3 ("React is not exempt").
//
// Core answers with lists, counts and closed unions; every sentence, every "3 agents", every
// `10 kB` is decided here, because that is where the reader is. The rule this file keeps is the
// one `ProjectsViewModel` states: nothing on screen was composed by core out of what is on disk.
// The three strings that DID come off disk — an asset's name and description, a hook's command —
// are rendered as text by React and never interpreted (§11).
//
// **The summary line is the panel.** A repository with 3 agents, 3 commands, 10 skills and 17
// hooks has more in its config than fits on a row, so what a closed section shows is the shape of
// it — the counts, in one line — and opening it shows the detail. A panel that led with 17 hook
// rows would answer a question nobody asked yet.
//
// **A count of zero is not drawn.** Six sections that all say "0 commands" is six rows of nothing,
// and the instruction stack already answers "does this repo configure anything" more directly.
// `docs-tool` — the P3 gate's second half — therefore renders as one sentence rather than as an
// empty form, which is what "degrades gracefully" has to mean on screen.
//
// **The hook timeline keeps core's order and is grouped, not sorted.** Claude Code runs a matcher
// group's commands in the order they are written, so re-ordering them would answer a different
// question (contracts/hook-timeline.ts). Grouping by event is a heading over a run of rows that
// were already adjacent, which changes nothing about the sequence.
//
// **A plugin's assets are drawn under their plugin (P9-T5)**, one heading per plugin, below the
// project's own three. They are not the repository's config — they come from a config dir's
// install — so the three kind lists and their counts stay the project's own, and the closed line
// gains one `N plugin assets` rather than folding fifteen `superpowers` skills into `skills`.
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import type { HookStep } from '../../contracts/hook-timeline.ts';
import type { InstructionFile, InstructionSource } from '../../contracts/instruction-stack.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import { MAIN_TREE_ID } from '../../contracts/worktree.ts';

/**
 * What each instruction source is called on screen.
 *
 * Exhaustive over the union by construction, so adding a source in `contracts/` stops this file
 * compiling until somebody names it. The two user files say which subscription they belong to
 * because that is the only thing that distinguishes them, and a session runs under exactly one.
 */
const SOURCE_NAMES: Readonly<Record<InstructionSource, string>> = {
  'user-365': 'user CLAUDE.md (365)',
  'user-isg': 'user CLAUDE.md (isg)',
  'claude-md': 'CLAUDE.md',
  'agents-md': 'AGENTS.md',
  'soul-md': '.claude/soul.md',
};

/** What a folder with no `.claude` says. It describes the repository, not a failed read. */
const NOT_CONFIGURED =
  'No .claude here — Claude runs with the instruction stack above and nothing else.';

/** One file in the stack, ready to draw. Absent files are drawn too — see `instructions`. */
export interface InstructionLine {
  readonly source: InstructionSource;
  readonly name: string;
  /** `3.4 kB`, or `undefined` for a file that is not there. */
  readonly size: string | undefined;
}

/** One installed plugin and what it carries, in core's order (agents, commands, skills). */
export interface PluginGroup {
  readonly plugin: string;
  readonly assets: readonly ClaudeAsset[];
}

/** One heading and the steps under it, in the order they run. */
export interface HookGroup {
  readonly event: string;
  readonly steps: readonly HookStep[];
}

export class WorkflowMapViewModel {
  /** Exposed as a field so the panel and its test name the same string. */
  public readonly emptyMessage: string = NOT_CONFIGURED;

  private readonly map: WorkflowMap | undefined;

  /** @param map `undefined` until the first reply arrives for this project. */
  constructor(map: WorkflowMap | undefined) {
    this.map = map;
  }

  /** Whether there is anything at all to draw. A project whose map has not arrived draws nothing. */
  public get isKnown(): boolean {
    return this.map !== undefined;
  }

  /** Whether the repository has a `.claude` at all — the P3 gate's two halves (`WorkflowMap`). */
  public get isConfigured(): boolean {
    return this.map?.configured === true;
  }

  /**
   * The shape of the config in one line — `3 agents · 10 skills · 17 hooks · 1 MCP server`.
   *
   * Empty when there is nothing to count, which is what makes the closed section collapse to the
   * sentence above rather than to a row of zeroes.
   */
  public get summary(): readonly string[] {
    if (this.map === undefined) return [];
    const map = this.map;
    return [
      counted(this.kind('agent').length, 'agent', 'agents'),
      counted(this.kind('command').length, 'command', 'commands'),
      counted(this.kind('skill').length, 'skill', 'skills'),
      counted(this.fromPlugins().length, 'plugin asset', 'plugin assets'),
      counted(map.hooks.length, 'hook', 'hooks'),
      counted(map.servers.length, 'MCP server', 'MCP servers'),
      counted(map.plugins.length, 'plugin', 'plugins'),
      counted(map.permissions.allow.length, 'allow rule', 'allow rules'),
      counted(map.permissions.deny.length, 'deny rule', 'deny rules'),
    ].filter((part): part is string => part !== undefined);
  }

  /** Every source, present or not, in resolution order. The gaps are the point — SPEC §5.1. */
  public get instructions(): readonly InstructionLine[] {
    return (this.map?.instructions ?? []).map((file) => ({
      source: file.source,
      name: SOURCE_NAMES[file.source],
      size: sizeOf(file),
    }));
  }

  public get agents(): readonly ClaudeAsset[] {
    return this.kind('agent');
  }

  public get commands(): readonly ClaudeAsset[] {
    return this.kind('command');
  }

  public get skills(): readonly ClaudeAsset[] {
    return this.kind('skill');
  }

  /**
   * Each plugin's assets under its name, sorted by plugin — core already sends them that way, and
   * grouping is a heading over a run that was adjacent (the hook timeline's rule).
   */
  public get pluginGroups(): readonly PluginGroup[] {
    const groups: PluginGroup[] = [];
    for (const asset of this.fromPlugins()) {
      const plugin = asset.plugin ?? '';
      const last = groups.at(-1);
      if (last?.plugin === plugin)
        groups[groups.length - 1] = { plugin, assets: [...last.assets, asset] };
      else groups.push({ plugin, assets: [asset] });
    }
    return groups;
  }

  /** The timeline, grouped under its event headings and otherwise untouched. See the header. */
  public get hookGroups(): readonly HookGroup[] {
    const groups: HookGroup[] = [];
    for (const step of this.map?.hooks ?? []) {
      const last = groups.at(-1);
      if (last?.event === step.event)
        groups[groups.length - 1] = { ...last, steps: [...last.steps, step] };
      else groups.push({ event: step.event, steps: [step] });
    }
    return groups;
  }

  /** `stdio · chrome-devtools` — the name and how it is reached, never its command line. */
  public get servers(): readonly string[] {
    return (this.map?.servers ?? []).map((server) => `${server.name} (${server.transport})`);
  }

  /** Plugins and marketplaces read together: a plugin comes FROM a marketplace (D26). */
  public get plugins(): readonly string[] {
    return this.map?.plugins ?? [];
  }

  public get marketplaces(): readonly string[] {
    return this.map?.marketplaces ?? [];
  }

  /** `auto · 34 allow · 2 deny`. `defaultMode` first: it changes what the other two mean. */
  public get permissions(): string | undefined {
    const rules = this.map?.permissions;
    if (rules === undefined) return undefined;
    const parts = [
      rules.defaultMode,
      counted(rules.allow.length, 'allow', 'allow'),
      counted(rules.deny.length, 'deny', 'deny'),
      counted(rules.ask.length, 'ask', 'ask'),
    ].filter((part): part is string => part !== undefined);
    return parts.length === 0 ? undefined : parts.join(' · ');
  }

  /** The full lists SPEC asks for on expand, deny first — the half that is doing the work. */
  public get permissionRules(): readonly string[] {
    const rules = this.map?.permissions;
    return rules === undefined ? [] : [...rules.deny, ...rules.ask, ...rules.allow];
  }

  /**
   * `main · XWEB-1853 · XWEB-1854` — every checkout, main first (P3-T4).
   *
   * The id and the branch together only when they differ, which is the common case worth the
   * width: a worktree is named after the ticket and checked out on a branch named after the same
   * ticket, so `XWEB-1853 (XWEB-1853)` would be the row this rule exists to avoid. A detached head
   * shows the id alone — it has no branch, and `worktree.ts` says why that is not a sha.
   *
   * Empty for a folder outside a repository and for one with a single checkout: a repository with
   * no worktrees has nothing to say here that the branch on the project row does not already say.
   */
  public get worktrees(): readonly string[] {
    const trees = this.map?.worktrees ?? [];
    if (trees.length < 2) return [];
    return trees.map((tree) =>
      tree.branch === undefined || tree.branch === tree.id
        ? tree.id
        : `${tree.id} (${tree.branch})`,
    );
  }

  /** Whether this repository has linked worktrees at all — the heading's own condition. */
  public get hasWorktrees(): boolean {
    return this.worktrees.length > 0;
  }

  /** Which tree the imported folder itself is, for the row that names it. `undefined` when none. */
  public get currentTree(): string | undefined {
    const trees = this.map?.worktrees ?? [];
    const here = trees.find((tree) => tree.path === this.map?.path);
    return here === undefined ? undefined : here.id;
  }

  /** Whether the imported folder is the main checkout rather than a linked worktree. */
  public get isMainTree(): boolean {
    return this.currentTree === MAIN_TREE_ID;
  }

  /** `rules 6 · specs 9 · state 28` — only the folders that hold something. */
  public get conventions(): readonly string[] {
    return (this.map?.conventions ?? [])
      .filter((folder) => folder.files > 0)
      .map((folder) => `${folder.folder} ${String(folder.files)}`);
  }

  /** The project's OWN assets of one kind — a plugin's are `pluginGroups`. */
  private kind(wanted: ClaudeAsset['kind']): readonly ClaudeAsset[] {
    return (this.map?.assets ?? []).filter(
      (asset) => asset.kind === wanted && asset.plugin === undefined,
    );
  }

  private fromPlugins(): readonly ClaudeAsset[] {
    return (this.map?.assets ?? []).filter((asset) => asset.plugin !== undefined);
  }
}

/**
 * `683 B`, `3.4 kB`, `1.2 MB` — or `undefined` for a file that is not there.
 *
 * Decimal rather than binary units, and one decimal place below a megabyte: the number is there to
 * say how much of the context window a file spends, and `3.4 kB` answers that where `3482 bytes`
 * makes the reader do the division.
 */
function sizeOf(file: InstructionFile): string | undefined {
  const bytes = file.bytes;
  if (bytes === undefined) return undefined;
  if (bytes < 1000) return `${String(bytes)} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
}

/**
 * `3 agents`, or nothing at all when the count is zero.
 *
 * Both words are given rather than an `s` appended, for `ProjectsViewModel`'s reason: not every
 * plural in here takes one, and "1 allow rules" is the bug that rule would write.
 */
function counted(count: number, one: string, many: string): string | undefined {
  if (count <= 0) return undefined;
  return `${String(count)} ${count === 1 ? one : many}`;
}
