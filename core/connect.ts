// The Connector, constructed — P4-T6, and the fifth sibling of `feeds.ts`, `reads.ts`,
// `routes.ts`, `projects.ts` and `verbs.ts`.
//
// It exists because Connect has TWO callers now. `npm run connect` has built one of these since
// P1-T11; as of this task the deck asks core for the same plan and presses the same button, and
// two assemblies of the same six parts would be two answers to "what would Connect write?" — the
// one question this whole feature exists to answer once, out loud, before anything moves.
//
// So `scripts/connect-cli.ts` imports this rather than keeping its own copy. That is the arrow
// pointing the right way: a script may reach into core, and core may not reach into scripts, which
// is why `StatuslinePatcher` moved to `core/adapters/statusline/` in this task (see the port).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SUBSCRIPTION_IDS } from '../contracts/session.ts';
import type { ClaudeInstall } from './adapters/claude-cli/claude-install.ts';
import { BackingUpConfigFile } from './adapters/node/backing-up-config-file.ts';
import { HttpCoreHealth } from './adapters/node/http-core-health.ts';
import { StatuslinePatcher } from './adapters/statusline/statusline-patcher.ts';
import { UserEnvironmentVariable } from './adapters/windows/user-environment-variable.ts';
import { Connector } from './application/connector.ts';
import type { Logger } from './ports/logger.ts';

export const SETTINGS_FILE = 'settings.json';

/**
 * The shared `statusline.py` both subscriptions' `statusLine.command` point at.
 *
 * `~/.claude/hooks/`, the legacy config dir, which D14 keeps visible for exactly this reason: both
 * live configs reference it. It is patched once, not once per subscription.
 */
export function statuslinePath(): string {
  return join(homedir(), '.claude', 'hooks', 'statusline.py');
}

/**
 * Connect and Disconnect, with the real adapters behind them.
 *
 * `HttpCoreHealth` is kept even when core itself is the caller, and it is not a formality: it asks
 * `GET /health` with the token from the token file, so a core whose token has been clobbered by a
 * second core answers `401` and this correctly reports it as not running. That is the case
 * F.1.5 exists for — installing hooks against a receiver that will refuse them is an error banner
 * in every session, every turn, until somebody runs Disconnect.
 */
export function buildConnector(install: ClaudeInstall, logger: Logger): Connector {
  return new Connector({
    files: new BackingUpConfigFile(),
    health: new HttpCoreHealth(),
    patcher: StatuslinePatcher.fromRepo(),
    environment: new UserEnvironmentVariable(),
    // From SUBSCRIPTION_IDS rather than spelled out, so the plan lists them in the same order
    // everything else does. The CLI listed 365 first and `doctor` listed isg first, which put two
    // different orders on one screen once the deck started rendering the plan (P4-T6).
    settingsPaths: SUBSCRIPTION_IDS.map((subscription) => ({
      subscription,
      path: join(install.configDirFor(subscription), SETTINGS_FILE),
    })),
    statuslinePath: statuslinePath(),
    logger,
  });
}
