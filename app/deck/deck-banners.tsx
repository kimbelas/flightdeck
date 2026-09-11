'use client';

// What the deck cannot tell you, said on the page rather than left to be discovered.
//
// The permanent "this deck polls" banner is gone: P1-T9 gave it a stream, so the list is live and
// a banner saying otherwise would now be the lie it was written to prevent. What is left appears
// only when core is unhappy — an unreadable subscription is "missing", never "none", and it is
// worth knowing that this particular banner is as old as the connection (DeckStore).
import type { JSX } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';

interface DeckBannersProps {
  readonly error: string | undefined;
  readonly unreadable: readonly SubscriptionId[];
}

export function DeckBanners({ error, unreadable }: DeckBannersProps): JSX.Element {
  return (
    <>
      {error !== undefined && <p className="banner banner-bad">{error}</p>}
      {unreadable.length > 0 && (
        <p className="banner banner-bad">
          Could not read {unreadable.join(' and ')} — those sessions are missing, not absent.
        </p>
      )}
    </>
  );
}
