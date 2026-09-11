'use client';

// The deck's top bar. Core health, the count, and the two things that create work.
//
// The chip says `live` rather than `core up` since P1-T9, and the difference is the product: it is
// green while the event stream is open, so it answers "is what I am looking at current?" rather
// than "did a request succeed a minute ago?". `refresh` stays for the one thing the stream does
// not carry — a subscription core could not read publishes no event (SessionStreamRoute).
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
        {coreUp ? 'live' : 'core down'}
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
