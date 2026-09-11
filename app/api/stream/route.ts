// `GET /api/stream` — the deck's end of core's SSE feed (P1-T9).
//
// It is a route handler rather than a `next.config` rewrite, and DECISIONS.md D27 is the whole
// argument. Briefly: both transports stream unbuffered (RESEARCH.md F.6.1), so latency did not
// decide it. What decided it is where the anti-buffering fix lives. Next gzips a proxied
// `text/event-stream` and a compressor holds the stream to the end — twelve events as one chunk at
// 2.2 s, with a `200 OK` and nothing in any log (F.6.3). Exactly one thing prevents it from the
// server side, `Cache-Control: no-transform`, and on the rewrite that header would live in core, in
// another process: a core that forgot it would present as a slow reconciler and be debugged in the
// wrong place. Here the deck defends itself — `accept-encoding: identity` on the upstream leg and
// `no-transform` on its own response, both in this file.
//
// `dynamic = 'force-dynamic'` stops Next from prerendering a route that must not exist until
// someone asks for it. P0-T6 found the same export is silently ignored on a 'use client' module
// (F.5.1); a route handler is not one, so here it applies.
import { CORE_ORIGIN } from '../../../contracts/origins.ts';
import { readCoreToken } from '../../../contracts/core-token.ts';
import { CORE_STREAM_PATH } from '../../../contracts/stream-event.ts';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const CORE_STREAM = `${CORE_ORIGIN}${CORE_STREAM_PATH}`;

/**
 * Response headers for the leg the browser sees.
 *
 * `no-transform` is the one that matters — see the header. It is repeated from core's own response
 * because this handler's reply goes back through the same compression that caught the rewrite.
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

  // The client's query string is deliberately NOT forwarded. Nothing needs it: the stream replays
  // state on connect rather than resuming from an id, because there is no store to page against
  // until P1-T8. Dropping it leaves the outbound request with no client-controlled part at all,
  // which is what makes the CodeQL "file data in outbound network request" finding on the token
  // below a statement about a constant destination rather than a question (RESEARCH.md F.6.10).
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
