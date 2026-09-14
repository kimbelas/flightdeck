// SEC-PROC-3's row, and what happens when it cannot be written — P1-T8.
import { describe, expect, it } from 'vitest';
import { AuditLog, CORE_TOKEN_ACTOR } from '../../../core/application/audit-log.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

function build(): { audit: AuditLog; store: FakeStore; clock: FakeClock; logger: FakeLogger } {
  const store = new FakeStore();
  const clock = new FakeClock();
  const logger = new FakeLogger();
  return { audit: new AuditLog(store, clock, logger), store, clock, logger };
}

const entry = { action: 'launch', target: 'a-session', args: ['--bg'], outcome: 'ok' } as const;

describe('AuditLog', () => {
  it('writes a row stamped from the clock, not from Date.now', () => {
    const { audit, store, clock } = build();
    clock.advance(5000);

    audit.record(entry);

    expect(store.allAudit[0]?.at).toBe(clock.now().getTime());
  });

  it('names the one credential there is', () => {
    const { audit, store } = build();

    audit.record(entry);

    // One token today (SEC-HTTP-3), so anything else would be inventing precision — but the field
    // exists so a second credential is not a schema migration.
    expect(store.allAudit[0]?.who).toBe(CORE_TOKEN_ACTOR);
  });

  it('keeps the outcome and the reason as given', () => {
    const { audit, store } = build();

    audit.record({ ...entry, outcome: 'refused', reason: 'claude.exe not found' });

    expect(store.allAudit[0]?.outcome).toBe('refused');
    expect(store.allAudit[0]?.reason).toBe('claude.exe not found');
  });

  it('leaves an absent reason absent rather than writing an empty string', () => {
    const { audit, store } = build();

    audit.record(entry);

    expect(store.allAudit[0]?.reason).toBeUndefined();
  });

  it('never throws when the store does, because the action is already happening', () => {
    const { audit, store, logger } = build();
    store.breakWrites();

    expect(() => {
      audit.record(entry);
    }).not.toThrow();

    // Refusing to launch the owner's session because a row could not be written would be a worse
    // failure than the missing row — this is a local single-user tool, not a shared audit boundary.
    expect(audit.dropped).toBe(1);
    expect(audit.written).toBe(0);
    expect(logger.at('error')).toHaveLength(1);
  });

  it('counts what it wrote, so a hole in the trail is visible', () => {
    const { audit, store } = build();
    audit.record(entry);
    audit.record(entry);
    store.breakWrites();
    audit.record(entry);

    expect(audit.written).toBe(2);
    expect(audit.dropped).toBe(1);
  });
});
