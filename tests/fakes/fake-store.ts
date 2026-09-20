// In-memory Store — CODING-STANDARDS §10.1.
//
// A real implementation of the port, not a stub: the id contract (monotonic, gapless, shared by
// nothing) is the part callers depend on and therefore the part a fake has to honour. A fake that
// handed out `0` for everything would let a broken `since=` pager pass.
//
// The sqlite adapter replaces this in core; nothing above the port can tell them apart, which is
// the test that the port is the right shape.
import type { AuditOutcome, AuditRow, DraftAuditRow } from '../../contracts/audit-row.ts';
import type { DraftEvent, FdEvent } from '../../contracts/fd-event.ts';
import { byProjectThenName, type LaunchPreset } from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import type { DraftVitalsSnapshot, VitalsSnapshot } from '../../contracts/vitals-snapshot.ts';
import type { Store } from '../../core/ports/store.ts';

export class FakeStore implements Store {
  private readonly events: FdEvent[] = [];
  private readonly audit: AuditRow[] = [];
  private readonly snapshots: VitalsSnapshot[] = [];
  /** Keyed by `projectKey`, exactly as the sqlite table is — re-import is a replace, not a row. */
  private readonly imported = new Map<string, ProjectRecord>();
  /** Keyed `<projectKey>|<id>` with a separator neither half can contain. */
  private readonly presets = new Map<string, LaunchPreset>();
  private nextEventId = 1;
  private nextAuditId = 1;
  private nextSnapshotId = 1;
  private writable = true;

  /** Everything appended, for a test that wants to read the whole log rather than page it. */
  public get allEvents(): readonly FdEvent[] {
    return this.events;
  }

  public get allAudit(): readonly AuditRow[] {
    return this.audit;
  }

  public get allSnapshots(): readonly VitalsSnapshot[] {
    return this.snapshots;
  }

  /** Makes every subsequent append throw, as a full disk or a revoked ACL would. */
  public breakWrites(): void {
    this.writable = false;
  }

  /** Every audit row whose outcome was not `ok` — the rows a reviewer actually looks for. */
  public auditFailures(): readonly AuditRow[] {
    const failed: readonly AuditOutcome[] = ['refused', 'failed'];
    return this.audit.filter((row) => failed.includes(row.outcome));
  }

  public appendEvent(event: DraftEvent): FdEvent {
    if (!this.writable) throw new Error('store is not writable');
    const stored: FdEvent = { ...event, id: this.nextEventId };
    this.nextEventId += 1;
    this.events.push(stored);
    return stored;
  }

  public eventsSince(since: number, limit: number): readonly FdEvent[] {
    return this.events.filter((event) => event.id > since).slice(0, Math.max(limit, 0));
  }

  public eventsForSession(sessionId: string, since: number, limit: number): readonly FdEvent[] {
    return this.events
      .filter((event) => event.sessionId === sessionId && event.id > since)
      .slice(0, Math.max(limit, 0));
  }

  public appendAudit(row: DraftAuditRow): AuditRow {
    if (!this.writable) throw new Error('store is not writable');
    const stored: AuditRow = { ...row, id: this.nextAuditId };
    this.nextAuditId += 1;
    this.audit.push(stored);
    return stored;
  }

  public auditSince(since: number, limit: number): readonly AuditRow[] {
    return this.audit.filter((row) => row.id > since).slice(0, Math.max(limit, 0));
  }

  public appendSnapshot(snapshot: DraftVitalsSnapshot): VitalsSnapshot {
    if (!this.writable) throw new Error('store is not writable');
    const stored: VitalsSnapshot = { ...snapshot, id: this.nextSnapshotId };
    this.nextSnapshotId += 1;
    this.snapshots.push(stored);
    return stored;
  }

  /** The most recent `limit`, handed back oldest first — the port's ordering, honoured here too. */
  public snapshotsForSession(sessionId: string, limit: number): readonly VitalsSnapshot[] {
    const mine = this.snapshots.filter((row) => row.sessionId === sessionId);
    return mine.slice(Math.max(mine.length - Math.max(limit, 0), 0));
  }

  /** `importedAt` survives a re-import, as the adapter's `ON CONFLICT DO UPDATE` leaves it alone. */
  public rememberProject(project: ProjectRecord): ProjectRecord {
    if (!this.writable) throw new Error('store is not writable');
    const key = projectKey(project.path);
    const held = this.imported.get(key);
    const stored: ProjectRecord = {
      ...project,
      importedAt: held?.importedAt ?? project.importedAt,
    };
    this.imported.set(key, stored);
    return stored;
  }

  /** Newest first, then by key — the adapter's `ORDER BY imported_at DESC, path_key`. */
  public projects(): readonly ProjectRecord[] {
    return [...this.imported.entries()]
      .sort(([leftKey, left], [rightKey, right]) =>
        left.importedAt === right.importedAt
          ? leftKey.localeCompare(rightKey)
          : right.importedAt - left.importedAt,
      )
      .map(([, project]) => project);
  }

  /** The presets go with it, exactly as the adapter's second DELETE does (the port's cascade). */
  public forgetProject(path: string): boolean {
    if (!this.writable) throw new Error('store is not writable');
    const key = projectKey(path);
    for (const [held, preset] of this.presets) {
      if (preset.projectKey === key) this.presets.delete(held);
    }
    return this.imported.delete(key);
  }

  /** `builtIn` is forced false on the way in: a stored preset is one the owner saved (`toPreset`). */
  public savePreset(preset: LaunchPreset): LaunchPreset {
    if (!this.writable) throw new Error('store is not writable');
    const stored: LaunchPreset = { ...preset, builtIn: false };
    this.presets.set(presetSlot(preset.projectKey, preset.id), stored);
    return stored;
  }

  /** The adapter's `ORDER BY project_key, name, id`, which is `byProjectThenName`. */
  public savedPresets(): readonly LaunchPreset[] {
    return [...this.presets.values()].sort(byProjectThenName);
  }

  public forgetPreset(projectKeyValue: string, id: string): boolean {
    if (!this.writable) throw new Error('store is not writable');
    return this.presets.delete(presetSlot(projectKeyValue, id));
  }
}

/** The composite key as one string. `|` is illegal in a Windows path and `presetId` folds it. */
function presetSlot(projectKeyValue: string, id: string): string {
  return `${projectKeyValue}|${id}`;
}
