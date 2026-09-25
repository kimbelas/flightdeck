// `npm run otlp` — what turning the OTLP receiver on would take, and whether it is on (P7-T5).
//
// **It prints and it writes nothing.** Both halves of the switch are the owner's: core's
// `FLIGHTDECK_OTLP=1`, and the `env` block and `otelHeadersHelper` line in a subscription's
// `settings.json`. Connect and the keyboard helper are the only writers into `$CFG` (SEC-FS-3),
// and a third that exists to enable an optional feed would be the wrong one to add.
//
// **The key is never printed** (SEC-DATA-4). The snippet names the helper, and the helper reads
// the key from its file when Claude Code runs it.
import { claudeTelemetryEnv, OTLP_RECEIVER_ENV_VAR } from '../contracts/otlp-receiver.ts';
import { HttpCoreClient } from '../core/adapters/node/http-core-client.ts';
import { err, ok, type Result } from '../core/shared/result.ts';

/** What `GET /telemetry` said, reduced to what this screen prints. */
export interface TelemetryLive {
  readonly enabled: boolean;
  readonly sessions: number;
  readonly skipped: number;
}

/** Asks the running core. "Core is not running" is an ordinary answer, not an exception. */
export async function readTelemetry(): Promise<Result<TelemetryLive, string>> {
  const reply = await new HttpCoreClient().get('/telemetry');
  if (!reply.ok) return err(reply.error);
  if (reply.value.status !== 200) return err(`core answered ${String(reply.value.status)}`);
  const live = parseLive(reply.value.body);
  return live === undefined
    ? err('core answered /telemetry with a body this build cannot read')
    : ok(live);
}

/**
 * The whole screen. Pure, so it is testable without a core.
 *
 * @param repoRoot where `scripts/otel-headers.ts` lives, spelled with forward slashes because the
 * helper line is run by a shell Claude Code chooses, and a backslash is an escape in most of them.
 */
export function renderOtlpSetup(
  repoRoot: string,
  live: Result<TelemetryLive, string>,
): readonly string[] {
  const helper = `node "${repoRoot.replaceAll('\\', '/')}/scripts/otel-headers.ts"`;
  const settings = { env: claudeTelemetryEnv(), otelHeadersHelper: helper };
  return [
    `OTLP receiver: ${state(live)}`,
    '',
    'Flightdeck writes none of this. To turn it on, by hand:',
    '',
    `  1. Start core with ${OTLP_RECEIVER_ENV_VAR}=1 in its environment, e.g. once per user:`,
    `       [Environment]::SetEnvironmentVariable('${OTLP_RECEIVER_ENV_VAR}', '1', 'User')`,
    '     then restart core (flightdeck-stop.cmd, flightdeck.cmd).',
    '',
    '  2. Merge this into each subscription settings.json you want measured,',
    '     back it up first, and start new sessions (running ones keep their old env):',
    '',
    ...JSON.stringify(settings, null, 2)
      .split('\n')
      .map((line) => `       ${line}`),
    '',
    '  Prompt, response and tool-detail logging stay at their default of off: the receiver',
    '  counts events and sums metrics, and reads no content.',
    '  To turn it off: remove both, restart core. GET /telemetry then answers enabled: false.',
  ];
}

function state(live: Result<TelemetryLive, string>): string {
  if (!live.ok) return `unknown (${live.error})`;
  if (!live.value.enabled) return `off (core was started without ${OTLP_RECEIVER_ENV_VAR}=1)`;
  const { sessions, skipped } = live.value;
  return `on — ${String(sessions)} sessions heard since core started, ${String(skipped)} skipped`;
}

function parseLive(body: string): TelemetryLive | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const enabled = 'enabled' in value ? value.enabled : undefined;
  const sessions = 'sessions' in value ? value.sessions : undefined;
  const skipped = 'skipped' in value ? value.skipped : undefined;
  if (typeof enabled !== 'boolean' || !Array.isArray(sessions)) return undefined;
  return { enabled, sessions: sessions.length, skipped: typeof skipped === 'number' ? skipped : 0 };
}
