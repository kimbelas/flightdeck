'use client';

// What the version chip opens — P4-T5, SPEC §5.2.
//
// **It says auto-updates are on, and that is the honest headline.** The roadmap asked for a
// `claude update` button on the assumption somebody has to press one; `claude doctor` reports
// `Auto-updates: enabled` and `Last update attempt: success → 2.1.278 (2026-09-19)`
// (RESEARCH.md F.10.1). So the button is a "check now", the panel says so, and the owner is not
// left thinking they are behind.
//
// **`respawn --all` is not labelled "all".** Measured, it restarts the sessions the CLI chooses
// and skips one that has finished (F.10.4), so the button says what it did — by id — rather than
// claiming a number it did not earn.
//
// **Nothing here renders a path.** `claude doctor` prints the binary's location, which carries the
// Windows account name; `contracts/install-health.ts` drops it before it leaves core, and this
// draws only the fields that survived (SEC-DATA-2).
import type { JSX } from 'react';
import type { InstallHealth } from '../../contracts/install-health.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { RespawnReport } from './install-slice.ts';
import type { UpdateResult } from '../../contracts/install-health.ts';

interface InstallPanelProps {
  readonly health: Readonly<Record<string, InstallHealth | undefined>>;
  readonly update: UpdateResult | undefined;
  readonly respawn: RespawnReport | undefined;
  readonly onCheck: (subscription: SubscriptionId) => void;
  readonly onUpdate: (subscription: SubscriptionId) => void;
  readonly onRespawnAll: (subscription: SubscriptionId) => void;
  readonly onClose: () => void;
}

export function InstallPanel(props: InstallPanelProps): JSX.Element {
  return (
    <section className="install" aria-label="installation">
      <div className="install-head">
        <span>Claude Code</span>
        <button type="button" onClick={props.onClose} aria-label="close installation">
          close
        </button>
      </div>
      {SUBSCRIPTION_IDS.map((id) => (
        <InstallBlock
          key={id}
          subscription={id}
          health={props.health[id]}
          asked={id in props.health}
          onCheck={() => {
            props.onCheck(id);
          }}
          onUpdate={() => {
            props.onUpdate(id);
          }}
          onRespawnAll={() => {
            props.onRespawnAll(id);
          }}
        />
      ))}
      <InstallOutcomes update={props.update} respawn={props.respawn} />
    </section>
  );
}

/** What the last press did. Its own component so the panel body stays inside 40 lines. */
function InstallOutcomes({
  update,
  respawn,
}: {
  readonly update: UpdateResult | undefined;
  readonly respawn: RespawnReport | undefined;
}): JSX.Element {
  return (
    <>
      {update !== undefined && (
        <p className="install-note" aria-label="update result">
          {updateText(update)}
        </p>
      )}
      {respawn !== undefined && (
        <p className="install-note" aria-label="respawn result">
          {respawnText(respawn)}
        </p>
      )}
    </>
  );
}

/** Auto-updates are on, so "already up to date" is what this says almost every time (F.10.1). */
function updateText(update: UpdateResult): string {
  if (update.changed) return `updated to ${update.version ?? 'a new version'}`;
  return update.version === undefined
    ? 'already up to date'
    : `already up to date (${update.version})`;
}

interface BlockProps {
  readonly subscription: SubscriptionId;
  readonly health: InstallHealth | undefined;
  readonly asked: boolean;
  readonly onCheck: () => void;
  readonly onUpdate: () => void;
  readonly onRespawnAll: () => void;
}

/** One subscription's block. Its own component so the panel body stays inside 40 lines. */
function InstallBlock(props: BlockProps): JSX.Element {
  const { health } = props;
  return (
    <div className="install-block">
      <div className="install-row">
        <span className="install-sub">{props.subscription}</span>
        <button type="button" onClick={props.onCheck}>
          doctor
        </button>
        <button type="button" onClick={props.onUpdate}>
          check for updates
        </button>
        <button type="button" onClick={props.onRespawnAll}>
          respawn background sessions
        </button>
      </div>
      {props.asked && health === undefined && <p className="install-note">reading…</p>}
      {health !== undefined && <InstallFields health={health} />}
    </div>
  );
}

/** The fields doctor reported, and the one sentence worth drawing from them. */
function InstallFields({ health }: { readonly health: InstallHealth }): JSX.Element {
  return (
    <div className="install-fields" aria-label={`health ${health.subscription}`}>
      {health.autoUpdates === true && (
        <p className="install-note">
          Auto-updates are on — this binary keeps itself current, so the button above is a check,
          not a chore.
        </p>
      )}
      {health.healthy === false && (
        <p className="install-bad">doctor reported an installation problem.</p>
      )}
      <dl>
        {health.fields.map((field) => (
          <div key={field.key} className="install-field">
            <dt>{field.key}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * What a respawn actually did.
 *
 * Never "all sessions restarted": `--all` skips a session that has finished (F.10.4), so the ids
 * the CLI named are the only honest answer, and none of them is an error.
 */
function respawnText(report: RespawnReport): string {
  if (report.respawned.length === 0) {
    return `${report.subscription}: nothing needed restarting.`;
  }
  return `${report.subscription}: restarted ${report.respawned.join(', ')}.`;
}
