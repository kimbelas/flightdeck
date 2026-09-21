// The three groups of actions that are pure store-wiring — P4-T4, P4-T2, P3-T1, P6-T3, P6-T4.
//
// Out of `deck-view.tsx` for the reason that file's own comment already gave: it has a 250-line
// limit it has been split for twice, and of what it does, this is the piece with the least to do
// with a view. Nothing here renders, holds state or reads `DeckState` — each function turns a
// `DeckStore` into the bag of callbacks `DeckActions` describes, and the decisions in them are
// about WHEN a store method is called rather than about what is on screen.
//
// They stay three functions rather than becoming one, because they are three different answers to
// "why is this fire-and-forget": an Ask is over when its answer is (D48), a lifecycle verb is
// reported by the next sweep rather than by its own reply, and a project read is deliberate
// because it costs a walk of the disk.
import type { AskRequest } from '../../contracts/ask-run.ts';
import type { DeckActions } from './deck-commands.ts';
import type { DeckStore } from './deck-store.ts';
import type { SessionRowViewModel } from './session-row-view-model.ts';

/**
 * Ask — P4-T4.
 *
 * Its own pair rather than a member of `lifecycleActions`, because an Ask is not a session: nothing
 * appears in the list, nothing can be attached to, and the run is over when the answer is.
 *
 * Fire-and-forget: core answers 202 in milliseconds and the records arrive on the stream (D48), so
 * there is nothing here to await.
 */
export function askActions(store: DeckStore): Pick<DeckActions, 'onAsk' | 'onClearAsk'> {
  return {
    onAsk: (draft: AskRequest) => {
      void store.ask(draft);
    },
    onClearAsk: () => {
      store.clearAsk();
    },
  };
}

/** Start, stop, wake — the three that change what a session IS rather than what is on screen. */
export function lifecycleActions(
  store: DeckStore,
): Pick<
  DeckActions,
  'onResume' | 'onStop' | 'onRemove' | 'onPreview' | 'onMute' | 'onLaunchGroup' | 'onClearGroup'
> {
  return {
    onResume: (row: SessionRowViewModel) => {
      void store.resume(row.ref.subscription, row.ref.sessionId);
    },
    onStop: (row: SessionRowViewModel) => {
      void store.stop(row.ref);
    },
    // P4-T2. There is no confirmation here and there must not be: this is called only by the
    // row's armed second button, and a second prompt on top of that is how people learn to click
    // through prompts (`RowDelete`).
    onRemove: (row: SessionRowViewModel) => {
      void store.remove(row.ref);
    },
    // P5a-T4. Here rather than in the expand effect on purpose: a preview spawns `claude logs`
    // and waits 2.7 s for 330 KB (RESEARCH.md F.2.5, "never poll it"), so it happens when
    // somebody presses the button and at no other time.
    onPreview: (row: SessionRowViewModel) => {
      void store.preview(row.ref);
    },
    // P6-T3. `muted` is the position being asked for rather than a toggle, so the button and the
    // set it reads from cannot disagree about which way the press went.
    onMute: (row: SessionRowViewModel, muted: boolean) => {
      void store.setMuted(row.ref, muted);
    },
    // P6-T4, D17. The one action here that spends quota per press — N sessions, N first turns.
    onLaunchGroup: (group: string) => {
      void store.launchGroup(group);
    },
    onClearGroup: () => {
      store.clearGroup();
    },
  };
}

/**
 * The registry's two and the presets' three, which no other part of the deck touches (P3-T1, P4-T1).
 *
 * Together in one function because they are one panel's worth of verbs and `deck-view.tsx` has a
 * line limit it has already been split for twice. Launching is NOT here: as of P4-T2 a preset and
 * the form send the same request, so there is one `onLaunch` above rather than two.
 */
export function projectActions(
  store: DeckStore,
): Pick<
  DeckActions,
  'onImportProject' | 'onForgetProject' | 'onObserveProject' | 'onSavePreset' | 'onForgetPreset'
> {
  return {
    onImportProject: (path: string) => {
      void store.importProject(path);
    },
    onForgetProject: (path: string) => {
      void store.forgetProject(path);
    },
    // P3-T5, and the same bargain `onPreview` above makes: this walks every transcript of the
    // folder in both subscriptions, so it happens on a press and at no other time.
    onObserveProject: (path: string) => {
      void store.observe(path);
    },
    onSavePreset: (draft) => {
      void store.savePreset(draft);
    },
    onForgetPreset: (ref) => {
      void store.forgetPreset(ref);
    },
  };
}
