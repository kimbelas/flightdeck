// Which agents a project may start a session under — P9-T1, SEC-PROC-2.
//
// **The roster is the allowlist, and this is the only thing that reads it for a launch.** A preset
// agent is not a text box: it is a name found under the project's `.claude/agents/*.md` by the
// same `ClaudeAssetReader` the workflow map draws its agents with, so the select in the presets
// panel and the check here cannot disagree about what a name is (frontmatter `name`, else the file
// name). A name that is not `AGENT_SHAPE` is not on the roster at all — it reaches an argv element,
// a JSON body, a database column and a log line, and a name that needs escaping in any of them is
// not one this build will pass.
//
// **Read fresh on every question, never through the map's cache.** `WorkflowMapReader` holds a map
// for five minutes on a signature of `.claude`'s own mtime, and deleting `agents/x.md` moves the
// mtime of `agents`, not of `.claude`. A launch that trusted the cache would start an agent Claude
// Code will not find. The cost is one directory listing and a 4 KB head per agent, against a launch
// that takes seconds.
//
// **One project's roster, the project the folder is IN.** A preset in a worktree under the project
// is checked against the project root's roster — the preset was filed under the project, and a
// worktree is not itself imported (G.26-G.28). Containment by `resolveDirectory` first, so a junction
// out of the tree is refused before anything is listed (SEC-FS-1).
import { AGENT_SHAPE, agentRoster } from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { childPath, isUnder } from '../../contracts/windows-path.ts';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import type { Result } from '../shared/result.ts';

/** The three doors of the registry this needs, and nothing that writes. */
export interface RosterRegistry {
  list(): readonly ProjectRecord[];
  resolveRoot(path: string): Promise<Result<string, string>>;
  resolveDirectory(path: string): Promise<Result<string, string>>;
}

/** `ClaudeAssetReader.assets`, narrowed to the one call a roster makes. */
export interface RosterAssets {
  assets(claudeDir: string): Promise<readonly ClaudeAsset[]>;
}

export interface AgentRosterParts {
  readonly registry: RosterRegistry;
  readonly assets: RosterAssets;
}

export class AgentRoster {
  private readonly parts: AgentRosterParts;

  constructor(parts: AgentRosterParts) {
    this.parts = parts;
  }

  /**
   * Every agent-shaped agent name under one imported project's `.claude/agents`, sorted.
   *
   * Empty for a project that is not imported, has no `.claude`, or has no agents — three states the
   * caller treats alike, because each means "no agent may be named here".
   */
  public async namesFor(projectPath: string): Promise<readonly string[]> {
    const root = await this.parts.registry.resolveRoot(projectPath);
    if (!root.ok) return [];
    return agentRoster(await this.parts.assets.assets(childPath(root.value, '.claude')));
  }

  /** Whether `agent` is on the roster of the imported project that `cwd` is inside. */
  public async allows(cwd: string, agent: string): Promise<boolean> {
    if (!AGENT_SHAPE.test(agent)) return false;
    const directory = await this.parts.registry.resolveDirectory(cwd);
    if (!directory.ok) return false;
    const project = this.projectContaining(directory.value);
    if (project === undefined) return false;
    return (await this.namesFor(project.path)).includes(agent);
  }

  /** The innermost imported root the folder is under — a nested import is its own project. */
  private projectContaining(directory: string): ProjectRecord | undefined {
    const key = projectKey(directory);
    return this.parts.registry
      .list()
      .filter((project) => isUnder(key, projectKey(project.path)))
      .sort((left, right) => right.path.length - left.path.length)[0];
  }
}
