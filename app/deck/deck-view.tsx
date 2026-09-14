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
import { DeckStore, type DeckState } from './deck-store.ts';
import { deckCommands, type DeckActions } from './deck-commands.ts';
import { PaneGrid } from './pane-grid.tsx';
import { SessionList } from './session-list.tsx';
import { SessionDetailViewModel } from './session-detail-view-model.ts';
import { SessionRowViewModel } from './session-row-view-model.ts';
import { ShortcutSheet } from './shortcut-sheet.tsx';
import { useDeckKeys, type DeckKeys } from './use-deck-keys.ts';

export interface OpenPane {
  readonly key: string;
  readonly title: string;
  readonly target: PtyTarget;
}

const MAX_PANES = 4;
const AGE_TICK_MS = 10_000;
const SHELL_PANE: OpenPane = { key: 'shell', title: 'shell', target: { kind: 'shell' } };

export function DeckView(): JSX.Element {
  const store = useDeckStore();
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useLiveStream(store);
  const { panes, openPane, closePane } = useOpenPanes();
  const { expanded, toggle } = useExpandedRows(store);
  const now = useTickingClock();
  const actions = useDeckActions(store, openPane);

  // Every session, unfiltered: the palette can reach one the `/` box is currently hiding.
  const rows = state.rows.map((row) => new SessionRowViewModel(row));
  const keys = useDeckKeys(deckCommands({ rows, ...actions }));

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
        panes={panes}
        expanded={expanded}
        actions={actions}
        onToggle={toggle}
        onClosePane={closePane}
      />
      <DeckOverlays keys={keys} />
    </main>
  );
}

interface DeckBodyProps {
  readonly rows: readonly SessionRowViewModel[];
  readonly state: DeckState;
  readonly now: number;
  readonly panes: readonly OpenPane[];
  readonly expanded: ReadonlySet<string>;
  readonly actions: DeckActions;
  readonly onToggle: (row: SessionRowViewModel) => void;
  readonly onClosePane: (key: string) => void;
}

/**
 * The two columns, and the one piece of state that belongs to them rather than to the deck.
 *
 * `/`'s filter lives here because it is a fact about the list — the header still counts every
 * session and the palette still reaches every session, and neither has to know a box is filled in.
 * The keyboard does not know either: `/` focuses this box by id (deck-keyboard.ts), which is why
 * nothing above had to thread the query down or a setter back up.
 */
function DeckBody({
  rows,
  state,
  now,
  panes,
  expanded,
  actions,
  onToggle,
  onClosePane,
}: DeckBodyProps): JSX.Element {
  const [search, setSearch] = useState('');
  return (
    <div className="deck-body">
      <SessionList
        rows={rows.filter((row) => row.matches(search))}
        now={now}
        loading={state.loading}
        coreUp={state.coreUp}
        search={search}
        expanded={expanded}
        details={detailViewModels(state.details)}
        onSearch={setSearch}
        onToggle={onToggle}
        onLaunch={actions.onLaunch}
        onOpen={actions.onOpenPane}
      />
      <PaneGrid panes={panes} onClose={onClosePane} />
    </div>
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
    return () => {
      store.disconnect();
    };
  }, [store]);
}

/**
 * The open rows' details, as view models.
 *
 * Wrapped here rather than in the store, which holds wire values: a view model is presentation and
 * the store is state (CODING-STANDARDS §3). `undefined` survives the mapping and is what draws the
 * spinner — a key present with no value means "asked, still waiting".
 */
function detailViewModels(
  details: DeckState['details'],
): Readonly<Record<string, SessionDetailViewModel | undefined>> {
  return Object.fromEntries(
    Object.entries(details).map(([key, detail]) => [
      key,
      detail === undefined ? undefined : new SessionDetailViewModel(detail),
    ]),
  );
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

  return { onOpenShell, onOpenPane, onLaunch, onRefresh };
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

interface OpenPanes {
  readonly panes: readonly OpenPane[];
  readonly openPane: (pane: OpenPane) => void;
  readonly closePane: (key: string) => void;
}

/**
 * Which panes are on screen. Opening the same one twice is a no-op, not a second PTY.
 *
 * The cap is a layout decision only — attach exclusivity is core's (SEC-WS-3) and must never be
 * something the browser believes it is enforcing.
 */
function useOpenPanes(): OpenPanes {
  const [panes, setPanes] = useState<readonly OpenPane[]>([]);

  const openPane = useCallback((pane: OpenPane) => {
    setPanes((current) => {
      if (current.some((open) => open.key === pane.key)) return current;
      return [...current, pane].slice(-MAX_PANES);
    });
  }, []);

  const closePane = useCallback((key: string) => {
    setPanes((current) => current.filter((pane) => pane.key !== key));
  }, []);

  return { panes, openPane, closePane };
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
