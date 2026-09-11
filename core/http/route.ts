// What a handler is, and what it may return.
//
// Every route returns a plain value rather than writing to the response: a handler that owns the
// socket can forget the no-store header or send a stack trace, and both are security controls
// (SEC-HTTP-6, SECURITY.md §11 rule 6). CoreServer serialises; routes only decide.
import type { RequestFacts } from './loopback-guard.ts';

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface Route {
  readonly method: string;
  readonly path: string;

  /** @throws never — a route that cannot answer returns a status, so one bad request is not a 500. */
  handle(request: RequestFacts, body: string): Promise<JsonResponse> | JsonResponse;
}

export function json(status: number, body: unknown): JsonResponse {
  return { status, body };
}
