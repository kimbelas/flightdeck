// `GET /telemetry` — what the OTLP receiver has summed since core started (P7-T5).
//
// **Always registered, even with the receiver off**, and it then answers `enabled: false` and no
// sessions. A reader — `npm run otlp`, P7-T3's analytics — can tell "off" from "on and nothing has
// arrived yet" without guessing from a 404, and nothing about an off receiver is revealed that the
// variable's absence does not already say. Token only: this is a read of the owner's spend.
import type { TelemetryReport } from '../../contracts/session-telemetry.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** The one method this route needs — `TranscriptSearch`'s reason. */
export interface TelemetrySource {
  report(): TelemetryReport;
}

export class TelemetryRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/telemetry';
  public readonly limit: RouteLimit = 'control';
  public readonly credential: Credential = 'token';

  private readonly source: TelemetrySource;

  constructor(source: TelemetrySource) {
    this.source = source;
  }

  public handle(): JsonResponse {
    return json(200, this.source.report());
  }
}
