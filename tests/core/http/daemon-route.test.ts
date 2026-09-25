// `GET /daemon` — P7-T4.
import { describe, expect, it } from 'vitest';
import { DaemonRoute, type DaemonSource } from '../../../core/http/daemon-route.ts';
import type { DaemonReport } from '../../../contracts/daemon-report.ts';

class FakeSource implements DaemonSource {
  public reads = 0;

  public read(): Promise<DaemonReport> {
    this.reads += 1;
    return Promise.resolve({ at: 7, daemons: [] });
  }
}

describe('DaemonRoute', () => {
  it('is a literal GET on the token, like every other read of the machine', () => {
    const route = new DaemonRoute(new FakeSource());

    expect([route.method, route.path, route.credential, route.limit]).toEqual([
      'GET',
      '/daemon',
      'token',
      'control',
    ]);
  });

  it('answers the reader’s report, reading once per request', async () => {
    const source = new FakeSource();
    const route = new DaemonRoute(source);

    const response = await route.handle();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ at: 7, daemons: [] });
    expect(source.reads).toBe(1);
  });
});
