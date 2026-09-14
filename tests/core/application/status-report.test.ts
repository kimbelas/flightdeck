// What `flightdeck-core status` is told, assembled from the real collaborators — P1-T12.
//
// Real `AuditLog`, `TranscriptReader` and `VitalsRegistry` against fakes rather than stubs of
// them, because the thing worth proving is that the counters the last five tasks left behind are
// wired to the right getters. A stub would agree with whatever this file claimed.
import { describe, expect, it } from 'vitest';
import type { RuntimeFacts } from '../../../contracts/core-status.ts';
import { NO_QUOTA, type StatuslineReport } from '../../../contracts/statusline-report.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { StatusReport } from '../../../core/application/status-report.ts';
import { TranscriptReader } from '../../../core/application/transcript-reader.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';
import { FakeStore } from '../../fakes/fake-store.ts';
import { FakeTranscriptFile } from '../../fakes/fake-transcript-file.ts';

const CFG = 'C:\\Users\\x\\.claude-365';
const SESSION = 'cb5e8102-f057-4d5c-ad98-eac21a12f37d';
const RUNTIME: RuntimeFacts = { pid: 4242, uptimeSeconds: 90, nodeVersion: '26.3.0' };

function report(overrides: Partial<StatuslineReport> = {}): StatuslineReport {
  return {
    sessionId: SESSION,
    transcriptPath: `${CFG}\\projects\\slug\\${SESSION}.jsonl`,
    sessionName: 'the-one',
    modelId: 'claude-opus-5',
    modelName: 'Opus 5',
    claudeVersion: '2.1.267',
    costUsd: 1.25,
    usedPercentage: 42,
    contextWindowSize: 200_000,
    fiveHour: { usedPercentage: 23, resetsAt: 1_789_080_600_000 },
    sevenDay: { usedPercentage: 7, resetsAt: 1_789_600_000_000 },
    ...overrides,
  };
}

interface Built {
  readonly status: StatusReport;
  readonly audit: AuditLog;
  readonly vitals: VitalsRegistry;
  readonly transcripts: TranscriptReader;
  readonly file: FakeTranscriptFile;
  readonly store: FakeStore;
}

function build(): Built {
  const store = new FakeStore();
  const logger = new FakeLogger();
  const file = new FakeTranscriptFile();
  const audit = new AuditLog(store, new FakeClock(1000), logger);
  const vitals = new VitalsRegistry();
  const transcripts = new TranscriptReader({
    file,
    policy: new ReadPolicy([CFG]),
    scheduler: new FakeScheduler(),
    logger,
  });
  const status = new StatusReport({
    version: '0.0.1',
    store: { path: 'C:\\data\\flightdeck.db', version: 2 },
    events: { stored: 17, snapshots: 3, dropped: 1 },
    audit,
    transcripts,
    vitals,
    tokenPath: 'C:\\data\\token',
    ingestKeyPath: 'C:\\data\\ingest-key',
    claudePath: 'C:\\bin\\claude.exe',
  });
  return { status, audit, vitals, transcripts, file, store };
}

describe('StatusReport', () => {
  it('carries the runtime facts it was handed, and does not invent them', () => {
    const { status } = build();

    expect(status.snapshot(RUNTIME).runtime).toEqual(RUNTIME);
  });

  it('names the three files an operator has to be able to find', () => {
    const snapshot = build().status.snapshot(RUNTIME);

    expect(snapshot.tokenPath).toBe('C:\\data\\token');
    expect(snapshot.ingestKeyPath).toBe('C:\\data\\ingest-key');
    expect(snapshot.store.path).toBe('C:\\data\\flightdeck.db');
    expect(snapshot.claudePath).toBe('C:\\bin\\claude.exe');
  });

  it('reports the schema version and the event counters the store side keeps', () => {
    const snapshot = build().status.snapshot(RUNTIME).store;

    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.stored).toBe(17);
    expect(snapshot.snapshots).toBe(3);
    // The number that matters: events lost to a failing store, which nothing else surfaces.
    expect(snapshot.dropped).toBe(1);
  });

  it('reports what the audit log has written and lost', () => {
    const { status, audit, store } = build();
    audit.record({ action: 'launch', target: 'isg', args: [], outcome: 'ok' });
    store.breakWrites();
    audit.record({ action: 'launch', target: 'isg', args: [], outcome: 'ok' });

    expect(status.snapshot(RUNTIME).audit).toEqual({ written: 1, dropped: 1 });
  });

  it('sums the transcript counters across sessions rather than listing them', async () => {
    const { status, transcripts, file } = build();
    const path = `${CFG}\\projects\\slug\\${SESSION}.jsonl`;
    file.append(path, '{"type":"user"}\n{"type":"invented-in-2.2"}\n');
    transcripts.publish({
      at: 1,
      sessionId: SESSION,
      subscription: '365',
      source: 'hook',
      type: 'Stop',
      payload: { transcript_path: path },
    });
    await transcripts.poll();

    const snapshot = status.snapshot(RUNTIME).transcripts;

    expect(snapshot.tracked).toBe(1);
    expect(snapshot.ignored).toBe(1);
    // Above zero means this build is behind Claude Code, whichever session saw it (SPEC §8 R2).
    expect(snapshot.unknown).toBe(1);
  });

  it('projects the vitals the table prints, and nothing that identifies a machine', () => {
    const { status, vitals } = build();
    vitals.record(report(), '365', 5000);

    const lines = status.snapshot(RUNTIME).vitals;

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      sessionId: SESSION,
      subscription: '365',
      at: 5000,
      sessionName: 'the-one',
      modelName: 'Opus 5',
      usedPercentage: 42,
      costUsd: 1.25,
      fiveHourPercentage: 23,
      sevenDayPercentage: 7,
    });
    // The transcript path is in the report and must not be in the projection (SEC-DATA-2).
    expect(JSON.stringify(lines)).not.toContain('projects');
  });

  it('keeps undefined as undefined for a session before its first turn', () => {
    const { status, vitals } = build();
    vitals.record(
      report({ usedPercentage: undefined, costUsd: undefined, fiveHour: NO_QUOTA }),
      'isg',
      5000,
    );

    const line = status.snapshot(RUNTIME).vitals[0];

    // `null is not zero` (RESEARCH.md F.3.5) has to survive one more hop to reach the screen.
    expect(line?.usedPercentage).toBeUndefined();
    expect(line?.costUsd).toBeUndefined();
    expect(line?.fiveHourPercentage).toBeUndefined();
  });

  it('answers with no sessions rather than refusing, on a core nothing has posted to', () => {
    const snapshot = build().status.snapshot(RUNTIME);

    expect(snapshot.vitals).toEqual([]);
    expect(snapshot.transcripts.tracked).toBe(0);
  });
});
