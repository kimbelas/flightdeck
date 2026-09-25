// `GET /daemon` — each subscription's background daemon, for the installation panel (P7-T4).
//
// Token-gated like every read of the machine, and a GET that writes nothing: no audit row, because
// SEC-PROC-3 records what Flightdeck DID and this only looks. It takes no parameters at all — both
// subscriptions are answered every time — so there is nothing on the query string to screen and
// no path a request could steer (SEC-FS-1).
import type { DaemonReport } from '../../contracts/daemon-report.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** `DaemonReader`, as the one method this route calls. */
export interface DaemonSource {
  read(): Promise<DaemonReport>;
}

export class DaemonRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/daemon';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly source: DaemonSource;

  constructor(source: DaemonSource) {
    this.source = source;
  }

  public async handle(): Promise<JsonResponse> {
    return json(200, await this.source.read());
  }
}
