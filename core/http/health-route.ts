// `GET /health` — is core up, and which build is it.
//
// Authenticated like every other route (CoreServer has no public path). It answers liveness and
// deliberately nothing about sessions, so that the one route an operator script hits most often
// is also the one with the least to leak.
import { json, type JsonResponse, type Route } from './route.ts';

export class HealthRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/health';
  private readonly version: string;

  constructor(version: string) {
    this.version = version;
  }

  public handle(): JsonResponse {
    return json(200, {
      status: 'ok',
      version: this.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }
}
