// P0-T8 candidate B — the force-dynamic route handler SPEC.md R16 names as the fallback if the
// next.config rewrite buffers SSE.
//
// It exists alongside candidate A (the plain rewrite at /api/core/*) so both can be measured in
// dev and in `next start` rather than argued about; scripts/sse-spike-cli.ts drives both and
// RESEARCH.md F.6 holds the numbers. Which one the deck ships is DECISIONS.md D27.
//
// `dynamic = 'force-dynamic'` is what stops Next from trying to prerender a route that must not
// exist until someone asks for it. P0-T6 found that the same export is silently ignored on a
// 'use client' module (RESEARCH.md F.5.1); a route handler is not one, so here it applies.
import { readCoreToken } from '../../../contracts/core-token.ts';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const CORE_STREAM = 'http://127.0.0.1:4950/stream';

/**
 * Response headers for the leg the browser sees.
 *
 * `no-transform` is the one that matters and it is not decorative: P0-T8 measured Next gzipping a
 * proxied `text/event-stream`, which buffers the whole stream into one chunk at the end. It is
 * repeated here because this handler's own response goes back through the same compression that
 * caught the rewrite (RESEARCH.md F.6.3).
 */
const STREAM_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  'x-content-type-options': 'nosniff',
  connection: 'keep-alive',
};

export async function GET(request: Request): Promise<Response> {
  const token = readCoreToken();
  // Core is down, or has not written its token yet. Generic message, detail stays local
  // (SECURITY.md §3 rule 3).
  if (token === undefined) return new Response('unavailable\n', { status: 503 });

  // The client's query string is deliberately NOT forwarded. Nothing needs it yet, and dropping
  // it leaves the outbound request with no client-controlled part at all — which is what makes
  // the CodeQL "file data in outbound network request" finding on the token below a statement
  // about a constant destination rather than a question. When P1 needs `?since=<last-event-id>`
  // to resume a stream, it adds that one parameter and validates it.
  const upstream = await connect(token, request.signal);
  // Core refusing the connection is an ordinary state, not a bug: it is how a deck left open
  // overnight finds out core restarted. Unhandled, the throw becomes a Next 500 carrying an HTML
  // error page, which is indistinguishable from the deck itself being broken (RESEARCH.md F.6.7).
  if (upstream === undefined) return new Response('unavailable\n', { status: 503 });

  if (!upstream.ok || upstream.body === null) {
    return new Response('unavailable\n', { status: upstream.status });
  }
  return new Response(upstream.body, { status: 200, headers: STREAM_HEADERS });
}

/** The upstream leg, or `undefined` when core is not listening. */
async function connect(token: string, signal: AbortSignal): Promise<Response | undefined> {
  try {
    return await fetch(CORE_STREAM, {
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${token}`,
        // Identity on this leg costs nothing on loopback and removes the compressor that F.6.3
        // caught, rather than relying on core to remember `no-transform`.
        'accept-encoding': 'identity',
      },
      // The browser closing the EventSource must close the socket to core, or every reconnect
      // leaks a stream that keeps producing (SEC-WS-2's reasoning, applied to HTTP).
      signal,
      cache: 'no-store',
      // Core never redirects, so a redirect from :4950 means something is answering that is not
      // core. Following it would re-issue the request against a destination this file did not
      // choose and pipe the answer back as the deck's own same-origin content; `error` refuses
      // instead, and the caller reports core as unavailable.
      redirect: 'error',
    });
  } catch {
    return undefined;
  }
}
