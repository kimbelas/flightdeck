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
import type { Store } from '../../core/ports/store.ts';

export class FakeStore implements Store {
  private readonly events: FdEvent[] = [];
  private readonly audit: AuditRow[] = [];
  private nextEventId = 1;
  private nextAuditId = 1;
  private writable = true;

  /** Everything appended, for a test that wants to read the whole log rather than page it. */
  public get allEvents(): readonly FdEvent[] {
    return this.events;
  }

  public get allAudit(): readonly AuditRow[] {
    return this.audit;
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
}
