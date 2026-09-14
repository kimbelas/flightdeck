// One authenticated GET against 127.0.0.1:4950 — the only way anything in this repo asks core a
// question over HTTP (P1-T12, promoted out of `HttpCoreHealth` and `scripts/core-status.ts`).
//
// **Why one class for two callers.** Connect needs "is core up?" (P1-T11) and
// `flightdeck-core status` needs three route bodies; both were building the same request, and the
// second build is where the details drift — the `Host` header that SEC-HTTP-1 checks exactly, the
// absent `Origin` that SEC-HTTP-2 allows only because there is no browser involved, the timeout.
//
// **Nothing here is assembled from a string.** The host and port are constants from
// `contracts/origins.ts`, and `path` is a closed union of the routes core answers — `RequestRouter`
// has no patterns and no prefixes, so the set really is finite, and a typo is a type error rather
// than a 404 at runtime. That is also what makes the shape of this request auditable: there is no
// input to this class that could redirect it somewhere else.
//
// **The token is read per request, never held.** `contracts/core-token.ts` explains why: it is
// per boot and `Rotate token` changes it while the deck stays up, so a cached value would
// authenticate to a core that no longer exists.
import { request } from 'node:http';
import { readCoreToken } from '../../../contracts/core-token.ts';
import { CORE_PORT, LOOPBACK_ADDRESS } from '../../../contracts/origins.ts';
import { err, ok, type Result } from '../../shared/result.ts';

/** Generous next to a 1 ms loopback answer, and short enough not to leave a caller hanging. */
const DEFAULT_TIMEOUT_MS = 2000;

/** Every path core answers to a GET. Closed, because `RequestRouter` matches literals only. */
export type CoreGetPath = '/health' | '/sessions' | '/status';

export interface CoreResponse {
  readonly status: number;
  readonly body: string;
}

export class HttpCoreClient {
  private readonly timeoutMs: number;

  /**
   * @param timeoutMs how long to wait. The default suits `/health`; `/sessions` sweeps both
   * subscriptions at ~760 ms each (RESEARCH.md B.2) and its caller passes more.
   */
  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Asks core for one route.
   *
   * @returns the status and body, or the reason there is none. "Core is not running" is an
   * ordinary answer (RESEARCH.md F.3.3), so a refused connection, a timeout and a missing token
   * are all values rather than exceptions.
   *
   * A non-200 is still an `ok` result carrying its status: a 401 means the token file is newer or
   * older than the core holding the port — the failure the `run` skill documents — and a caller
   * that could not tell it from a refused connection would report the wrong problem.
   *
   * @throws never.
   */
  public get(path: CoreGetPath): Promise<Result<CoreResponse, string>> {
    const token = readCoreToken();
    if (token === undefined) return Promise.resolve(err('no token file — core is not running'));
    return this.send(path, token);
  }

  private send(path: CoreGetPath, token: string): Promise<Result<CoreResponse, string>> {
    return new Promise<Result<CoreResponse, string>>((resolve) => {
      const probe = request(
        {
          host: LOOPBACK_ADDRESS,
          port: CORE_PORT,
          path,
          timeout: this.timeoutMs,
          headers: {
            authorization: `Bearer ${token}`,
            // Exactly what SEC-HTTP-1 demands. `node:http` would send one anyway; naming it keeps
            // the request's whole screened surface visible in one place.
            host: `${LOOPBACK_ADDRESS}:${String(CORE_PORT)}`,
          },
        },
        (response) => {
          const chunks: string[] = [];
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => chunks.push(chunk));
          response.on('end', () => {
            resolve(ok({ status: response.statusCode ?? 0, body: chunks.join('') }));
          });
        },
      );
      probe.on('timeout', () => {
        probe.destroy();
        resolve(err(`core did not answer ${path} within ${String(this.timeoutMs)} ms`));
      });
      probe.on('error', (cause: Error) => {
        resolve(err(`could not reach core on ${path} — ${cause.message}`));
      });
      probe.end();
    });
  }
}
