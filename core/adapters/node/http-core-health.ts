// One authenticated `GET /health` against 127.0.0.1:4950 (P1-T11).
//
// It uses the real token from the real file, because "core is running" has to mean the same thing
// Connect's hooks will need it to mean: a core whose token file is stale answers 401 to everything
// and is not usable, even though something is bound to the port (the `run` skill documents that
// failure — a second core clobbers the token and then fails to bind).
//
// The request itself moved to `HttpCoreClient` in P1-T12, when `flightdeck-core status` became the
// second caller building the same one. What stays here is the only thing this class ever decided:
// that every failure is one answer, because Connect does not need to know which.
import type { CoreHealth } from '../../ports/core-health.ts';
import { HttpCoreClient } from './http-core-client.ts';

export class HttpCoreHealth implements CoreHealth {
  private readonly client: HttpCoreClient;

  constructor(client: HttpCoreClient = new HttpCoreClient()) {
    this.client = client;
  }

  public async isRunning(): Promise<boolean> {
    const answer = await this.client.get('/health');
    // A 401 is `ok: true` with a status — and still not running, for this question's purposes:
    // a core nothing can authenticate to is a core Connect must not install hooks against.
    return answer.ok && answer.value.status === 200;
  }
}
