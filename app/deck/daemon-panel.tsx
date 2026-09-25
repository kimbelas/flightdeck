'use client';

// Background daemons — P7-T4, SPEC §6(13): "roster, spare workers, retire events per
// subscription".
//
// **It lives in the installation panel**, beside `respawn`, because the daemon is the thing that
// verb and `stop`, `rm` and `logs` talk to — and when one of them fails with "the background
// service may be restarting", this is where the owner looks to find out it is not restarting at
// all (RESEARCH.md F.2.16).
//
// **Behind a button, like everything in this panel.** The read is cheap — two small files and a
// probe per pid — but it is a photograph: every age is measured from when core took it, and a
// second press is the refresh. Nothing polls.
//
// Nothing here renders a path or a prompt: `GET /daemon` carries neither (contracts/daemon-report.ts).
import { useCallback, useState, type JSX } from 'react';
import type { DeckApi } from './deck-api.ts';
import { DAEMON_IDLE, DaemonPanelModel, type DaemonPanelState } from './daemon-panel-model.ts';
import type { DaemonViewModel } from './daemon-view-model.ts';

export function DaemonPanel({ api }: { readonly api: DeckApi }): JSX.Element {
  const [model] = useState(() => new DaemonPanelModel(api));
  const [state, setState] = useState<DaemonPanelState>(DAEMON_IDLE);
  const load = useCallback(() => {
    setState({ ...DAEMON_IDLE, busy: true });
    void model.load().then(setState);
  }, [model]);

  return (
    <div className="install-block" data-daemon-panel>
      <div className="install-row">
        <span className="install-sub">background daemons</span>
        <button type="button" disabled={state.busy} onClick={load} data-daemon-read>
          {state.busy ? 'reading…' : 'read the daemons'}
        </button>
      </div>
      {state.error !== undefined && <p className="install-bad">{state.error}</p>}
      {state.daemons.map((daemon) => (
        <DaemonBlock key={daemon.subscription} daemon={daemon} />
      ))}
    </div>
  );
}

/** One subscription: the headline, its roster's workers and how its sessions ended. */
function DaemonBlock({ daemon }: { readonly daemon: DaemonViewModel }): JSX.Element {
  return (
    <div className="daemon" data-daemon={daemon.subscription}>
      <p className={`daemon-head daemon-${daemon.tone}`} data-daemon-state={daemon.tone}>
        <b>{daemon.subscription}</b> {daemon.headline}
      </p>
      {daemon.logNote !== undefined && <p className="install-note">{daemon.logNote}</p>}
      {daemon.workers.length > 0 && (
        <ul className="daemon-list" data-daemon-workers>
          {daemon.workers.map((worker) => (
            <li key={worker.shortId} className={worker.alive ? '' : 'muted'}>
              <code>{worker.shortId}</code> {worker.label}
            </li>
          ))}
        </ul>
      )}
      <Endings daemon={daemon} />
    </div>
  );
}

/** How the recent background sessions ended — the reason `agents --json` cannot give (F.2.3). */
function Endings({ daemon }: { readonly daemon: DaemonViewModel }): JSX.Element {
  if (daemon.endings.length === 0) {
    return <p className="install-note">no background session has ended in the log’s window.</p>;
  }
  return (
    <>
      {daemon.unanswered > 0 && (
        <p className="install-bad" data-daemon-unanswered>
          {daemon.unanswered} retired while waiting for you — resume one to answer it.
        </p>
      )}
      <ul className="daemon-list" data-daemon-endings>
        {daemon.endings.map((ending) => (
          <li
            key={ending.key}
            className={ending.attention ? 'daemon-attention' : undefined}
            data-daemon-ending={ending.attention ? 'attention' : 'ended'}
          >
            <code>{ending.shortId}</code> {ending.label}{' '}
            <span className="muted">{ending.detail}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
