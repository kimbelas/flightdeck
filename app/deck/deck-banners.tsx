'use client';

// What the deck cannot tell you, said on the page rather than left to be discovered.
//
// The first banner is permanent and intentional: D30 bought a live terminal, not a live deck, and
// a stale list that looks live is worse than one that admits it. The others appear only when core
// is unhappy — an unreadable subscription is "missing", never "none".
import type { JSX } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';

interface DeckBannersProps {
  readonly error: string | undefined;
  readonly unreadable: readonly SubscriptionId[];
}

export function DeckBanners({ error, unreadable }: DeckBannersProps): JSX.Element {
  return (
    <>
      <p className="banner">
        This deck polls. There is no event stream yet (P1-T9), so it shows what core said when you
        last asked — live terminals, not a live deck.
      </p>
      {error !== undefined && <p className="banner banner-bad">{error}</p>}
      {unreadable.length > 0 && (
        <p className="banner banner-bad">
          Could not read {unreadable.join(' and ')} — those sessions are missing, not absent.
        </p>
      )}
    </>
  );
}
