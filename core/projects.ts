// The project side of the composition root — `feeds.ts` and `reads.ts`'s third sibling (P3-T1).
//
// Split out for the reason those two were: `main.ts` is a file with a line limit and of what it
// does, this is a piece with a story of its own. The feeds are what NOTICES things, `reads.ts` is
// what ANSWERS a question about one of them, and this is what decides WHERE core is allowed to
// look at all.
//
// **It constructs the only `PathCanonicaliser` there is**, which is the reason this cannot live in
// the domain or the application layer: `realpath` is a syscall, the rule it feeds is pure string
// work, and the seam between them is exactly here (CODING-STANDARDS §2).
//
// **P3-T2 is the first task that reads INSIDE one**, and it is still this file that says where.
// `ProjectStatusReader` and `GitDirectoryLocator` are built here, against the same registry
// instance the three original routes share, because a second one would hold a second copy of the
// roots — and "which folders may be read" is not a question two objects may answer differently.
// They are built HERE rather than handed the registry from `main.ts`, which is the same division
// `reads.ts` made: a slice that owns a registry owns what is built on it, and `main.ts` has a line
// limit it already reached once.
import { PresetBook } from './application/preset-book.ts';
import { ProjectRegistry } from './application/project-registry.ts';
import { ClaudeAssetReader } from './application/claude-asset-reader.ts';
import { GitDirectoryLocator } from './application/git-directory-locator.ts';
import { InstructionStackReader } from './application/instruction-stack-reader.ts';
import { ProjectGitReader } from './application/project-git-reader.ts';
import { ProjectStatusReader } from './application/project-status-reader.ts';
import { WorkflowMapReader } from './application/workflow-map-reader.ts';
import { WorktreeReader } from './application/worktree-reader.ts';
import type { AuditLog } from './application/audit-log.ts';
import { FsPathCanonicaliser } from './adapters/node/fs-path-canonicaliser.ts';
import { FsProjectFiles } from './adapters/node/fs-project-files.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { SUBSCRIPTION_IDS } from '../contracts/session.ts';
import { ForgetProjectRoute } from './http/forget-project-route.ts';
import { ForgetPresetRoute, PresetsRoute, SavePresetRoute } from './http/presets-route.ts';
import { ImportProjectRoute } from './http/import-project-route.ts';
import { ProjectStatusRoute } from './http/project-status-route.ts';
import { ProjectsRoute } from './http/projects-route.ts';
import { WorkflowMapRoute } from './http/workflow-map-route.ts';
import type { Route } from './http/route.ts';
import { ConfigHistorian } from './application/config-historian.ts';
import { ObservedReader } from './application/observed-reader.ts';
import { ObservedRoute, type ObservedSource } from './http/observed-route.ts';
import { FsTranscriptFile } from './adapters/node/fs-transcript-file.ts';
import { projectKey } from '../contracts/project.ts';
import type { Clock } from './ports/clock.ts';
import type { Logger } from './ports/logger.ts';
import type { ProcessRunner } from './ports/process-runner.ts';
import type { Store } from './ports/store.ts';

export interface ProjectParts {
  readonly install: ClaudeInstall;
  readonly store: Store;
  readonly audit: AuditLog;
  /** The same runner the session sweep uses — `git -C <root> status` is one more argv (P3-T2). */
  readonly runner: ProcessRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The registry, loaded with whatever was imported before this boot.
 *
 * The config directories are passed as data rather than as `ClaudeInstall`, the way every inward
 * layer in core takes them, and they are here for one reason that is easy to misread: the registry
 * needs them to REFUSE, not to read. A folder that is a config directory — or that contains one —
 * cannot become a project (`ProjectImport`), and `ReadPolicy` screens anything under one by the
 * config-directory rules whatever else contains it.
 */
export function buildProjectRegistry(parts: ProjectParts): ProjectRegistry {
  return new ProjectRegistry({
    store: parts.store,
    paths: new FsPathCanonicaliser(),
    configDirs: SUBSCRIPTION_IDS.map((id) => parts.install.configDirFor(id)),
    audit: parts.audit,
    clock: parts.clock,
    logger: parts.logger,
  });
}

/**
 * The eight routes over one registry, as a list `main.ts` can spread into the router.
 *
 * Here rather than in `main.ts` for a reason that is more than tidiness: the router table is the
 * one list in the composition root that grows with every phase, and `main.ts` reached its line
 * limit adding the first three. A slice that owns a registry may as well own the routes onto it,
 * which is the same division `feeds.ts` made for the stream route.
 *
 * One registry for all eight, deliberately: a second would hold a second copy of the roots, and
 * "which folders may be read" is not a question two objects may answer differently. That is also
 * why `ProjectStatusReader` is assembled here — it needs `resolve`, and the only correct answer to
 * "which resolve" is "the one the import route wrote to".
 *
 * **It is HANDED the registry as of P6-T1**, rather than making one. A shell pane starts in an
 * imported folder (`ProjectRoots`), and the pane machinery is built beside the socket server in
 * `main.ts` — so the composition root owns the one registry and gives it to both. The same
 * argument as the paragraph above, one layer out: two objects answering "which folders" is
 * exactly what this file has always refused.
 */
export function projectSlice(parts: ProjectParts): ProjectSlice {
  const registry = buildProjectRegistry(parts);
  return { routes: projectRoutes(parts, registry), registry };
}

/** The routes, and the registry they share — which the pane machinery needs too (P6-T1). */
export interface ProjectSlice {
  readonly routes: readonly Route[];
  readonly registry: ProjectRegistry;
}

/** The eight routes over one registry. `projectSlice` is what the composition root calls. */
export function projectRoutes(parts: ProjectParts, registry: ProjectRegistry): readonly Route[] {
  const files = new FsProjectFiles();
  // One locator for both readers, P3-T4. It is stateless, so this is not about cost — it is that
  // "where is this folder's git directory" is the same question `ProjectGitReader` and
  // `WorktreeReader` ask, and the two walk it in opposite directions from the same answer.
  const locator = new GitDirectoryLocator(registry, files, parts.logger);
  // One book for all three preset routes, on the same registry, for the reason there is one
  // registry: a preset names a folder to start a session in, and "which folders may be started in"
  // is not a question two objects may answer differently (P4-T1).
  const presets = new PresetBook({
    registry,
    store: parts.store,
    audit: parts.audit,
    logger: parts.logger,
  });
  return [
    new ProjectsRoute(registry),
    new ImportProjectRoute(registry),
    new ForgetProjectRoute(registry),
    new ProjectStatusRoute(buildStatusReader(registry, files, locator, parts)),
    // P3-T7. The historian is the ONE thing in this slice that writes: a config change is an
    // observation that something happened, where a map is a reading of now (D37, D55).
    new WorkflowMapRoute(
      buildMapReader(registry, files, locator, parts),
      new ConfigHistorian({ store: parts.store, clock: parts.clock, logger: parts.logger }),
    ),
    // P3-T5. One project per request, unlike its three neighbours — see the route's header.
    new ObservedRoute(buildObservedSource(registry, files, parts)),
    new PresetsRoute(presets),
    new SavePresetRoute(presets),
    new ForgetPresetRoute(presets),
  ];
}

/**
 * What Claude actually did in one folder — P3-T5.
 *
 * The registry is what turns a path into a project, and it is the SAME registry the import route
 * wrote to: a path nobody imported has no record here and the route answers 404 without reading
 * anything. `registry.policy()` is passed rather than a policy built here for the same reason —
 * "which folders may be read" is not a question two objects may answer differently.
 */
function buildObservedSource(
  registry: ProjectRegistry,
  files: FsProjectFiles,
  parts: ProjectParts,
): ObservedSource {
  const reader = new ObservedReader({
    files,
    transcripts: new FsTranscriptFile(),
    policy: registry.policy(),
    configDirs: {
      '365': parts.install.configDirFor('365'),
      isg: parts.install.configDirFor('isg'),
    },
    clock: parts.clock,
    logger: parts.logger,
  });
  return {
    find: (path) => registry.list().find((record) => projectKey(record.path) === projectKey(path)),
    read: (project) => reader.read(project),
  };
}

/**
 * Stack and git for every imported folder (P3-T2).
 *
 * The one `ProjectFiles` is shared by the locator, the two readers and P3-T3's three, which is not
 * an optimisation — it is a stateless adapter over `node:fs`, and a second would only be a second
 * thing to keep in step if it ever grows a cache. It is constructed by the caller for that reason:
 * both readers want the same one.
 */
function buildStatusReader(
  registry: ProjectRegistry,
  files: FsProjectFiles,
  locator: GitDirectoryLocator,
  parts: ProjectParts,
): ProjectStatusReader {
  return new ProjectStatusReader({
    registry,
    git: new ProjectGitReader({
      paths: registry,
      locator,
      files,
      runner: parts.runner,
      clock: parts.clock,
      logger: parts.logger,
    }),
    files,
    clock: parts.clock,
    logger: parts.logger,
  });
}

/**
 * The workflow map for every imported folder (P3-T3, SPEC §5.1(a)).
 *
 * Built on the same registry as everything else here, which is this file's standing rule: the map
 * reads more of a project than anything before it — agents, commands, skills, hooks, MCP,
 * permissions and six convention folders — and every one of those paths goes through
 * `registry.resolve`. A second registry would be a second answer to "which folders may be read".
 *
 * The config directories arrive as data for the instruction stack, and only for it: SPEC §5.1's
 * first row includes the user `CLAUDE.md` of both configs, which is the one thing in the map that
 * is not under the project. `ReadPolicy` allowlists that file by name and nothing else about a
 * config directory changed (DECISIONS.md D38).
 */
function buildMapReader(
  registry: ProjectRegistry,
  files: FsProjectFiles,
  locator: GitDirectoryLocator,
  parts: ProjectParts,
): WorkflowMapReader {
  return new WorkflowMapReader({
    registry,
    paths: registry,
    instructions: new InstructionStackReader({
      paths: registry,
      files,
      configDirs: {
        '365': parts.install.configDirFor('365'),
        isg: parts.install.configDirFor('isg'),
      },
    }),
    assets: new ClaudeAssetReader({ paths: registry, files }),
    // Both doors of the same registry: `resolve` for a tree inside a project, `resolveRoot` for
    // one that IS a project — which a main checkout usually is (P3-T4, G.28).
    worktrees: new WorktreeReader({
      paths: registry,
      roots: registry,
      locator,
      files,
      logger: parts.logger,
    }),
    files,
    clock: parts.clock,
    logger: parts.logger,
  });
}
