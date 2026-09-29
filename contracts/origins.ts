// The two ports, in one place, because three separate controls depend on agreeing about them.
//
// P0-T7 measured that a port is part of an origin: the deck at :4949 cannot reach core at :4950
// without the rewrite, and core must refuse anything whose `Origin` is not exactly the deck
// (RESEARCH.md F.4.2, SECURITY.md SEC-HTTP-2). The CSP's `connect-src`, the rewrite target in
// next.config.ts and the OriginGuard are therefore three statements of the same fact; when they
// disagree the failure is silent, so they read it from here.

export const UI_PORT = 4949;
export const CORE_PORT = 4950;

/** The one origin core accepts on mutating routes and every WebSocket upgrade (SEC-HTTP-2). */
export const UI_ORIGIN = `http://127.0.0.1:${String(UI_PORT)}`;

/**
 * Where the browser opens a core's PTY socket. Direct, not through the rewrite (SPEC §4.1).
 *
 * A function of the port since P11 (D65): a core on another machine binds a loopback port of its
 * own and is reached through a tunnel whose local port is that same number, so every statement
 * of "where core is" takes the port instead of assuming 4950.
 */
export function coreWebSocket(port: number = CORE_PORT): string {
  return `ws://127.0.0.1:${String(port)}`;
}

/** Server-to-server only: the Next rewrite's destination, or an outpost's through its tunnel. */
export function coreOrigin(port: number = CORE_PORT): string {
  return `http://127.0.0.1:${String(port)}`;
}

export const CORE_WEBSOCKET = coreWebSocket();
export const CORE_ORIGIN = coreOrigin();

/**
 * `Host` values core answers to (SEC-HTTP-1) — the defeat for DNS rebinding.
 *
 * A rebound name resolves to 127.0.0.1 but still sends its own hostname in `Host`, so an exact
 * match on these two is what separates the deck from `evil.com` pointed at the loopback. The
 * tunnel to an outpost keeps its local port equal to the remote bind (D65), so a tunnelled request
 * still arrives with one of these two and no allowlist entry is added for it.
 */
export function coreHosts(port: number = CORE_PORT): readonly string[] {
  return [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`];
}

export const CORE_HOSTS: readonly string[] = coreHosts();

/** Core binds this and only this. Never a host flag (SECURITY.md §7 rule 1). */
export const LOOPBACK_ADDRESS = '127.0.0.1';
