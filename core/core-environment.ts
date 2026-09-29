// Which port this core binds and which subscriptions it hosts — P11-T0, DECISIONS.md D65.
//
// Two environment variables, read in one place, because a core on another machine (an outpost)
// differs from this one in exactly these two facts and nothing else:
//
//   FD_CORE_PORT      the loopback port to bind. The tunnel's local port equals it, so the
//                     exact-match Host check (SEC-HTTP-1) needs no new allowlist entry.
//   FD_SUBSCRIPTIONS  the config dirs this machine has, e.g. `365`. A one-account container must
//                     not sweep the other account's dir and show an `unreadable` banner for it.
//
// Both absent is today's machine byte for byte: 4950, both subscriptions. A value that is present
// and wrong refuses to start rather than falling back — a core that silently took 4950 on an
// outpost would answer the tunnel meant for another one.
import { CORE_PORT, UI_PORT } from '../contracts/origins.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../contracts/session.ts';
import { err, ok, type Result } from './shared/result.ts';

export const CORE_PORT_ENV = 'FD_CORE_PORT';
export const SUBSCRIPTIONS_ENV = 'FD_SUBSCRIPTIONS';

export interface CoreEnvironment {
  readonly port: number;
  readonly subscriptions: readonly SubscriptionId[];
}

/** This machine: 4950 and both subscriptions — what every core was before P11. */
export const LOCAL_CORE: CoreEnvironment = { port: CORE_PORT, subscriptions: SUBSCRIPTION_IDS };

type Environment = Readonly<Record<string, string | undefined>>;

/** Reads both variables; the first problem found is the error, worded for the one log line. */
export function readCoreEnvironment(
  env: Environment = process.env,
): Result<CoreEnvironment, string> {
  const port = corePortFrom(env[CORE_PORT_ENV]);
  if (!port.ok) return port;
  const subscriptions = subscriptionsFrom(env[SUBSCRIPTIONS_ENV]);
  if (!subscriptions.ok) return subscriptions;
  return ok({ port: port.value, subscriptions: subscriptions.value });
}

/**
 * The port a CLIENT beside a core asks (`status`, `doctor`, `connect`): `FD_CORE_PORT`, or 4950.
 *
 * Falls back where core itself refuses, and that is safe the other way round: core will not start
 * on a bad value, so a client that asked 4950 instead finds nothing or finds this machine's core,
 * and says which.
 */
export function clientCorePort(env: Environment = process.env): number {
  const port = corePortFrom(env[CORE_PORT_ENV]);
  return port.ok ? port.value : CORE_PORT;
}

/** The subscriptions a CLIENT beside a core reads: `FD_SUBSCRIPTIONS`, or both. */
export function clientSubscriptions(env: Environment = process.env): readonly SubscriptionId[] {
  const hosted = subscriptionsFrom(env[SUBSCRIPTIONS_ENV]);
  return hosted.ok ? hosted.value : SUBSCRIPTION_IDS;
}

/** Unset or empty means 4950. Otherwise a decimal port above 1023 that is not the deck's. */
export function corePortFrom(raw: string | undefined): Result<number, string> {
  if (raw === undefined || raw.trim() === '') return ok(CORE_PORT);
  const text = raw.trim();
  if (!/^[0-9]{4,5}$/.test(text))
    return err(`${CORE_PORT_ENV}=${JSON.stringify(raw)} is not a port`);
  const port = Number(text);
  if (port < 1024 || port > 65535) return err(`${CORE_PORT_ENV}=${text} is outside 1024-65535`);
  if (port === UI_PORT) return err(`${CORE_PORT_ENV}=${text} is the deck's port`);
  return ok(port);
}

/**
 * Unset or empty means every subscription, in `SUBSCRIPTION_IDS` order. Otherwise a comma list of
 * known ids, each once; the result keeps `SUBSCRIPTION_IDS` order whatever order it was written in,
 * so every list on screen is ordered the same way (P4-T6).
 */
export function subscriptionsFrom(
  raw: string | undefined,
): Result<readonly SubscriptionId[], string> {
  if (raw === undefined || raw.trim() === '') return ok(SUBSCRIPTION_IDS);
  const asked = raw.split(',').map((part) => part.trim());
  const unknown = asked.find((part) => !SUBSCRIPTION_IDS.some((id) => id === part));
  if (unknown !== undefined)
    return err(
      `${SUBSCRIPTIONS_ENV} names ${JSON.stringify(unknown)}, which is not one of ${SUBSCRIPTION_IDS.join(', ')}`,
    );
  if (new Set(asked).size !== asked.length)
    return err(`${SUBSCRIPTIONS_ENV} names a subscription twice`);
  return ok(SUBSCRIPTION_IDS.filter((id) => asked.includes(id)));
}
