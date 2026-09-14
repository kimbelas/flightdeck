// `GET /status` — P1-T12.
//
// Short, because the route is: the assembly is `StatusReport`'s and has its own test. What is
// pinned here is the part a route decides — the path, the body cap, and which credential opens it.
import { describe, expect, it } from 'vitest';
import { parseCoreStatus } from '../../../contracts/core-status.ts';
import { AuditLog } from '../../../core/application/audit-log.ts';
import { StatusReport } from '../../../core/application/status-report.ts';
import { TranscriptReader } from '../../../core/application/transcript-reader.ts';
import { VitalsRegistry } from '../../../core/application/vitals-registry.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import { StatusRoute } from '../../../core/http/status-route.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';
import { FakeStore } from '../../fakes/fake-store.ts';
import { FakeTranscriptFile } from '../../fakes/fake-transcript-file.ts';

function route(): StatusRoute {
  const logger = new FakeLogger();
  return new StatusRoute(
    new StatusReport({
      version: '0.0.1',
      store: { path: 'C:\\data\\flightdeck.db', version: 2 },
      events: { stored: 0, snapshots: 0, dropped: 0 },
      audit: new AuditLog(new FakeStore(), new FakeClock(), logger),
      transcripts: new TranscriptReader({
        file: new FakeTranscriptFile(),
        policy: new ReadPolicy(['C:\\Users\\x\\.claude-365']),
        scheduler: new FakeScheduler(),
        logger,
      }),
      vitals: new VitalsRegistry(),
      tokenPath: 'C:\\data\\token',
      ingestKeyPath: 'C:\\data\\ingest-key',
      claudePath: undefined,
    }),
  );
}

describe('StatusRoute', () => {
  it('is a GET on /status, on the control budget', () => {
    expect(route().method).toBe('GET');
    expect(route().path).toBe('/status');
    expect(route().limit).toBe('control');
  });

  it('takes the token and not the ingest key', () => {
    // It names the token file, the ingest key file and the database. The credential a long-lived
    // session carries must not open it (SEC-HTTP-7: `POST /hooks` is the only route that takes it).
    expect(route().credential).toBe('token');
  });

  it('answers 200 with a body the CLI can parse', () => {
    const response = route().handle();

    expect(response.status).toBe(200);
    expect(parseCoreStatus(JSON.parse(JSON.stringify(response.body)))).toBeDefined();
  });

  it('answers this process, so an operator can tell which core they reached', () => {
    const parsed = parseCoreStatus(JSON.parse(JSON.stringify(route().handle().body)));

    expect(parsed?.runtime.pid).toBe(process.pid);
    expect(parsed?.runtime.nodeVersion).toBe(process.versions.node);
  });
});
