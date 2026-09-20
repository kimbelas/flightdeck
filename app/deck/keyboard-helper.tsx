'use client';

// The `?` sheet's keyboard helper — SPEC §5.3's "one click writes the remaps, with a diff and
// backup" (P5a-T7).
//
// **The diff comes first and there is no way round it.** The button that writes is not rendered
// until a plan has been loaded and shown, which is D13 expressed as a component rather than as a
// convention: the owner reads what would change to their own Claude Code config before anything
// can change it.
//
// The honest part of this panel is the Ctrl+W line. The task asked for a Ctrl+W remap and there is
// no such thing to write — delete-word is not a keybindings action (RESEARCH.md G.33) — so the
// panel says so where somebody hunting for it will read it, rather than quietly shipping half.
import { useCallback, useState, type JSX } from 'react';
import {
  RECLAIMED_KEYS,
  UNRECLAIMABLE_NOTE,
  type KeybindingDirection,
} from '../../contracts/keybinding-plan.ts';
import type { DeckApi } from './deck-api.ts';
import { IDLE, KeyboardHelperModel, type KeyboardHelperState } from './keyboard-helper-model.ts';

interface KeyboardHelperProps {
  readonly api: DeckApi;
}

export function KeyboardHelper({ api }: KeyboardHelperProps): JSX.Element {
  const helper = useKeyboardHelper(api);

  return (
    <section className="sheet-group" data-keyboard-helper>
      <h3>Move the keys Claude Code binds under the browser</h3>
      <p className="muted sheet-note">{UNRECLAIMABLE_NOTE}</p>
      <RemapTable />
      <div className="sheet-actions">
        <button
          type="button"
          className="ghost"
          disabled={helper.state.busy}
          onClick={() => {
            helper.load('apply');
          }}
        >
          show what it would write
        </button>
        <button
          type="button"
          className="ghost"
          disabled={helper.state.busy}
          onClick={() => {
            helper.load('restore');
          }}
        >
          show how to put it back
        </button>
      </div>
      <HelperResult state={helper.state} direction={helper.direction} onWrite={helper.write} />
    </section>
  );
}

function RemapTable(): JSX.Element {
  return (
    <dl className="sheet-keys">
      {RECLAIMED_KEYS.map((remap) => (
        <div key={remap.from} className="sheet-key">
          <dt>
            <kbd>{remap.from}</kbd> → <kbd>{remap.to}</kbd>
          </dt>
          <dd>
            {remap.action} in {remap.context}. {remap.stolenBy}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface Helper {
  readonly state: KeyboardHelperState;
  readonly direction: KeybindingDirection;
  readonly load: (next: KeybindingDirection) => void;
  readonly write: () => void;
}

/** The model, the two calls into it, and which direction the panel is showing. */
function useKeyboardHelper(api: DeckApi): Helper {
  const [model] = useState(() => new KeyboardHelperModel(api));
  const [state, setState] = useState<KeyboardHelperState>(IDLE);
  const [direction, setDirection] = useState<KeybindingDirection>('apply');

  const load = useCallback(
    (next: KeybindingDirection) => {
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

interface HelperResultProps {
  readonly state: KeyboardHelperState;
  readonly direction: KeybindingDirection;
  readonly onWrite: () => void;
}

function HelperResult({ state, direction, onWrite }: HelperResultProps): JSX.Element | null {
  if (state.error !== undefined) return <p className="pane-detail">{state.error}</p>;
  if (state.written !== undefined) return <WroteIt written={state.written} />;
  if (state.plan === undefined) return null;

  if (!state.plan.ok) {
    return (
      <div data-helper-refused>
        {state.plan.refusals.map((refusal) => (
          <p key={refusal.path} className="pane-detail">
            {refusal.path} — {refusal.reason}
          </p>
        ))}
      </div>
    );
  }

  const { changes, alreadyDone } = state.plan;
  return (
    <div data-helper-plan>
      {alreadyDone.map((path) => (
        <p key={path} className="muted sheet-note">
          {path} — nothing to do.
        </p>
      ))}
      {changes.map((change) => (
        <details key={change.path} className="sheet-diff">
          <summary>{change.label}</summary>
          <pre data-helper-after>{change.after}</pre>
        </details>
      ))}
      {changes.length > 0 && (
        <button type="button" className="ghost" data-helper-write onClick={onWrite}>
          {direction === 'apply' ? 'write it' : 'put it back'} — {String(changes.length)} file(s),
          each backed up first
        </button>
      )}
    </div>
  );
}

function WroteIt({
  written,
}: {
  readonly written: { readonly written: readonly string[]; readonly backups: readonly string[] };
}): JSX.Element {
  return (
    <div data-helper-wrote>
      {written.written.map((path) => (
        <p key={path} className="muted sheet-note">
          wrote {path}
        </p>
      ))}
      {written.backups.map((path) => (
        <p key={path} className="muted sheet-note">
          previous file kept at {path}
        </p>
      ))}
      <p className="muted sheet-note">
        Claude Code reads keybindings.json at start — a session already running keeps the old keys.
      </p>
    </div>
  );
}
