'use client';

// The deck. Rows on the left, panes on the right — P2-T4's shape at P5a-T3's fidelity.
//
// Composition and state only: every piece of rendering lives in a child, and every derivation
// lives in SessionRowViewModel. What is left here is the two things that are genuinely this
// component's — which panes are open, and what time it is for the "started 4m ago" column. The
// PTY credential is not among them any more: each pane mints its own ticket when it connects
// (DECISIONS.md D32), so there is nothing page-wide to hold.
//
// The rows arrive on their own since P1-T9: the store subscribes to core's stream, so nothing here
// fetches, polls or re-renders on a timer to stay current.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react';
import type { AskRequest } from '../../contracts/ask-run.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import type { PresetLaunch } from '../../contracts/launch-preset.ts';
import { BrowserDeckApi } from './browser-deck-api.ts';
import { BrowserStreamTransport } from './browser-stream-transport.ts';
import { CommandPalette } from './command-palette.tsx';
import { DeckBanners } from './deck-banners.tsx';
import { DeckHeader } from './deck-header.tsx';
import { DeckBody } from './deck-body.tsx';
import { DeckInstall, installActions } from './deck-install.tsx';
import { DeckStore } from './deck-store.ts';
import { deckCommands, type DeckActions } from './deck-commands.ts';
import { SessionRowViewModel } from './session-row-view-model.ts';
import { ShortcutSheet } from './shortcut-sheet.tsx';
import { usePaneGrid } from './use-pane-grid.ts';
import { useDeckKeys, type DeckKeys } from './use-deck-keys.ts';

export interface OpenPane {
  readonly key: string;
  readonly title: string;
  readonly target: PtyTarget;
}

const AGE_TICK_MS = 10_000;
const SHELL_PANE: OpenPane = { key: 'shell', title: 'shell', target: { kind: 'shell' } };

export function DeckView(): JSX.Element {
  const store = useDeckStore();
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useLiveStream(store);
  // The grid needs the rows to know which stored panes are still attachable after a reload
  // (P5a-T5b), and `coreUp` to know when that list is worth reading.
  const grid = usePaneGrid(state.rows, state.coreUp);
  const { expanded, toggle } = useExpandedRows(store);
  const now = useTickingClock();
  // Which subscription's installation panel is open, or `undefined` — P4-T5. Component state
  // rather than store state: nothing outside this page cares, and the reading it triggers is in
  // the store where it belongs.
  const [install, setInstall] = useState<SubscriptionId | undefined>(undefined);
  const actions = useDeckActions(store, grid.openPane, setInstall);

  // Every session, unfiltered: the palette can reach one the `/` box is currently hiding.
  const rows = state.rows.map((row) => new SessionRowViewModel(row));
  // `onLayout` comes from the grid rather than from `useDeckActions`: the palette's six layout
  // entries and the chooser's six buttons must be the same call, or one of them gets the next fix.
  const keys = useDeckKeys(deckCommands({ rows, ...actions, onLayout: grid.setLayout }), {
    onMovePane: grid.movePaneBy,
  });

  return (
    <main className="deck">
      <DeckHeader
        coreUp={state.coreUp}
        sessionCount={rows.length}
        quota={state.quota}
        now={now}
        loading={state.loading}
        onRefresh={actions.onRefresh}
        onOpenShell={actions.onOpenShell}
        onOpenInstall={actions.onOpenInstall}
      />
      {install !== undefined && <DeckInstall state={state} actions={actions} />}
      <DeckBanners error={state.error} unreadable={state.unreadable} />
      <DeckBody
        rows={rows}
        state={state}
        now={now}
        grid={grid}
        expanded={expanded}
        actions={actions}
        onToggle={toggle}
      />
      <DeckOverlays keys={keys} />
    </main>
  );
}

/**
 * The palette and the shortcut sheet — the two things the keyboard puts on top of the deck.
 *
 * Both are absent rather than hidden when closed. The palette autofocuses its input, and an input
 * that exists behind `display: none` is an input that can hold focus while looking closed.
 */
function DeckOverlays({ keys }: { readonly keys: DeckKeys }): JSX.Element | null {
  const { palette } = keys;
  if (palette !== undefined) {
    return (
      <CommandPalette
        palette={palette}
        query={keys.paletteQuery}
        onQuery={keys.onPaletteQuery}
        onSelect={keys.onPaletteSelect}
        onRun={keys.onPaletteRun}
        onClose={keys.onClosePalette}
      />
    );
  }
  if (keys.sheetOpen) {
    return <ShortcutSheet keymap={keys.keymap} api={SHEET_API} onClose={keys.onCloseSheet} />;
  }
  return null;
}

/**
 * The sheet's own client, module-level because it is stateless and the sheet is not always mounted.
 *
 * Not the store's: nothing the helper does belongs in a session snapshot, and threading the store
 * through the sheet to reach the `fetch` inside it would make every keyboard question a deck-state
 * question (P5a-T7).
 */
const SHEET_API = new BrowserDeckApi();

/**
 * One store for the life of the page, with the browser's two adapters in it.
 *
 * A hook so the composition is named rather than inlined, and `useMemo` rather than `useState`
 * because a second store would be a second stream: the identity is the point, not the caching.
 */
function useDeckStore(): DeckStore {
  return useMemo(() => new DeckStore(new BrowserStreamTransport(), new BrowserDeckApi()), []);
}

/**
 * The stream, open for as long as the deck is mounted — P1-T9.
 *
 * The cleanup is not a formality: without it StrictMode's second mount in development leaves the
 * first connection open, and core would hold a subscription and a heartbeat for a page that no
 * longer exists. `connect` and `disconnect` are both idempotent for the same reason.
 */
function useLiveStream(store: DeckStore): void {
  useEffect(() => {
    store.connect();
    // The registry, once — it is not on the stream, because only somebody on this page can move it
    // (P3-T1). Every later change re-reads it from the write that caused it.
    void store.loadProjects();
    return () => {
      store.disconnect();
    };
  }, [store]);
}

/**
 * What the buttons do, as stable references — and since P2-T5, what the palette's entries do too.
 *
 * Together rather than inline for two reasons. Stable identities keep `SessionList` from
 * re-rendering every row on every tick of the clock. And this component's job is composition
 * (CODING-STANDARDS §3): four arrow functions in JSX are four pieces of behaviour hidden inside
 * markup, and one of them — the empty-name rule below — is a decision rather than plumbing.
 *
 * `DeckActions` is declared in deck-commands.ts because the palette needs the same four: a command
 * that opened a pane its own way would be a second implementation of the row's button.
 */
function useDeckActions(
  store: DeckStore,
  openPane: (pane: OpenPane) => void,
  openInstall: (subscription: SubscriptionId | undefined) => void,
): DeckActions {
  const onOpenShell = useCallback(() => {
    openPane(SHELL_PANE);
  }, [openPane]);

  const onOpenPane = useCallback(
    (row: SessionRowViewModel) => {
      openPane({ key: row.key, title: row.title, target: row.target });
    },
    [openPane],
  );

  // One function for the form and for a preset, as of P4-T2 — both send the same four fields now
  // that the profile function is the routing (`DeckActions.onLaunch`).
  const onLaunch = useCallback(
    (request: PresetLaunch) => {
      void store.launch(request);
    },
    [store],
  );

  const onRefresh = useCallback(() => {
    void store.refresh();
  }, [store]);

  return {
    onOpenShell,
    onOpenPane,
    onLaunch,
    onRefresh,
    ...lifecycleActions(store),
    ...projectActions(store),
    ...askActions(store),
    ...installActions(store, openInstall),
  };
}

/**
 * Ask — P4-T4.
 *
 * Its own pair rather than a member of `lifecycleActions`, because an Ask is not a session: nothing
 * appears in the list, nothing can be attached to, and the run is over when the answer is.
 *
 * Fire-and-forget: core answers 202 in milliseconds and the records arrive on the stream (D48), so
 * there is nothing here to await.
 */
function askActions(store: DeckStore): Pick<DeckActions, 'onAsk' | 'onClearAsk'> {
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
function lifecycleActions(
  store: DeckStore,
): Pick<DeckActions, 'onResume' | 'onStop' | 'onRemove' | 'onPreview'> {
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
  };
}

/**
 * The registry's two and the presets' three, which no other part of the deck touches (P3-T1, P4-T1).
 *
 * Together in one function because they are one panel's worth of verbs and `deck-view.tsx` has a
 * line limit it has already been split for twice. Launching is NOT here: as of P4-T2 a preset and
 * the form send the same request, so there is one `onLaunch` above rather than two.
 */
function projectActions(
  store: DeckStore,
): Pick<DeckActions, 'onImportProject' | 'onForgetProject' | 'onSavePreset' | 'onForgetPreset'> {
  return {
    onImportProject: (path: string) => {
      void store.importProject(path);
    },
    onForgetProject: (path: string) => {
      void store.forgetProject(path);
    },
    onSavePreset: (draft) => {
      void store.savePreset(draft);
    },
    onForgetPreset: (ref) => {
      void store.forgetPreset(ref);
    },
  };
}

interface ExpandedRows {
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (row: SessionRowViewModel) => void;
}

/**
 * Which rows are open, and the fetch that opening one starts — P2-T4.
 *
 * The set lives here and the details live in the store, which sounds split but is not: "is this row
 * open" is a fact about this browser tab, and the detail is data off the wire. Keeping the set in
 * the store would make a second tab's expansion arrive as a re-render here.
 *
 * Collapsing calls `forget`, so re-expanding re-reads. See `DeckStore.expand` — `state.json` and
 * `timeline.jsonl` move while a row is open, and a detail from four minutes ago that looks current
 * is worse than a spinner.
 */
function useExpandedRows(store: DeckStore): ExpandedRows {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback(
    (row: SessionRowViewModel) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.delete(row.key)) {
          store.forget(row.key);
          return next;
        }
        next.add(row.key);
        void store.expand(row.ref);
        return next;
      });
    },
    [store],
  );

  return { expanded, toggle };
}

/**
 * Only so "started 4m ago" and the header's quota countdowns do not freeze.
 *
 * It reads no data and asks core for nothing — it is a clock, not a poll, which is the distinction
 * P1-T9 drew. One clock for both because two would drift against each other on the same screen, and
 * 10 s is fine for a countdown printed to the minute.
 */
function useTickingClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, AGE_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
