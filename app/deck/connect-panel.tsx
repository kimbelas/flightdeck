'use client';

// Connect and Disconnect, with the dry run you have to open first — P4-T6, SPEC §5.2, D13.
//
// **The button that writes is not rendered until a plan has been shown.** That is the same shape
// `KeyboardHelper` has and the same promise `npm run connect` keeps by making `--apply` the opt-in:
// the owner reads the whole diff of their own Claude Code config before anything can change it.
// Here it is structural rather than remembered — there is no state in which the write button
// exists and the diff does not.
//
// **There is no confirm on top of the diff, and that is deliberate.** Reaching the write already
// takes two presses with a diff between them, Disconnect is exactly reversible, and P4-T2 settled
// the rule when `rm` got its armed second button: a second prompt on top of a deliberate one is how
// people learn to click through prompts.
//
// **Core answers this route.** A core that is down cannot be disconnected from here, which is not
// a gap this panel can close — `npm run disconnect` is the repair tool for that case and always
// was (SECURITY.md §5.3). The panel says so rather than leaving somebody pressing a dead button.
//
// Nothing here renders a secret. The hooks block Connect writes contains `${FLIGHTDECK_TOKEN}` —
// a name, not a value — and the environment line names the variable and the file its value is read
// from, which is all `SessionEnvironment.describe()` is allowed to say (SEC-DATA-4).
import { useCallback, useState, type JSX } from 'react';
import {
  CONNECTED_EVENTS,
  type AppliedChange,
  type ConnectDirection,
  type ConnectPlan,
  type ConnectWrite,
} from '../../contracts/connect-plan.ts';
import { unifiedDiff } from '../../contracts/text-diff.ts';
import type { DeckApi } from './deck-api.ts';
import { ConnectPanelModel, IDLE, type ConnectPanelState } from './connect-panel-model.ts';

/** Named from the constant Connect actually installs, so this cannot drift from what it writes. */
const WHAT_IT_DOES =
  `Connect installs ${String(CONNECTED_EVENTS.length)} hook handlers — ` +
  `${CONNECTED_EVENTS.join(', ')} — in both subscriptions' settings.json, adds the marked block to ` +
  'the shared statusline.py, and publishes the ingest key as a user environment variable so ' +
  'sessions started afterwards can authenticate. Disconnect removes exactly those, byte for byte.';

export function ConnectPanel({ api }: { readonly api: DeckApi }): JSX.Element {
  const panel = useConnectPanel(api);
  return (
    <div className="install-block" data-connect-panel>
      <span className="install-sub">wiring</span>
      <p className="install-note">{WHAT_IT_DOES}</p>
      <div className="install-row">
        <button
          type="button"
          disabled={panel.state.busy}
          onClick={() => {
            panel.load('connect');
          }}
        >
          show what connecting would write
        </button>
        <button
          type="button"
          disabled={panel.state.busy}
          onClick={() => {
            panel.load('disconnect');
          }}
        >
          show what disconnecting would remove
        </button>
      </div>
      <ConnectResult state={panel.state} direction={panel.direction} onWrite={panel.write} />
    </div>
  );
}

interface Panel {
  readonly state: ConnectPanelState;
  readonly direction: ConnectDirection;
  readonly load: (next: ConnectDirection) => void;
  readonly write: () => void;
}

/** The model, the two calls into it, and which direction the panel is showing. */
function useConnectPanel(api: DeckApi): Panel {
  const [model] = useState(() => new ConnectPanelModel(api));
  const [state, setState] = useState<ConnectPanelState>(IDLE);
  const [direction, setDirection] = useState<ConnectDirection>('connect');

  const load = useCallback(
    (next: ConnectDirection) => {
      setDirection(next);
      setState({ ...IDLE, busy: true });
      void model.load(next).then(setState);
    },
    [model],
  );

  const write = useCallback(() => {
    setState((current) => ({ ...current, busy: true }));
    void model.write(direction, state.plan).then(setState);
  }, [model, direction, state.plan]);

  return { state, direction, load, write };
}

interface ResultProps {
  readonly state: ConnectPanelState;
  readonly direction: ConnectDirection;
  readonly onWrite: () => void;
}

function ConnectResult({ state, direction, onWrite }: ResultProps): JSX.Element | null {
  if (state.error !== undefined) {
    return (
      <div data-connect-failed>
        <p className="install-bad">{state.error}</p>
        <Backups applied={state.partial} />
      </div>
    );
  }
  if (state.written !== undefined) return <WroteIt written={state.written} />;
  if (state.plan === undefined) return null;
  if (!state.plan.ok) {
    return (
      <div data-connect-refused>
        {state.plan.refusals.map((refusal) => (
          <p key={refusal.path} className="install-bad">
            {refusal.path} — {refusal.reason}
          </p>
        ))}
      </div>
    );
  }
  return <ConnectDiff plan={state.plan} direction={direction} onWrite={onWrite} />;
}

interface DiffProps {
  readonly plan: Extract<ConnectPlan, { ok: true }>;
  readonly direction: ConnectDirection;
  readonly onWrite: () => void;
}

/**
 * The plan itself: what needs nothing, what would change, and the one button.
 *
 * "Nothing to do" is the answer on a machine that is already connected, which is the ordinary
 * state — so it is said plainly, and no button is drawn, rather than offering a write that would
 * move nothing.
 */
function ConnectDiff({ plan, direction, onWrite }: DiffProps): JSX.Element {
  const moves = plan.changes.length > 0 || plan.environment !== 'none';
  return (
    <div data-connect-plan>
      {plan.alreadyDone.map((label) => (
        <p key={label} className="install-note">
          {label} — nothing to do.
        </p>
      ))}
      {plan.environment !== 'none' && (
        <p className="install-note" data-connect-environment>
          {plan.environment} — {plan.environmentLabel}
        </p>
      )}
      {plan.changes.map((change) => (
        <details key={change.path} className="sheet-diff">
          <summary>
            {change.label} — {change.path}
          </summary>
          <pre data-connect-diff>{unifiedDiff(change.before, change.after)}</pre>
        </details>
      ))}
      {moves ? (
        <button type="button" data-connect-write onClick={onWrite}>
          {direction} — {String(plan.changes.length)} file(s), each backed up first
        </button>
      ) : (
        <p className="install-note" data-connect-nothing>
          already {direction === 'connect' ? 'connected' : 'disconnected'} — nothing would change.
        </p>
      )}
    </div>
  );
}

function WroteIt({ written }: { readonly written: ConnectWrite }): JSX.Element {
  return (
    <div data-connect-wrote>
      <p className="install-note">
        {written.direction} done — {String(written.applied.length)} file(s).
      </p>
      <Backups applied={written.applied} />
      {written.environment !== 'none' && (
        <p className="install-note">
          {written.environment} — {written.environmentLabel}
        </p>
      )}
      <p className="install-note">
        A terminal that is already open keeps the environment it was started with, so sessions
        started from a NEW one are the first to see this.
      </p>
    </div>
  );
}

/** Where each previous file went. Rendered after a refusal too — see `ConnectPanelState.partial`. */
function Backups({ applied }: { readonly applied: readonly AppliedChange[] }): JSX.Element | null {
  if (applied.length === 0) return null;
  return (
    <>
      {applied.map((change) => (
        <p key={change.path} className="install-note" data-connect-backup>
          wrote {change.path} — previous file kept at {change.backup}
        </p>
      ))}
    </>
  );
}
