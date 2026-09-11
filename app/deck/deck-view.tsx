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
import { BrowserStreamTransport } from './browser-stream-transport.ts';
import { DeckBanners } from './deck-banners.tsx';
import { DeckHeader } from './deck-header.tsx';
import { DeckStore } from './deck-store.ts';
import { PaneGrid } from './pane-grid.tsx';
import { SessionList } from './session-list.tsx';
import { SessionRowViewModel } from './session-row-view-model.ts';

export interface OpenPane {
  readonly key: string;
  readonly title: string;
  readonly target: PtyTarget;
}

const MAX_PANES = 4;
const AGE_TICK_MS = 10_000;
const SHELL_PANE: OpenPane = { key: 'shell', title: 'shell', target: { kind: 'shell' } };

export function DeckView(): JSX.Element {
  const store = useMemo(() => new DeckStore(new BrowserStreamTransport()), []);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useLiveStream(store);
  const { panes, openPane, closePane } = useOpenPanes();
  const now = useTickingClock();

  const rows = state.rows.map((row) => new SessionRowViewModel(row));

  return (
    <main className="deck">
      <DeckHeader
        coreUp={state.coreUp}
        sessionCount={rows.length}
        loading={state.loading}
        onRefresh={() => void store.refresh()}
        onOpenShell={() => {
          openPane(SHELL_PANE);
        }}
      />
      <DeckBanners error={state.error} unreadable={state.unreadable} />
      <div className="deck-body">
        <SessionList
          rows={rows}
          now={now}
          loading={state.loading}
          coreUp={state.coreUp}
          onLaunch={(subscription, prompt, name) => {
            void store.launch(subscription, prompt, name === '' ? undefined : name);
          }}
          onOpen={(row) => {
            openPane({ key: row.key, title: row.title, target: row.target });
          }}
        />
        <PaneGrid panes={panes} onClose={closePane} />
      </div>
    </main>
  );
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

/** Only so "started 4m ago" does not freeze. It reads no data and asks core for nothing. */
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
