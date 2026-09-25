// The OTLP receiver's switch, its two paths, and what a session would need to reach it — P7-T5.
//
// **Off unless the owner turns it on, in two places, both by hand.** Core answers `/v1/metrics`
// and `/v1/logs` only when it was started with `FLIGHTDECK_OTLP=1`; without it the paths do not
// exist and an export is refused like any unknown path. And Claude Code exports nothing unless its
// own environment says so (`CLAUDE_CODE_ENABLE_TELEMETRY=1` and the exporter variables below).
// **Flightdeck writes neither.** `npm run otlp` prints the block; putting it in a subscription's
// `settings.json` is the owner's edit, not a third sanctioned writer (SEC-FS-3).
//
// **No new port** (SEC-NET-1). The receiver is two routes on core's own 127.0.0.1:4950, behind
// the same screen as every other route: Host, Content-Type, Origin, Sec-Fetch-Site, then the
// credential. `http/json` rather than protobuf or gRPC because it is the protocol that needs no
// dependency to read, and because SEC-HTTP-4's `application/json` rule already admits it.
//
// **The credential is the ingest key, sent by a headers helper** (SEC-HTTP-7). An exporter, like a
// hook, is configured once at session start and cannot follow a per-boot token across a core
// restart. `otelHeadersHelper` runs a command at start and every 29 minutes and uses the JSON it
// prints as headers (code.claude.com/docs/en/monitoring-usage, "Dynamic headers"), so the key is
// read from its ACL'd file by `scripts/otel-headers.ts` and never written into a settings file.
//
// Server-safe and client-safe alike: no `node:*` import, so the deck may spell these names too.
import { CORE_ORIGIN } from './origins.ts';

/** Core's switch. `1` and nothing else turns the receiver on. */
export const OTLP_RECEIVER_ENV_VAR = 'FLIGHTDECK_OTLP';

/** The OTLP/HTTP default paths, which an exporter appends to `OTEL_EXPORTER_OTLP_ENDPOINT`. */
export const OTLP_METRICS_PATH = '/v1/metrics';
export const OTLP_LOGS_PATH = '/v1/logs';

/** Whether core should answer OTLP at all, from the environment it was started with. */
export function otlpReceiverEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[OTLP_RECEIVER_ENV_VAR] === '1';
}

/**
 * The `env` block a subscription's settings would carry — documented, never written.
 *
 * Every name and value is from Claude Code's monitoring page. Traces are left out because core has
 * no `/v1/traces` and they are a beta behind a flag of their own. The content switches
 * (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_RAW_API_BODIES`…) are left at their
 * default of off: the receiver reads none of that content, so turning it on would only put
 * prompts on the wire for nothing.
 */
export function claudeTelemetryEnv(): Readonly<Record<string, string>> {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_LOGS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_ENDPOINT: CORE_ORIGIN,
    // The default, spelled out: the receiver sums deltas and skips cumulative points.
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
  };
}

/**
 * What the headers helper prints: the bearer, or nothing when core has never run here.
 *
 * `{}` rather than an error when there is no key — a helper that fails puts a notice in the
 * session (monitoring-usage), and "Flightdeck is not installed yet" is not worth one. The exports
 * are then refused 401, which costs the session nothing.
 */
export function otelHeaders(ingestKey: string | undefined): Readonly<Record<string, string>> {
  return ingestKey === undefined ? {} : { Authorization: `Bearer ${ingestKey}` };
}
