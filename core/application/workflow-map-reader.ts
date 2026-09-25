// "What does Claude do in this repo?" — the whole of SPEC §5.1(a) for every imported folder (P3-T3).
//
// `ProjectStatusReader`'s sibling and the same shape of thing: the registry decides where core may
// look, this reads inside, nothing it produces goes in the store (DECISIONS.md D37). What differs
// is what a reading costs. Stack and git are a directory listing and a `git` spawn; a map is a
// directory listing per asset kind, a head read per asset, two JSON parses and eleven stats — so
// the cache matters more here than anywhere else in the project slice, and the signature is what
// makes it correct rather than merely fast.
//
// **Signed on `.claude`'s own mtime and its `settings.json`'s.** Those two stats prove that
// nothing which changes a map has happened: adding, renaming or deleting an agent, a command, a
// skill directory or a convention folder moves the directory's mtime, and editing the hooks,
// permissions or plugins moves the file's. What they cannot see is an edit INSIDE an existing
// `agents/*.md` — a description rewritten in place — which is what the TTL is for, and
// `statusline.py`'s 300 s config TTL is the number for exactly this kind of reading. Two stats
// against roughly thirty reads is the trade the whole `SignatureCache` design exists to make.
//
// **A project with no `.claude` still gets a map**, and that is the P3 gate's second half rather
// than a defensive branch. `docs-tool` has a `CLAUDE.md` and nothing else; it reports
// `configured: false`, an instruction stack with one entry in it and six empty lists, and the deck
// draws a project that has a repository and no workflow. Degrading gracefully is a rendering
// decision made possible by core answering fully.
//
// **The instruction stack is read even when `.claude` is missing**, because two of its five
// sources are not under `.claude` and one is not even under the project. That is why it is a
// collaborator of its own rather than a branch of the walk below.
import {
  readMarketplaces,
  readMcpServers,
  readPermissions,
  readPlugins,
  MAX_MCP_BYTES,
} from '../../contracts/claude-settings.ts';
import { readHookTimeline, MAX_SETTINGS_BYTES } from '../../contracts/hook-timeline.ts';
import { INSTRUCTION_SOURCES } from '../../contracts/instruction-stack.ts';
import {
  LOCAL_SETTINGS_FILE,
  SETTINGS_FILE,
  type ProjectPluginSettings,
} from '../../contracts/plugin-enablement.ts';
import { parseProjectGates } from '../../contracts/project-gates.ts';
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import { TICKET_FOLDERS } from '../../contracts/project-tickets.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { childPath } from '../../contracts/windows-path.ts';
import { CONVENTION_FOLDERS, type WorkflowMap } from '../../contracts/workflow-map.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { FileFacts, ProjectFiles } from '../ports/project-files.ts';
import type { ClaudeAssetReader } from './claude-asset-reader.ts';
import type { ProjectPaths } from './git-directory-locator.ts';
import type { InstructionStackReader } from './instruction-stack-reader.ts';
import type { PluginAssetReader } from './plugin-asset-reader.ts';
import type { ProjectTicketReader } from './project-ticket-reader.ts';
import type { ProjectSource } from './project-status-reader.ts';
import { SignatureCache } from './signature-cache.ts';
import type { WorktreeReader } from './worktree-reader.ts';

/** `statusline.py`'s config TTL, for the change the signature cannot see. See the header. */
const MAP_TTL_MS = 300_000;

/** The project's own config directory. Everything but the instruction stack hangs off it. */
const CLAUDE_DIR = '.claude';

/** coach-core's gate definitions, when the project is coached at all (P3-T6, D12). */
const GATES_FILE = 'gates.json';
/** The one measured on this machine is 1 452 bytes; this is room for a much larger one. */
const MAX_GATES_BYTES = 64 * 1024;
const MCP_FILE = '.mcp.json';

export interface WorkflowMapParts {
  readonly registry: ProjectSource;
  readonly paths: ProjectPaths;
  readonly instructions: InstructionStackReader;
  readonly assets: ClaudeAssetReader;
  /**
   * P9-T5. What the project's installed plugins carry, from the config dirs' `plugins\cache\` —
   * drawn in the same list as the project's own, each asset marked with its plugin.
   */
  readonly plugins: Pick<PluginAssetReader, 'assets' | 'signature'>;
  /** P3-T4. The one reading in the map that is about git rather than about `.claude`. */
  readonly worktrees: WorktreeReader;
  /** P9-T3. The ticket ids named by `specs/` and `state/` — names only. */
  readonly tickets: ProjectTicketReader;
  readonly files: ProjectFiles;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class WorkflowMapReader {
  private readonly parts: WorkflowMapParts;
  private readonly maps: SignatureCache<WorkflowMap>;

  constructor(parts: WorkflowMapParts) {
    this.parts = parts;
    this.maps = new SignatureCache(parts.clock);
  }

  /**
   * One map per imported project, in the registry's own order.
   *
   * In parallel, for `ProjectStatusReader`'s reason and more so: each map is tens of independent
   * reads, and four projects serialised would be four of those end to end for one panel.
   */
  public async readAll(): Promise<readonly WorkflowMap[]> {
    const projects = this.parts.registry.list();
    // Before the reads, so a folder forgotten a moment ago cannot be answered out of a cache
    // filled while it was still imported (SEC-FS-1) — `ProjectStatusReader` evicts the same way.
    this.maps.keep(projects.map((project) => projectKey(project.path)));
    return Promise.all(projects.map((project) => this.read(project)));
  }

  /** One project, from the cache when its signature has not moved and its TTL has not lapsed. */
  private async read(project: ProjectRecord): Promise<WorkflowMap> {
    const root = await this.parts.registry.resolveRoot(project.path);
    if (!root.ok) {
      // The registry still holds it and nothing else would ever say why it is empty — unplugged,
      // renamed, or a junction that now points somewhere it may not (SEC-FS-1).
      this.parts.logger.warn('project_root_unreadable', { refusal: root.error });
      return this.empty(project.path);
    }
    const claudeDir = childPath(root.value, CLAUDE_DIR);
    const signature = await this.signature(claudeDir, project.path);
    return this.maps.value(projectKey(project.path), signature, MAP_TTL_MS, () =>
      this.compose(project.path, root.value, claudeDir),
    );
  }

  /**
   * The eight readings, in parallel, into one map.
   *
   * The instruction stack is asked for whatever `.claude` turns out to be, because three of its
   * five sources are outside it — see the header.
   */
  private async compose(path: string, root: string, claudeDir: string): Promise<WorkflowMap> {
    // Parsed once and read twice: for the hooks, permissions and plugin names below, and as the
    // project half of plugin enablement (contracts/plugin-enablement.ts).
    const settingsRead = this.json(childPath(claudeDir, SETTINGS_FILE), MAX_SETTINGS_BYTES);
    const [
      instructions,
      assets,
      conventions,
      tickets,
      settings,
      mcp,
      gates,
      worktrees,
      configured,
    ] = await Promise.all([
      this.parts.instructions.read(root),
      this.assets(claudeDir, [path, root], this.pluginSettings(claudeDir, settingsRead)),
      this.parts.assets.conventions(claudeDir),
      this.parts.tickets.tickets(claudeDir),
      settingsRead,
      this.json(childPath(root, MCP_FILE), MAX_MCP_BYTES),
      // P3-T6. Through the same door as the other two JSON files, so an unreadable or refused
      // `gates.json` is `undefined` here and draws "not coached" rather than an error.
      this.json(childPath(claudeDir, GATES_FILE), MAX_GATES_BYTES),
      // The stored path, not the resolved root: `WorktreeReader` climbs from it exactly as
      // `ProjectGitReader` does, and the climb is the part that has to start where the owner
      // pointed rather than one `realpath` further in.
      this.parts.worktrees.read(path),
      this.isDirectory(claudeDir),
    ]);
    return {
      path,
      at: this.parts.clock.now().getTime(),
      instructions,
      assets,
      hooks: readHookTimeline(settings),
      servers: readMcpServers(mcp),
      plugins: readPlugins(settings),
      marketplaces: readMarketplaces(settings),
      permissions: readPermissions(settings),
      conventions,
      tickets,
      worktrees,
      gates: parseProjectGates(gates),
      configured,
    };
  }

  /** Both project-side `enabledPlugins` sources, the committed one already being read. */
  private async pluginSettings(
    claudeDir: string,
    settingsRead: Promise<unknown>,
  ): Promise<ProjectPluginSettings> {
    const [project, local] = await Promise.all([
      settingsRead,
      this.json(childPath(claudeDir, LOCAL_SETTINGS_FILE), MAX_SETTINGS_BYTES),
    ]);
    return { project, local };
  }

  /**
   * The project's own assets, then its ENABLED plugins' (P9-T5) — the order the panel draws them
   * in. A plugin the project's `settings.json` or `settings.local.json` switches off is not drawn.
   */
  private async assets(
    claudeDir: string,
    projectPaths: readonly string[],
    pluginSettings: Promise<ProjectPluginSettings>,
  ): Promise<readonly ClaudeAsset[]> {
    const [own, plugins] = await Promise.all([
      this.parts.assets.assets(claudeDir),
      pluginSettings.then((project) => this.parts.plugins.assets(projectPaths, project)),
    ]);
    return [...own, ...plugins];
  }

  /**
   * The two mtimes that prove the map has not moved — see the header.
   *
   * `''` when neither is there, which `SignatureCache` documents as "there is nothing cheap to
   * observe": a project with no `.claude` is then held on its TTL alone, which is the honest
   * degradation. It also means the map is recomputed the moment one is created, because the
   * signature stops being empty.
   */
  private async signature(claudeDir: string, projectPath: string): Promise<string> {
    const [directory, settings, local, worktrees, plugins, ...tickets] = await Promise.all([
      this.facts(claudeDir),
      this.facts(childPath(claudeDir, SETTINGS_FILE)),
      // An opt-out written to `settings.local.json` switches a plugin off here and nowhere else;
      // an edit in place moves neither `.claude` nor `settings.json`.
      this.stamp(childPath(claudeDir, LOCAL_SETTINGS_FILE)),
      // P3-T4's third stat, and it is a third stat rather than a third cache: the trees are part
      // of the same map and a `SignatureCache` of their own would recompute them on a clock the
      // panel never sees. `WorktreeReader` says what it observes and why that is the cheap thing.
      this.parts.worktrees.signature(projectPath),
      // P9-T5. Installing or removing a plugin rewrites a config dir's `installed_plugins.json`,
      // and enabling one at user scope its `settings.json` — neither under the project.
      this.parts.plugins.signature(),
      // P9-T3. A spec written for a new ticket moves `specs/`'s mtime and not `.claude`'s, and the
      // picker should offer it on the next read rather than five minutes later.
      ...TICKET_FOLDERS.map(({ folder }) => this.facts(childPath(claudeDir, folder))),
    ]);
    if (directory === undefined && settings === undefined && worktrees === '') return '';
    const folders = tickets.map((facts) => String(facts?.modifiedAt ?? 0)).join(':');
    return `${String(directory?.modifiedAt ?? 0)}:${String(settings?.modifiedAt ?? 0)}:${String(settings?.sizeBytes ?? 0)}:${worktrees}:${folders}:${plugins}:${local}`;
  }

  /** A file's mtime and size as one token, `0.0` when it is not there. */
  private async stamp(path: string): Promise<string> {
    const facts = await this.facts(path);
    return `${String(facts?.modifiedAt ?? 0)}.${String(facts?.sizeBytes ?? 0)}`;
  }

  /**
   * A small JSON file under the project, or `undefined` for absent, refused or unparseable.
   *
   * The three are one answer on purpose. `settings.json` and `.mcp.json` belong to the imported
   * repository, so malformed is an ordinary state — mid-edit, a merge conflict left in the file —
   * and a panel that reported a parse error would be reporting on the owner's own typing.
   */
  private async json(path: string, maxBytes: number): Promise<unknown> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return undefined;
    const text = await this.parts.files.read(resolved.value, maxBytes);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** `stat` through the one door. `undefined` for absent, unreadable and refused alike. */
  private async facts(path: string): Promise<FileFacts | undefined> {
    const resolved = await this.parts.paths.resolve(path);
    if (!resolved.ok) return undefined;
    return this.parts.files.facts(resolved.value);
  }

  /** Whether `.claude` is there — the one flag in the map, and the P3 gate's second half. */
  private async isDirectory(path: string): Promise<boolean> {
    return (await this.facts(path))?.isDirectory === true;
  }

  /**
   * What an unreadable folder answers.
   *
   * Every source and every convention folder is still reported, absent — the full shape rather
   * than two empty arrays, because "no `CLAUDE.md`" and "I could not look" already draw the same
   * row and a shorter list would make the two differ in the markup instead.
   */
  private empty(path: string): WorkflowMap {
    return {
      path,
      at: this.parts.clock.now().getTime(),
      instructions: INSTRUCTION_SOURCES.map((source) => ({ source, bytes: undefined })),
      assets: [],
      hooks: [],
      servers: [],
      plugins: [],
      marketplaces: [],
      permissions: { allow: [], deny: [], ask: [], defaultMode: undefined },
      conventions: CONVENTION_FOLDERS.map((folder) => ({ folder, files: 0 })),
      tickets: [],
      // A root core cannot resolve is one it cannot climb from either, so there is nothing to
      // report rather than nothing to say — the same answer as a folder outside a repository.
      worktrees: [],
      gates: undefined,
      configured: false,
    };
  }
}
