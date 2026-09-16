// Which folders core may look at, and how one joins that list — P3-T1, SEC-FS-1, DECISIONS.md D26.
//
// **It ships empty and it stays empty until the owner imports something.** Nothing here scans, no
// constructor walks `~/Documents`, and there is no list of projects compiled into the build. The
// four repositories named on the roadmap task are acceptance targets for the P3 gate, imported by
// hand to exercise it — a shipped list would be the bug the task exists to avoid. What that buys
// is the only thing that makes SEC-FS-1's allowlist readable: it grows by one deliberate act at a
// time, and each act is an audit row.
//
// **Three collaborators, three layers, on purpose.** `ProjectImport` is domain and decides whether
// a folder MAY be a root, on strings alone. `PathCanonicaliser` is an adapter and is the only
// thing here that touches a filesystem. `ReadPolicy` is domain and decides what may be opened once
// a root exists. This class is the composition, and is where SEC-FS-1's four checks finally meet:
// canonicalise, must be a directory, no `..`, and — in `resolve` — no junction out of the root.
//
// **`resolve` is the whole point of the fourth check and is the method P3-T3 will use.** A path
// under a project can be a junction to somewhere else entirely; on Windows that is not a symlink
// and `ReadPolicy` is pure string work, so no string rule can see it. Resolving first and then
// screening the resolved path is the only order that catches it, and it is measured against a real
// `mklink /J` in `tests/win/project-junction.test.ts`.
//
// **The roots are held in memory as well as in the store.** Not a cache for speed — `ReadPolicy`
// is rebuilt from them and has to exist before anything under a root is opened, so the list is
// loaded once at construction rather than re-read per screen. The store remains the truth: every
// import and every forget writes through to it and then re-reads.
import {
  MAX_PROJECT_PATH_CHARS,
  projectKey,
  projectName,
  type ImportRefusal,
  type ProjectRecord,
} from '../../contracts/project.ts';
import { ProjectImport } from '../domain/project-import.ts';
import { ReadPolicy } from '../domain/read-policy.ts';
import type { Clock } from '../ports/clock.ts';
import type { Logger } from '../ports/logger.ts';
import type { PathCanonicaliser } from '../ports/path-canonicaliser.ts';
import type { Store } from '../ports/store.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';

export interface ProjectRegistryParts {
  readonly store: Store;
  readonly paths: PathCanonicaliser;
  /** Both config directories, from `ClaudeInstall.configDirFor`. Data, not the adapter. */
  readonly configDirs: readonly string[];
  readonly audit: AuditLog;
  readonly clock: Clock;
  readonly logger: Logger;
}

export class ProjectRegistry {
  private readonly parts: ProjectRegistryParts;
  private readonly rules: ProjectImport;
  private held: readonly ProjectRecord[];

  /**
   * Loads what was imported before this boot.
   *
   * In the constructor rather than lazily, because the roots are a security input: a reader that
   * asked before the first load would be told a project it can see is outside every root, and the
   * fix for that would be a cache-warming call every caller has to remember. `ProjectImport` is
   * constructed here rather than injected — it is an immutable value object over two directory
   * names, so two of them cannot disagree (the reasoning `reads.ts` gives for `ReadPolicy`).
   */
  constructor(parts: ProjectRegistryParts) {
    this.parts = parts;
    this.rules = new ProjectImport(parts.configDirs);
    this.held = parts.store.projects();
  }

  /** Every imported project, newest first. Empty on a machine that has imported none. */
  public list(): readonly ProjectRecord[] {
    return this.held;
  }

  /**
   * Imports one folder, by path — the owner's deliberate act, and the only way a root appears.
   *
   * Idempotent: importing a folder already held returns the record that is already there, with the
   * `importedAt` it already had. "When did I add this" is a fact about the decision, and a second
   * click on the same folder is not a second decision.
   *
   * @param raw what the owner typed. Screened as a string, then resolved, then screened again —
   * `refuseRequested` before a syscall so a request nobody should act on never becomes one.
   * @returns the stored record, or why it was refused. A `Result` rather than a throw: every one of
   * these is an ordinary answer to an ordinary request (CODING-STANDARDS §6).
   */
  public async import(raw: string): Promise<Result<ProjectRecord, ImportRefusal>> {
    const requested = this.rules.refuseRequested(raw);
    if (requested !== undefined) return this.refuse(raw, requested);

    const canonical = await this.parts.paths.canonicalise(raw.trim());
    if (canonical === undefined) return this.refuse(raw, 'missing');
    const refusal = this.rules.refuseCanonical(canonical.path, canonical.isDirectory);
    if (refusal !== undefined) return this.refuse(canonical.path, refusal);

    const stored = this.parts.store.rememberProject({
      path: canonical.path,
      name: projectName(canonical.path),
      importedAt: this.parts.clock.now().getTime(),
    });
    this.held = this.parts.store.projects();
    this.parts.audit.record({
      action: 'project.import',
      target: stored.path,
      args: [],
      outcome: 'ok',
    });
    return ok(stored);
  }

  /**
   * Withdraws one project, by path.
   *
   * The half of an allowlist that is easy to leave out and should not be: a folder imported by a
   * typo would otherwise be readable for ever, and a control nobody can undo is one nobody trusts
   * enough to use. Reversibility is Disconnect's argument (SEC-OPS-2) applied to SEC-FS-1.
   *
   * @returns whether a project was removed. Forgetting one that is not there is not a failure —
   * the end state is the one that was asked for — but it is a different audit row.
   */
  public forget(path: string): boolean {
    const removed = this.parts.store.forgetProject(path);
    this.held = this.parts.store.projects();
    // Two shapes rather than one with `reason: undefined`, because `exactOptionalPropertyTypes` is
    // on and an absent reason and an undefined one are different values to this compiler.
    const entry = { action: 'project.forget', target: path.slice(0, MAX_PROJECT_PATH_CHARS) };
    this.parts.audit.record(
      removed
        ? { ...entry, args: [], outcome: 'ok' }
        : { ...entry, args: [], outcome: 'failed', reason: 'not imported' },
    );
    return removed;
  }

  /**
   * A path core has been asked to open, canonicalised and then screened — SEC-FS-1, all four.
   *
   * The one door for anything under a project root. It resolves BEFORE it screens, which is the
   * only order that catches a junction out of the root, and it screens the RESOLVED path, which is
   * the only string that can be compared against a root at all.
   *
   * @returns the path to open, or why it may not be. The refusal is `ReadPolicy`'s own sentence,
   * which is what the log line and `doctor` already print.
   */
  public async resolve(path: string): Promise<Result<string, string>> {
    const canonical = await this.parts.paths.canonicalise(path);
    if (canonical === undefined) return err('no such path');
    const refusal = this.policy().refusal(canonical.path);
    if (refusal === undefined) return ok(canonical.path);
    this.parts.logger.warn('project_path_refused', { refusal });
    return err(refusal);
  }

  /**
   * A project ROOT core has been asked to list — P3-T2.
   *
   * `resolve` cannot answer this and should not be made to. `ReadPolicy` decides whether core may
   * OPEN a path, and it refuses a root outright with "the project directory itself is not a file",
   * which is correct: listing a directory is a different question from reading a file, and a
   * policy that conflated them would have to allow `open()` on a folder to allow `readdir()` on
   * one. Found by running it — the unit suite and the deck smoke were both green while every
   * imported project reported an empty stack, because the fakes screened the root the way a
   * subdirectory is screened (RESEARCH.md G.26).
   *
   * The check is membership rather than containment, and that is the junction defence again: the
   * path is canonicalised FIRST, so a root replaced by a junction since it was imported resolves
   * to a folder that is not in the registry and is refused (SEC-FS-1). Nothing is trusted about
   * the stored string except that it was once canonical.
   *
   * @returns the directory to list, or why it may not be listed.
   */
  public async resolveRoot(path: string): Promise<Result<string, string>> {
    const canonical = await this.parts.paths.canonicalise(path);
    if (canonical === undefined) return err('no such path');
    if (!canonical.isDirectory) return err('not a directory');
    const key = projectKey(canonical.path);
    if (!this.held.some((project) => projectKey(project.path) === key)) {
      this.parts.logger.warn('project_root_refused', { refusal: 'not an imported project' });
      return err('not an imported project');
    }
    return ok(canonical.path);
  }

  /**
   * `ReadPolicy` widened by every imported root — the domain rule, with today's data in it.
   *
   * Rebuilt per call rather than held, because it is an immutable value object over a handful of
   * strings and a held one would be a second place the roots live. The domain never learns where
   * the strings came from, which is the split `ReadPolicy`'s header asks for.
   */
  public policy(): ReadPolicy {
    return new ReadPolicy(
      this.parts.configDirs,
      this.held.map((project) => project.path),
    );
  }

  /**
   * One refusal, audited and returned. Every refused import is a row, exactly as a taken one is.
   *
   * The target is capped, and that is not decoration: `too_long` is refused precisely because the
   * request was enormous, and a row that recorded the whole of it would let one bad request put
   * 64 KB — `limits.ts`'s control body cap — into the audit log.
   */
  private refuse(target: string, refusal: ImportRefusal): Result<ProjectRecord, ImportRefusal> {
    this.parts.audit.record({
      action: 'project.import',
      target: target.slice(0, MAX_PROJECT_PATH_CHARS),
      args: [],
      outcome: 'refused',
      reason: refusal,
    });
    return err(refusal);
  }
}
