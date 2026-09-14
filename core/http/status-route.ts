// `GET /status` — everything core knows about itself, for `flightdeck-core status` (P1-T12).
//
// Authenticated like every other route, and `token` only: this is the screen that names the token
// file, the ingest key file and the database, so the one credential that must never reach a
// long-lived session is the only one that opens it (SEC-HTTP-7 is for `POST /hooks` alone).
//
// The three `process` reads are here rather than in `StatusReport` because the application layer
// does not read the process it is running in (CODING-STANDARDS §2) — `HealthRoute` answers the
// same two fields from the same place, for the same reason.
import type { RuntimeFacts } from '../../contracts/core-status.ts';
import type { StatusReport } from '../application/status-report.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential } from './loopback-guard.ts';
import { json, type JsonResponse, type Route } from './route.ts';

export class StatusRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/status';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly report: StatusReport;

  constructor(report: StatusReport) {
    this.report = report;
  }

  public handle(): JsonResponse {
    return json(200, this.report.snapshot(runtimeFacts()));
  }
}

function runtimeFacts(): RuntimeFacts {
  return {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.versions.node,
  };
}
