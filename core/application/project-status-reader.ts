// What every imported folder looks like right now — P3-T2, SPEC §5.1.
//
// `ProjectRegistry`'s reader, and the first thing in core that opens anything INSIDE a project.
// The registry decides where core may look; this is the first class that looks. Everything it
// touches goes through `ProjectRegistry.resolve`, which canonicalises with `realpath` and then
// screens — that order, and only that order, catches a junction out of a root (SEC-FS-1).
//
// **Two readings with two lifetimes, which is the point of the cache.** Git moves when somebody
// commits, so it is signed by `.git`'s mtimes and expires in four seconds. The stack is five
// filenames in a directory listing and moves when somebody adds a `Dockerfile`, so it has no
// cheap signature worth taking and expires in five minutes — `statusline.py` caches its node
// version exactly that way, with `sig` pinned to `-` and a 300 s TTL.
//
// **Nothing here is written to the store.** Git state is "now" and the store holds what happened
// (`core/ports/store.ts`). The one project row that IS in the store is a standing permission, and
// P3-T1 argued that exception; this task does not get to widen it.
import {
  detectStack,
  type ProjectStatus,
  type StackLabel,
} from '../../contracts/project-status.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { ProjectFiles } from '../ports/project-files.ts';
import type { ProjectGitReader } from './project-git-reader.ts';
import type { Result } from '../shared/result.ts';
import { SignatureCache } from './signature-cache.ts';

/** `statusline.py`'s config TTL. A stack marker appearing is a thing that happens once a year. */
const STACK_TTL_MS = 300_000;

/** There is no cheap observation that proves a directory listing has not changed. See the header. */
const NO_SIGNATURE = '-';

/**
 * How much of a project root is listed.
 *
 * The caller is looking for five filenames at the top level. A repository with more entries than
 * this in its root has something unusual in it, and reading all of them to find `package.json`
 * would make the slowest part of this feature the part that answers "is this a Node project".
 */
const MAX_ROOT_ENTRIES = 2000;

/** What this needs from the registry: the list it reports on, and the door onto each root. */
export interface ProjectSource {
  list(): readonly ProjectRecord[];

  /**
   * Canonicalises a project root and checks it is still one, for LISTING it.
   *
   * Not `resolve`, which answers whether a FILE may be opened and refuses a directory outright —
   * the distinction this reader was shipped without and that only running it exposed
   * (`ProjectRegistry.resolveRoot`).
   */
  resolveRoot(path: string): Promise<Result<string, string>>;
}

export interface ProjectStatusParts {
  readonly registry: ProjectSource;
  readonly git: ProjectGitReader;
  readonly files: ProjectFiles;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class ProjectStatusReader {
  private readonly parts: ProjectStatusParts;
  private readonly stacks: SignatureCache<readonly StackLabel[]>;

  constructor(parts: ProjectStatusParts) {
    this.parts = parts;
    this.stacks = new SignatureCache(parts.clock);
  }

  /**
   * One reading per imported project, in the registry's own order.
   *
   * In parallel, because each one may spawn a `git` and they are independent — four projects
   * serialised would be four process spawns end to end for one panel. Nothing here fails: a
   * project on an unplugged drive comes back with an empty stack and no git, which is what a panel
   * should say about it.
   */
  public async readAll(): Promise<readonly ProjectStatus[]> {
    const projects = this.parts.registry.list();
    // Before the reads, so a folder forgotten a moment ago cannot be answered from a cache that
    // was filled while it was still imported (SEC-FS-1).
    this.evict(projects);
    return Promise.all(projects.map((project) => this.read(project)));
  }

  /** One project. Its two halves have independent lifetimes and are fetched independently. */
  private async read(project: ProjectRecord): Promise<ProjectStatus> {
    const [stack, git] = await Promise.all([
      this.stack(project.path),
      this.parts.git.read(project.path),
    ]);
    return { path: project.path, at: this.parts.clock.now().getTime(), stack, git };
  }

  /** The five markers, from one directory listing, held for five minutes. */
  private async stack(projectPath: string): Promise<readonly StackLabel[]> {
    return this.stacks.value(projectKey(projectPath), NO_SIGNATURE, STACK_TTL_MS, async () => {
      const resolved = await this.parts.registry.resolveRoot(projectPath);
      if (!resolved.ok) {
        // A root that was imported and can no longer be resolved — unplugged, renamed, or a
        // junction that now points somewhere it may not. Worth a line, because the registry still
        // holds it and nothing else would ever say so.
        this.parts.logger.warn('project_root_unreadable', { refusal: resolved.error });
        return [];
      }
      return detectStack(await this.parts.files.list(resolved.value, MAX_ROOT_ENTRIES));
    });
  }

  private evict(projects: readonly ProjectRecord[]): void {
    const paths = projects.map((project) => project.path);
    this.stacks.keep(paths.map(projectKey));
    this.parts.git.keep(paths);
  }
}
