// What the projects panel renders — P3-T1, CODING-STANDARDS §3 ("React is not exempt from OOP").
//
// A class rather than logic in the component, for the usual reason and one specific to this panel:
// **turning a refusal code into a sentence is a decision, not markup.** Core answers with a closed
// union (`ImportRefusal`) precisely so that nothing it says was composed from what the request
// contained, and the English lives on this side because that is where the reader is. A component
// with a `switch` inside its JSX would be a decision nobody can unit-test.
//
// **The sentences say what to do, not what happened.** "That folder is not there" is a typo the
// owner fixes in two seconds; "that is a Claude Code config directory" is a rule they need to know
// once. A refusal that only restated its own code would be the code, spelled longer.
//
// **Turning a git reading into a phrase is the same kind of decision** (P3-T2). Core answers with
// numbers — `dirty: 3`, `ahead: 2` — because a number is something both ends can reason about, and
// "3 changed · 2 ahead" is English that belongs where the reader is. `clean` is the case worth
// naming: a repository with nothing in any of the four counts says so out loud rather than
// rendering an empty space that reads as "not loaded yet".
import type { GitStatus } from '../../contracts/git-status.ts';
import {
  agentRoster,
  type LaunchPreset,
  type PresetRefusal,
} from '../../contracts/launch-preset.ts';
import type { ProjectStatus, StackLabel } from '../../contracts/project-status.ts';
import type { ImportRefusal, ProjectRecord } from '../../contracts/project.ts';
import { projectKey } from '../../contracts/project.ts';
import type { ObservedBehaviour } from '../../contracts/observed-behaviour.ts';
import { coachPlanUrl, type ProjectGates } from '../../contracts/project-gates.ts';
import { NO_ACTIVITY, type ProjectActivity } from './project-scope.ts';
import type { ConfigDrift } from '../../contracts/config-snapshot.ts';
import { ConfigDriftViewModel } from './config-drift-view-model.ts';
import type { WorkflowMap } from '../../contracts/workflow-map.ts';
import { AssetPresets } from './asset-presets.ts';
import { PresetsViewModel } from './presets-view-model.ts';
import { WorkflowMapViewModel } from './workflow-map-view-model.ts';

/**
 * One line per refusal. Exhaustive over `ImportRefusal` by construction — a `Record` of the union,
 * so adding a refusal in `contracts/` stops this file compiling until somebody writes its sentence.
 */
const SENTENCES: Readonly<Record<ImportRefusal, string>> = {
  empty: 'Type the full path to a folder.',
  not_absolute: 'Give the whole path, starting with a drive letter — C:\\Users\\… .',
  too_long: 'That path is too long to be a folder.',
  traversal: 'Paths with `..` in them are refused — give the folder itself.',
  missing: 'There is no folder at that path.',
  not_a_directory: 'That is a file. Import the folder it is in.',
  config_directory: 'That is a Claude Code config directory, or it contains one. Pick a project.',
};

/** One imported project, ready to draw. */
export interface ProjectLine {
  /** `projectKey` — the React key, and what the withdraw button sends back. */
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly importedAt: number;
  /** The detected stack, already in display order. Empty for a folder with no marker. */
  readonly stack: readonly StackLabel[];
  /**
   * The branch, or `undefined` for a detached HEAD, a folder that is not a repository, and one
   * whose reading has not arrived yet. A panel draws nothing for all four.
   */
  readonly branch: string | undefined;
  /** `clean`, or what is outstanding — `3 changed · 2 ahead`. `undefined` when there is no git. */
  readonly gitSummary: string | undefined;
  /** `merging`, `rebasing` … when git is mid-operation. It changes what every other count means. */
  readonly progress: string | undefined;
  /**
   * What Claude is configured to do in this folder — P3-T3.
   *
   * A view model rather than the reading, and it is always here rather than sometimes: a map that
   * has not arrived is one that answers `isKnown: false`, and the panel draws no section for it.
   * Nesting it means the workflow map is the project row's own detail rather than a second list
   * the panel has to keep aligned with this one by key.
   */
  readonly map: WorkflowMapViewModel;
  /**
   * The named ways to start a session in this folder — P4-T1.
   *
   * Nested for `map`'s reason and with the same always-here rule: a project with no presets yet is
   * one whose list has not arrived, and the panel draws no section for it. Every imported folder
   * has four the moment core answers, because they are computed rather than seeded
   * (`PresetCatalogue`).
   */
  readonly presets: PresetsViewModel;
  /** What each workflow-map row's `make a preset` would draft here — P9-T2. */
  readonly assetPresets: AssetPresets;
  /**
   * The sessions in this project and its worktrees, across both subscriptions — P3-T6.
   *
   * SPEC §5.6's by-project row asks for this, for git (above) and for today's cost. Cost is
   * **not** here and is not missing: aggregating spend per path slug is P3-T5's whole task, and a
   * number invented here would be the one that task then had to contradict.
   */
  readonly activity: ProjectActivity;
  /** Whether the deck is currently pointed at this one. */
  readonly isCurrent: boolean;
  /**
   * What coach gates in this folder, or `undefined` when it does not — P3-T6, D12.
   *
   * `gates.json` carries the gate DEFINITIONS and no verdict (`contracts/project-gates.ts`), so
   * this is what the gates are and `coachUrl` is where the verdict lives. Flightdeck never scores.
   */
  readonly gates: ProjectGates | undefined;
  /** Coach's page for this project. Always present — it is a URL, not a claim that coach is up. */
  readonly coachUrl: string;
  /**
   * What Claude actually did here, or `undefined` — P3-T5.
   *
   * Three states rather than two, which is why `observedAsked` is beside it: absent means nobody
   * pressed the button, present-and-`undefined` means a 90 MB read is in flight, and a reading is
   * an answer. Same shape as a session preview's, for the same reason.
   */
  readonly observed: ObservedBehaviour | undefined;
  readonly observedAsked: boolean;
  /**
   * What last changed in this folder's configuration — P3-T7.
   *
   * Always a model, never `undefined`: a folder that has never changed answers `isKnown` false
   * and the panel draws nothing, which is one branch in one place rather than two call sites
   * each deciding what absence looks like.
   */
  readonly drift: ConfigDriftViewModel;
}

/**
 * What the panel is built from — P4-T1 turned four positional parameters into one object.
 *
 * Six of them would have been three too many (`max-params` is 4, and the rule is there because
 * `new ProjectsViewModel(a, b, c, d, e, f)` is unreadable at the call site). The three readings are
 * optional because each arrives on its own route with its own cost and a row draws with whichever
 * of them has come back; `refusal` is required and nullable because "no refusal" is a state the
 * panel renders differently from "not asked".
 */
export interface ProjectsInput {
  readonly projects: readonly ProjectRecord[];
  readonly refusal: ImportRefusal | undefined;
  readonly statuses?: Readonly<Record<string, ProjectStatus>>;
  readonly maps?: Readonly<Record<string, WorkflowMap>>;
  readonly presets?: readonly LaunchPreset[];
  readonly presetRefusal?: PresetRefusal | undefined;
  /** What each project's sessions add up to, from `ProjectScope.activity` — P3-T6. */
  readonly activity?: Readonly<Record<string, ProjectActivity>>;
  /** The current project's key, or `undefined` for all projects. */
  readonly current?: string | undefined;
  /** Sessions in no imported folder at all. Drawn beside "All projects", never hidden. */
  readonly unassigned?: number;
  /** Transcript readings, keyed by `projectKey` — P3-T5. A key absent means nobody asked. */
  readonly observed?: Readonly<Record<string, ObservedBehaviour | undefined>>;
  /** The last config change per folder — P3-T7. A key absent means it has never changed. */
  readonly drifts?: Readonly<Record<string, ConfigDrift>>;
  /**
   * Epoch ms, for the one age this panel prints.
   *
   * Passed in rather than read here, for the reason every age on this deck is: a view model that
   * called `Date.now()` would be one whose test says something different every time it runs.
   */
  readonly now?: number;
}

/** What a repository with nothing outstanding says. Named, because blank would read as unread. */
const CLEAN = 'clean';

/**
 * What to say when nothing has been imported.
 *
 * It describes the design rather than apologising for a gap: the registry ships empty because
 * importing is the owner's act and nothing scans the disk (D26), and a panel that said "no
 * projects found" would read as a search that failed.
 */
const NOTHING_YET =
  'No projects yet. Import a folder by its full path — nothing is scanned or copied.';

export class ProjectsViewModel {
  /** Exposed as a field so the panel and its test name the same string (see `NOTHING_YET`). */
  public readonly emptyMessage: string = NOTHING_YET;

  private readonly projects: readonly ProjectRecord[];
  private readonly refusal: ImportRefusal | undefined;
  private readonly statuses: Readonly<Record<string, ProjectStatus>>;
  private readonly maps: Readonly<Record<string, WorkflowMap>>;
  private readonly presets: readonly LaunchPreset[];
  private readonly presetRefusal: PresetRefusal | undefined;
  private readonly activity: Readonly<Record<string, ProjectActivity>>;
  private readonly current: string | undefined;
  private readonly unassignedCount: number;
  private readonly observed: Readonly<Record<string, ObservedBehaviour | undefined>>;
  private readonly drifts: Readonly<Record<string, ConfigDrift>>;
  private readonly now: number;

  constructor(input: ProjectsInput) {
    this.projects = input.projects;
    this.refusal = input.refusal;
    this.statuses = input.statuses ?? {};
    this.maps = input.maps ?? {};
    this.presets = input.presets ?? [];
    this.presetRefusal = input.presetRefusal;
    this.activity = input.activity ?? {};
    this.current = input.current;
    this.unassignedCount = input.unassigned ?? 0;
    this.observed = input.observed ?? {};
    this.drifts = input.drifts ?? {};
    this.now = input.now ?? 0;
  }

  /** Whether the deck is showing every session. The state it starts in, and the one to return to. */
  public get showingAll(): boolean {
    return this.current === undefined;
  }

  /**
   * What "All projects" says beside it.
   *
   * It names the sessions that belong to no imported folder, because that is the number a person
   * loses sight of the moment they focus a project — and losing sight of a session is the one
   * thing this deck exists to prevent.
   */
  public get unassignedLabel(): string | undefined {
    if (this.unassignedCount === 0) return undefined;
    const plural = this.unassignedCount === 1 ? 'session' : 'sessions';
    return `${String(this.unassignedCount)} ${plural} outside every imported folder`;
  }

  /**
   * The rows, each with whatever reading has arrived for it.
   *
   * The registry drives the list and the readings only annotate it — a status for a folder that is
   * no longer imported draws nothing, because there is no row to draw it on. That is the right way
   * round: the record is the permission, and the reading is a comment on it.
   */
  public get lines(): readonly ProjectLine[] {
    return this.projects.map((project) => {
      const key = projectKey(project.path);
      const git = this.statuses[key]?.git;
      return {
        key,
        name: project.name,
        path: project.path,
        importedAt: project.importedAt,
        stack: this.statuses[key]?.stack ?? [],
        branch: git?.branch,
        gitSummary: git === undefined ? undefined : summarise(git),
        progress: git?.progress,
        map: new WorkflowMapViewModel(this.maps[key]),
        presets: this.presetsFor(project.path, key),
        assetPresets: this.assetPresetsFor(project.path, key),
        activity: this.activity[key] ?? NO_ACTIVITY,
        isCurrent: this.current === key,
        gates: this.maps[key]?.gates,
        coachUrl: coachPlanUrl(project.name),
        observed: this.observed[key],
        observedAsked: key in this.observed,
        drift: new ConfigDriftViewModel(this.drifts[key], this.now),
      };
    });
  }

  public get isEmpty(): boolean {
    return this.projects.length === 0;
  }

  /** The refusal in English, or `undefined` when the last import was taken. */
  public get problem(): string | undefined {
    return this.refusal === undefined ? undefined : SENTENCES[this.refusal];
  }

  /** What the map's `make a preset` drafts in one project — its roster and its habit (P9-T2). */
  private assetPresetsFor(root: string, key: string): AssetPresets {
    const roster = agentRoster(this.maps[key]?.assets ?? []);
    return new AssetPresets({ root, roster, observed: this.observed[key] });
  }

  /** One project's presets, with the agent roster its map carries (`agentRoster`, P9-T1). */
  private presetsFor(path: string, key: string): PresetsViewModel {
    const roster = agentRoster(this.maps[key]?.assets ?? []);
    return new PresetsViewModel(this.presets, path, this.presetRefusal, roster);
  }
}

/**
 * The four counts as a phrase, in the order somebody acts on them.
 *
 * Conflicts first because a conflict blocks everything else, then the working tree, then the two
 * halves of the divergence. Each part is omitted when it is zero rather than printed as `0`, which
 * is what keeps the usual case to two words instead of four zeroes.
 */
function summarise(git: GitStatus): string {
  const parts = [
    counted(git.conflicts, 'conflict', 'conflicts'),
    counted(git.dirty, 'changed', 'changed'),
    counted(git.ahead, 'ahead', 'ahead'),
    counted(git.behind, 'behind', 'behind'),
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? CLEAN : parts.join(' · ');
}

/**
 * `2 conflicts`, or nothing at all when the count is zero.
 *
 * Both words are given rather than an `s` appended, because three of the four do not take one —
 * "2 changeds" is the bug that rule would write.
 */
function counted(count: number, one: string, many: string): string | undefined {
  if (count <= 0) return undefined;
  return `${String(count)} ${count === 1 ? one : many}`;
}
