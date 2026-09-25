// Starting a whole preset group on one press — P6-T4, DECISIONS.md D17.
//
// One class between the palette and `SessionLauncher`, and everything it does is about the fact
// that **this is the most expensive button in Flightdeck**. One press starts N background sessions,
// each of which sends a first prompt, which is N first turns of the owner's 5-hour window. D17 is
// explicit that nothing may fire on its own for exactly this reason. So the three decisions here
// are all about spending that carefully:
//
// **It refuses the whole press rather than launching part of it.** An unknown group starts nothing,
// and a group over `MAX_GROUP_LAUNCH` starts nothing — not its first six. A press that half-fired
// would leave the owner working out which half, with quota already gone.
//
// **One at a time, and a second press is `busy`.** A group launch takes seconds, and a palette
// entry is one Enter away from a second Enter. Treating a double-press as a second intention is
// how somebody ends up with six sessions and a quota warning; `AskRunner` makes the same call for
// the same reason (D48). The guard is released in a `finally`, so a launch that threw does not
// wedge the button.
//
// **Every preset is launched CONCURRENTLY, and that is the bounded choice rather than the fast
// one.** Sequentially, N presets is N × `LAUNCH_TIMEOUT_MS` in the worst case — four minutes of a
// held HTTP request for a group of four, which no client should wait for. Concurrently the worst
// case is ONE timeout however large the group is, which is what makes a single request honest.
// The precedent that says the daemon tolerates it is `respawn --all`, which already restarts every
// background session at once (P4-T5); what is new here is only that the starts are ours.
//
// **A failure is not contagious.** `SessionLauncher.launch` answers with a `Result` and does not
// throw, and each launch is wrapped anyway: one preset naming a folder that has been forgotten
// must not take the other three down with it. Every preset gets an outcome, in group order.
import {
  findGroup,
  MAX_GROUP_LAUNCH,
  type GroupLaunchOutcome,
  type GroupLaunchReport,
  type GroupRefusal,
} from '../../contracts/preset-group.ts';
import { presetPrompt, type LaunchPreset } from '../../contracts/launch-preset.ts';
import type { LaunchFailure } from '../../contracts/launch-reply.ts';
import type { Logger } from '../ports/logger.ts';
import { err, ok, type Result } from '../shared/result.ts';
import type { LaunchRequest } from './session-launcher.ts';

/**
 * The one method each collaborator is used for, rather than the classes themselves.
 *
 * `PresetSource`'s reason, one layer in (`presets-route.ts`): a test of "a group of forty starts
 * nothing" should not have to build a store, a registry, a clock, an audit log and a path
 * canonicaliser to say so. It also keeps the dependency honest — this class reads presets and
 * starts sessions, and can do nothing else to either.
 */
export interface GroupPresetSource {
  list(): readonly LaunchPreset[];
}

export interface GroupSessionStarter {
  launch(request: LaunchRequest): Promise<Result<string, LaunchFailure>>;
}

export interface GroupLauncherParts {
  readonly presets: GroupPresetSource;
  readonly launcher: GroupSessionStarter;
  readonly logger: Logger;
}

export class GroupLauncher {
  private readonly parts: GroupLauncherParts;
  /** Whether a press is in flight. The whole of the `busy` refusal — see the header. */
  private running = false;

  constructor(parts: GroupLauncherParts) {
    this.parts = parts;
  }

  /** Whether a press would be refused right now. `GET /projects/presets` does not ask; a test does. */
  public get inFlight(): boolean {
    return this.running;
  }

  /**
   * Starts every preset in the named group.
   *
   * @returns a report with one outcome per preset, or the reason the press was refused before
   * anything started. A report with every outcome failed is still a report, not a refusal: the
   * press was accepted and the sessions did not start, which is a different thing to say.
   * @throws never — the `finally` is what makes the second press possible.
   */
  public async launch(name: string): Promise<Result<GroupLaunchReport, GroupRefusal>> {
    if (this.running) {
      this.parts.logger.warn('group_launch_busy', {});
      return err('busy');
    }
    const group = findGroup(this.parts.presets.list(), name);
    if (group === undefined) return err('unknown_group');
    if (group.presets.length > MAX_GROUP_LAUNCH) {
      this.parts.logger.warn('group_too_large', { presets: group.presets.length });
      return err('too_many');
    }

    this.running = true;
    try {
      // `Promise.all` over wrappers that cannot reject — see the header's last paragraph. The
      // order of the array is the group's, not the order they happened to finish in, which is what
      // makes the report readable next to the palette entry that produced it.
      const outcomes = await Promise.all(group.presets.map((preset) => this.start(preset)));
      this.parts.logger.info('group_launched', {
        group: group.key,
        started: outcomes.filter((outcome) => outcome.sessionId !== undefined).length,
        of: outcomes.length,
      });
      return ok({ group: group.name, outcomes });
    } finally {
      this.running = false;
    }
  }

  /**
   * One preset, as an outcome rather than a throw.
   *
   * The audit row is `SessionLauncher`'s, on every path including the refusals (SEC-PROC-3), so
   * nothing here writes one: a group press that started three sessions leaves three rows naming
   * three profile functions, which is what a reviewer wants, rather than one row naming a word the
   * owner chose.
   */
  private async start(preset: LaunchPreset): Promise<GroupLaunchOutcome> {
    const launched = await this.parts.launcher.launch({
      profileFn: preset.profileFn,
      // The same rule the single launch uses (`presetPrompt`), so a preset pressed alone and the
      // same preset pressed in a group cannot send different first prompts.
      prompt: presetPrompt(preset),
      name: preset.sessionName,
      cwd: preset.cwd,
      // Checked against the roster by the launcher, for a group press exactly as for one (P9-T1).
      agent: preset.agent,
    });
    return {
      presetId: preset.id,
      name: preset.name,
      sessionId: launched.ok ? launched.value : undefined,
      failure: launched.ok ? undefined : launched.error,
    };
  }
}
