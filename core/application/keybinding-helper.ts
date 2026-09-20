// Reads both config dirs' keybindings.json, plans, and — only when asked — writes (P5a-T7).
//
// The third sanctioned writer into `$CFG`, after Connect and Disconnect (SEC-FS-3), and it earns
// that by being the narrowest of the three: it writes one file per subscription, whose whole
// content it re-prints from a parse, with a backup, and it can take every byte of it back out.
//
// **Reading and writing are one class, planning is another.** `KeybindingPlanner` is handed
// contents and returns before/after pairs; this is the only thing here that touches a disk, and it
// re-plans from what is on disk at the moment of the write rather than from whatever the GET saw.
// A plan computed a minute ago against a file the owner has since edited is exactly the write
// SEC-FS-3's "parse → validate → back up" sequence exists to refuse.
import { join } from 'node:path';
import type { PlanRefusal } from '../../contracts/connect-plan.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { ClaudeInstall } from '../adapters/claude-cli/claude-install.ts';
import type { ConfigFile } from '../ports/config-file.ts';
import type { Logger } from '../ports/logger.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type {
  KeybindingDirection,
  KeybindingPlan,
  KeybindingWrite,
} from '../../contracts/keybinding-plan.ts';
import { KeybindingPlanner } from './keybinding-planner.ts';

export const KEYBINDINGS_FILE = 'keybindings.json';

export interface KeybindingHelperParts {
  readonly install: ClaudeInstall;
  readonly files: ConfigFile;
  readonly logger: Logger;
}

export class KeybindingHelper {
  private readonly install: ClaudeInstall;
  private readonly files: ConfigFile;
  private readonly logger: Logger;

  constructor(parts: KeybindingHelperParts) {
    this.install = parts.install;
    this.files = parts.files;
    this.logger = parts.logger;
  }

  public plan(direction: KeybindingDirection): KeybindingPlan {
    const planner = new KeybindingPlanner(this.read());
    return direction === 'apply' ? planner.apply() : planner.restore();
  }

  /**
   * Writes the plan, or refuses.
   *
   * A file that has appeared since the plan was computed, or changed shape, comes back as a
   * refusal from the re-plan rather than as a surprise on disk.
   */
  public write(direction: KeybindingDirection): Result<KeybindingWrite, readonly PlanRefusal[]> {
    const plan = this.plan(direction);
    if (!plan.ok) return err(plan.refusals);

    const written: string[] = [];
    const backups: string[] = [];
    for (const change of plan.changes) {
      // `before === ''` is a file that is not there. Creating one needs no backup and must not
      // ask for one: `BackingUpConfigFile.replace` copies the original first and would throw.
      if (change.before === '') this.files.create(change.path, change.after);
      else backups.push(this.files.replace(change.path, change.after));
      written.push(change.path);
    }
    this.logger.info('keybindings_written', { direction, files: written.length });
    return ok({ written, backups, alreadyDone: plan.alreadyDone });
  }

  private read(): readonly { subscription: string; path: string; contents: string | undefined }[] {
    return SUBSCRIPTION_IDS.map((subscription: SubscriptionId) => {
      const path = join(this.install.configDirFor(subscription), KEYBINDINGS_FILE);
      return { subscription, path, contents: this.files.read(path) };
    });
  }
}
