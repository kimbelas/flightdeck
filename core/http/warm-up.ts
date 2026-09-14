// One request core makes against itself at boot — P0-T3, RESEARCH.md F.1.4.
//
// Lifted out of `main.ts` because it is not composition: the composition root's job is to say what
// is constructed from what, and this is an HTTP concern that happens to run once at startup.
import { request as httpRequest } from 'node:http';
import { CORE_PORT, LOOPBACK_ADDRESS } from '../../contracts/origins.ts';
import type { Logger } from '../ports/logger.ts';

/**
 * One `GET /health` against ourselves, awaited, with everything ignored but the timing.
 *
 * It goes over a real socket rather than calling the route directly, because what is cold is
 * Node's HTTP stack — the parser, the socket path, the first allocation — and a direct call warms
 * none of it. It spends one of the minute's 60 control requests, which is the right price.
 */
export async function warmUp(token: string, logger: Logger): Promise<void> {
  const startedAt = Date.now();
  const status = await new Promise<number>((resolve) => {
    const probe = httpRequest(
      {
        host: LOOPBACK_ADDRESS,
        port: CORE_PORT,
        path: '/health',
        headers: {
          authorization: `Bearer ${token}`,
          host: `${LOOPBACK_ADDRESS}:${String(CORE_PORT)}`,
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve(response.statusCode ?? 0);
        });
      },
    );
    probe.on('error', () => {
      resolve(0);
    });
    probe.end();
  });
  // Logged rather than discarded: a non-200 here is core failing to answer its own token, which is
  // worth knowing at boot rather than when the first hook arrives.
  logger.info('core_warm', { status, ms: Date.now() - startedAt });
}
