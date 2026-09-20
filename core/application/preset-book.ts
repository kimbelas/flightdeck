// The presets a project has, and the two ways that list changes — P4-T1.
//
// **Two sources, one list, and the merge rule is the whole class.** `PresetCatalogue` computes the
// four built-ins for every imported folder; the store holds the ones the owner saved. A saved
// preset SHADOWS the built-in with the same id rather than sitting beside it, which is what makes
// "I want `ticket` to start in my worktree" one save instead of a second button called
// `ticket (mine)`. The id is derived from the name (`presetId`), so shadowing is something the
// owner does by naming, not a mode they have to find.
//
// **A saved preset is a standing permission's neighbour, not a permission.** It names a folder to
// start a session in, and that folder is screened here on the way IN — `resolveRoot` for the
// project it is filed under and `resolveDirectory` for the cwd — and again by containment between
// the two. Saving cannot widen what core may read; it can only point at somewhere already inside
// an imported project. Presets for a forgotten project are dropped by the store's cascade and by
// `list` refusing to answer for a project that is not imported, which is belt and braces on
// purpose: one of them is a delete that must happen and the other is a read that must not trust it.
//
// **Nothing here writes a prompt to the audit log.** The row records the action, the preset and
// the profile function — the facts a reviewer needs — and never the owner's own words
// (SEC-DATA-2), which is the same line `SessionLauncher` draws through its argv.
import {
  byProjectThenName,
  MAX_PRESETS_PER_PROJECT,
  presetId,
  type LaunchPreset,
  type PresetDraft,
  type PresetRef,
  type PresetRefusal,
} from '../../contracts/launch-preset.ts';
import { projectKey } from '../../contracts/project.ts';
import { isUnder } from '../../contracts/windows-path.ts';
import { PresetCatalogue } from '../domain/preset-catalogue.ts';
import type { Logger } from '../ports/logger.ts';
import type { Store } from '../ports/store.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { AuditLog } from './audit-log.ts';
import type { ProjectRegistry } from './project-registry.ts';

export interface PresetBookParts {
  readonly registry: ProjectRegistry;
  readonly store: Store;
  readonly audit: AuditLog;
  readonly logger: Logger;
}

export class PresetBook {
  private readonly parts: PresetBookParts;
  private readonly catalogue = new PresetCatalogue();

  /**
   * `PresetCatalogue` is constructed here rather than injected, for `ProjectImport`'s reason: it is
   * an immutable value object over a constant table, so two of them cannot disagree and a seam
   * between them would be a seam with nothing on the other side.
   */
  constructor(parts: PresetBookParts) {
    this.parts = parts;
  }

  /**
   * Every preset the deck may draw, built-ins and saved together, in one stable order.
   *
   * Computed per call rather than held: the built-ins depend on the imported list, which the import
   * and forget routes move, and a cached merge would be a second opinion about which folders exist.
   * The whole list is four presets per project plus whatever was saved — there is nothing here to
   * make cheap.
   */
  public list(): readonly LaunchPreset[] {
    const projects = this.parts.registry.list();
    const imported = new Set(projects.map((project) => projectKey(project.path)));
    const merged = new Map<string, LaunchPreset>();
    for (const project of projects) {
      for (const preset of this.catalogue.builtInsFor(project)) merged.set(slot(preset), preset);
    }
    for (const saved of this.parts.store.savedPresets()) {
      // A saved preset whose project is gone is dropped rather than drawn — see the header on why
      // this is checked as well as cascaded.
      if (imported.has(saved.projectKey)) merged.set(slot(saved), saved);
    }
    return [...merged.values()].sort(byProjectThenName);
  }

  /**
   * Saves one preset, or says why not.
   *
   * The order of the checks is the order of their cost: the name is a string test, the project is
   * one `realpath`, and the cwd is a second one. A draft nobody should act on never becomes a
   * syscall, which is `ProjectRegistry.import`'s rule applied here.
   *
   * An empty `cwd` means the project root, which is what makes the common preset two fields — a
   * name and a prompt — rather than four. A cwd that is given is screened twice: it must be a
   * directory inside SOME imported project (`resolveDirectory`), and it must be inside THIS one.
   * The second check is not redundant — without it a preset filed under `app-core` could start a
   * session in `pdf-editor`, and the button would say the wrong thing about where it goes.
   */
  public async save(draft: PresetDraft): Promise<Result<LaunchPreset, PresetRefusal>> {
    const id = presetId(draft.name);
    if (id === '') return this.refuse(draft.projectPath, id, 'bad_name');

    const root = await this.parts.registry.resolveRoot(draft.projectPath);
    if (!root.ok) return this.refuse(draft.projectPath, id, 'unknown_project');
    const key = projectKey(root.value);

    const cwd = await this.resolveCwd(draft.cwd, root.value);
    if (cwd === undefined) return this.refuse(root.value, id, 'bad_cwd');

    if (this.isFull(key, id)) return this.refuse(root.value, id, 'too_many');

    const stored = this.parts.store.savePreset({
      projectKey: key,
      id,
      name: draft.name,
      profileFn: draft.profileFn,
      cwd,
      sessionName: draft.sessionName,
      promptSource: draft.promptSource,
      prompt: draft.prompt,
      group: draft.group,
      builtIn: false,
    });
    this.parts.audit.record({
      action: 'preset.save',
      target: target(root.value, id),
      // The profile function, never the prompt or the name — see the header (SEC-DATA-2).
      args: [draft.profileFn],
      outcome: 'ok',
    });
    return ok(stored);
  }

  /**
   * Removes one saved preset. A built-in has no row and answers `false`.
   *
   * Not `async` and not screened against the registry: this only ever DELETES, so the worst a bad
   * path can do is fail to match. That is the same direction-of-risk argument `ProjectsPanel`
   * makes about withdrawing a folder without a confirmation — the act narrows rather than widens.
   */
  public forget(ref: PresetRef): boolean {
    const key = projectKey(ref.projectPath);
    const removed = this.parts.store.forgetPreset(key, ref.id);
    const entry = { action: 'preset.forget', target: target(ref.projectPath, ref.id), args: [] };
    // Two shapes rather than one with `reason: undefined` — `exactOptionalPropertyTypes` is on.
    this.parts.audit.record(
      removed
        ? { ...entry, outcome: 'ok' }
        : { ...entry, outcome: 'failed', reason: 'no saved preset' },
    );
    return removed;
  }

  /** The root itself when none was given; otherwise a directory inside this project, or nothing. */
  private async resolveCwd(requested: string, root: string): Promise<string | undefined> {
    if (requested === '') return root;
    const resolved = await this.parts.registry.resolveDirectory(requested);
    if (!resolved.ok) return undefined;
    return isUnder(projectKey(resolved.value), projectKey(root)) ? resolved.value : undefined;
  }

  /** The cap counts the project's SAVED presets, and never the built-ins — they are computed. */
  private isFull(key: string, id: string): boolean {
    const mine = this.parts.store
      .savedPresets()
      .filter((preset) => preset.projectKey === key && preset.id !== id);
    return mine.length >= MAX_PRESETS_PER_PROJECT;
  }

  private refuse(
    path: string,
    id: string,
    refusal: PresetRefusal,
  ): Result<LaunchPreset, PresetRefusal> {
    this.parts.logger.warn('preset_refused', { refusal });
    this.parts.audit.record({
      action: 'preset.save',
      target: target(path, id),
      args: [],
      outcome: 'refused',
      reason: refusal,
    });
    return err(refusal);
  }
}

/** The merge key — the same pair the sqlite table uses as its primary key. */
function slot(preset: LaunchPreset): string {
  return `${preset.projectKey}|${preset.id}`;
}

/**
 * What an audit row points at: the folder, then the preset within it.
 *
 * Capped for `ProjectRegistry.refuse`'s reason — a refused request may have been enormous, and a
 * row that recorded the whole of it would put a control body's worth of text in a table kept
 * forever.
 */
function target(path: string, id: string): string {
  return `${path.slice(0, 1024)}#${id}`;
}
