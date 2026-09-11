'use client';

// The deck's top bar. Core health, the count, and the two things that create work.
//
// P2-T3's quota gauges belong here and are not built: they come from the statusLine receiver
// (P1-T6), which D30 did not pull forward. The bar says what it knows and nothing more.
import type { JSX } from 'react';

interface DeckHeaderProps {
  readonly coreUp: boolean;
  readonly sessionCount: number;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onOpenShell: () => void;
}

export function DeckHeader({
  coreUp,
  sessionCount,
  loading,
  onRefresh,
  onOpenShell,
}: DeckHeaderProps): JSX.Element {
  return (
    <header className="deck-head">
      <h1>Flightdeck</h1>
      <span className={`chip ${coreUp ? 'chip-live' : 'chip-refused'}`}>
        {coreUp ? 'core up' : 'core down'}
      </span>
      <span className="muted">{sessionCount} sessions</span>
      <button type="button" onClick={onRefresh} disabled={loading}>
        {loading ? 'refreshing…' : 'refresh'}
      </button>
      <button type="button" className="ghost" onClick={onOpenShell}>
        + shell
      </button>
    </header>
  );
}
