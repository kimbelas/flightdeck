// In-memory Store — CODING-STANDARDS §10.1.
//
// A real implementation of the port, not a stub: the id contract (monotonic, gapless, shared by
// nothing) is the part callers depend on and therefore the part a fake has to honour. A fake that
// handed out `0` for everything would let a broken `since=` pager pass.
//
// The sqlite adapter replaces this in core; nothing above the port can tell them apart, which is
// the test that the port is the right shape.
import type { AuditOutcome, AuditRow, DraftAuditRow } from '../../contracts/audit-row.ts';
import { MAX_CONFIG_SNAPSHOTS } from '../../contracts/config-snapshot.ts';
import type { DraftEvent, FdEvent } from '../../contracts/fd-event.ts';
import { byProjectThenName, type LaunchPreset } from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { SearchHit } from '../../contracts/transcript-search.ts';
import type { TranscriptCursor } from '../../core/ports/transcript-file.ts';
import type { DraftVitalsSnapshot, VitalsSnapshot } from '../../contracts/vitals-snapshot.ts';
import {
  MAX_SESSION_MUTES,
  type ConfigSnapshot,
  type DraftConfigSnapshot,
  type MutedSession,
  type TranscriptIndexBatch,
  type Store,
} from '../../core/ports/store.ts';

export class FakeStore implements Store {
  /**
   * The search index, in memory — P7-T1.
   *
   * Substring matching rather than a tokenizer, and that is the fake's honest limit: FTS5's
   * grammar, its ranking and its snippet windows belong to SQLite and are tested against the real
   * adapter (`sqlite-store-search.test.ts`). What every caller of this fake actually asks is
   * "did the indexer store what it read, and did it store it once" — which needs a list, not a
   * search engine. `searchTranscripts` here is enough to prove a route passes its query down.
   */
  public readonly indexed: TranscriptIndexBatch[] = [];
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
  /** Newest LAST, which is insertion order — the reads below reverse it, as the adapter does. */
  private readonly configHistory: ConfigSnapshot[] = [];
  /** Keyed `<subscription>|<sessionId>`, exactly as the sqlite table's composite key is. */
  private readonly mutes = new Map<string, MutedSession>();
  /** P7-T1. Keyed by transcript path, which is what the cursor is keyed by in the real store. */
  private readonly cursors = new Map<string, TranscriptCursor>();
  private readonly excerpts = new Map<string, TranscriptIndexBatch>();
  private nextConfigId = 1;
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

  /** Appends and prunes together, because the adapter's `rememberConfigSnapshot` does. */
  public rememberConfigSnapshot(snapshot: DraftConfigSnapshot): ConfigSnapshot {
    if (!this.writable) throw new Error('store is not writable');
    const stored: ConfigSnapshot = { ...snapshot, id: this.nextConfigId };
    this.nextConfigId += 1;
    this.configHistory.push(stored);
    const mine = this.configHistory.filter((one) => one.projectKey === snapshot.projectKey);
    for (const stale of mine.slice(0, Math.max(0, mine.length - MAX_CONFIG_SNAPSHOTS))) {
      this.configHistory.splice(this.configHistory.indexOf(stale), 1);
    }
    return stored;
  }

  /** Newest first, by id — the adapter orders by id for the reason its statements give. */
  public configSnapshots(projectKeyValue: string, limit: number): readonly ConfigSnapshot[] {
    return this.configHistory
      .filter((one) => one.projectKey === projectKeyValue)
      .sort((left, right) => right.id - left.id)
      .slice(0, Math.max(0, limit));
  }

  /** Written and pruned together, because the adapter's `muteSession` is. */
  public muteSession(subscription: SubscriptionId, sessionId: string, at: number): void {
    if (!this.writable) throw new Error('store is not writable');
    this.mutes.set(muteSlot(subscription, sessionId), { subscription, sessionId, mutedAt: at });
    for (const stale of this.mutedSessions().slice(MAX_SESSION_MUTES)) {
      this.mutes.delete(muteSlot(stale.subscription, stale.sessionId));
    }
  }

  public unmuteSession(subscription: SubscriptionId, sessionId: string): boolean {
    if (!this.writable) throw new Error('store is not writable');
    return this.mutes.delete(muteSlot(subscription, sessionId));
  }

  /** Newest mute first, then by key — the adapter's `ORDER BY muted_at DESC, subscription, id`. */
  public mutedSessions(): readonly MutedSession[] {
    return [...this.mutes.values()].sort(
      (left, right) =>
        right.mutedAt - left.mutedAt ||
        muteSlot(left.subscription, left.sessionId).localeCompare(
          muteSlot(right.subscription, right.sessionId),
        ),
    );
  }

  public transcriptCursor(path: string): TranscriptCursor | undefined {
    return this.cursors.get(path);
  }

  public indexTranscript(batch: TranscriptIndexBatch): void {
    if (!this.writable) throw new Error('store is not writable');
    if (batch.restarted) {
      for (const [path, held] of this.excerpts) {
        if (held.subscription === batch.subscription && held.sessionId === batch.sessionId) {
          this.excerpts.delete(path);
        }
      }
    }
    this.indexed.push(batch);
    this.excerpts.set(batch.path, batch);
    this.cursors.set(batch.path, batch.cursor);
  }

  public searchTranscripts(match: string, limit: number): readonly SearchHit[] {
    const needle = match.replaceAll(/["*]/gu, '').toLowerCase();
    const hits: SearchHit[] = [];
    for (const batch of this.excerpts.values()) {
      const found = batch.excerpts.find((prose) => prose.text.toLowerCase().includes(needle));
      if (found === undefined) continue;
      hits.push({
        subscription: batch.subscription,
        sessionId: batch.sessionId,
        projectKey: batch.projectKey,
        kind: found.kind,
        at: found.at ?? 0,
        snippet: found.text,
      });
    }
    return hits.slice(0, limit);
  }
}

/** The composite key as one string. `|` is in neither a subscription id nor a uuid. */
function muteSlot(subscription: SubscriptionId, sessionId: string): string {
  return `${subscription}|${sessionId}`;
}

/** The composite key as one string. `|` is illegal in a Windows path and `presetId` folds it. */
function presetSlot(projectKeyValue: string, id: string): string {
  return `${projectKeyValue}|${id}`;
}
