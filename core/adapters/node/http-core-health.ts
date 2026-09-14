// One authenticated `GET /health` against 127.0.0.1:4950 (P1-T11).
//
// It uses the real token from the real file, because "core is running" has to mean the same thing
// Connect's hooks will need it to mean: a core whose token file is stale answers 401 to everything
// and is not usable, even though something is bound to the port (the `run` skill documents that
// failure — a second core clobbers the token and then fails to bind).
import { request } from 'node:http';
import { readCoreToken } from '../../../contracts/core-token.ts';
import { CORE_PORT, LOOPBACK_ADDRESS } from '../../../contracts/origins.ts';
import type { CoreHealth } from '../../ports/core-health.ts';

/** Generous next to a 1 ms loopback answer, and short enough that Connect is not left hanging. */
const TIMEOUT_MS = 2000;

export class HttpCoreHealth implements CoreHealth {
  public isRunning(): Promise<boolean> {
    const token = readCoreToken();
    if (token === undefined) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const probe = request(
        {
          host: LOOPBACK_ADDRESS,
          port: CORE_PORT,
          path: '/health',
          timeout: TIMEOUT_MS,
          headers: {
            authorization: `Bearer ${token}`,
            host: `${LOOPBACK_ADDRESS}:${String(CORE_PORT)}`,
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => {
            resolve(response.statusCode === 200);
          });
        },
      );
      // Every failure is the same answer. Connect does not need to know which one.
      probe.on('timeout', () => {
        probe.destroy();
        resolve(false);
      });
      probe.on('error', () => {
        resolve(false);
      });
      probe.end();
    });
  }
}
