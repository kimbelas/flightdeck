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
import type { PtyTarget } from '../../contracts/pty-protocol.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import { BrowserDeckApi } from './browser-deck-api.ts';
import { BrowserStreamTransport } from './browser-stream-transport.ts';
import { CommandPalette } from './command-palette.tsx';
import { DeckBanners } from './deck-banners.tsx';
import { DeckHeader } from './deck-header.tsx';
import { DeckBody } from './deck-body.tsx';
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
  const grid = usePaneGrid();
  const { expanded, toggle } = useExpandedRows(store);
  const now = useTickingClock();
  const actions = useDeckActions(store, grid.openPane);

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
      />
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
  if (keys.sheetOpen) return <ShortcutSheet keymap={keys.keymap} onClose={keys.onCloseSheet} />;
  return null;
}

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
function useDeckActions(store: DeckStore, openPane: (pane: OpenPane) => void): DeckActions {
  const onOpenShell = useCallback(() => {
    openPane(SHELL_PANE);
  }, [openPane]);

  const onOpenPane = useCallback(
    (row: SessionRowViewModel) => {
      openPane({ key: row.key, title: row.title, target: row.target });
    },
    [openPane],
  );

  const onLaunch = useCallback(
    (subscription: SubscriptionId, prompt: string, name: string) => {
      // An empty name is the form's "let Claude Code choose one", not a name of zero characters.
      void store.launch(subscription, prompt, name === '' ? undefined : name);
    },
    [store],
  );

  const onRefresh = useCallback(() => {
    void store.refresh();
  }, [store]);

  const onResume = useCallback(
    (row: SessionRowViewModel) => {
      void store.resume(row.ref.subscription, row.ref.sessionId);
    },
    [store],
  );

  return { onOpenShell, onOpenPane, onLaunch, onRefresh, onResume, ...projectActions(store) };
}

/** The registry's two, which no other part of the deck touches (P3-T1). */
function projectActions(
  store: DeckStore,
): Pick<DeckActions, 'onImportProject' | 'onForgetProject'> {
  return {
    onImportProject: (path: string) => {
      void store.importProject(path);
    },
    onForgetProject: (path: string) => {
      void store.forgetProject(path);
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
