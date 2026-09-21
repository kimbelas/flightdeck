'use client';

// What the deck cannot tell you, said on the page rather than left to be discovered.
//
// The permanent "this deck polls" banner is gone: P1-T9 gave it a stream, so the list is live and
// a banner saying otherwise would now be the lie it was written to prevent. What is left appears
// only when core is unhappy — an unreadable subscription is "missing", never "none", and it is
// worth knowing that this particular banner is as old as the connection (DeckStore).
import type { JSX } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { GroupBannerLine } from './group-banner-line.ts';

interface DeckBannersProps {
  readonly error: string | undefined;
  readonly unreadable: readonly SubscriptionId[];
  /** The last preset-group press — P6-T4. `undefined` until somebody presses one. */
  readonly group: GroupBannerLine | undefined;
  readonly onDismissGroup: () => void;
}

export function DeckBanners({
  error,
  unreadable,
  group,
  onDismissGroup,
}: DeckBannersProps): JSX.Element {
  return (
    <>
      {error !== undefined && <p className="banner banner-bad">{error}</p>}
      {unreadable.length > 0 && (
        <p className="banner banner-bad">
          Could not read {unreadable.join(' and ')} — those sessions are missing, not absent.
        </p>
      )}
      {group !== undefined && <GroupBanner line={group} onDismiss={onDismissGroup} />}
    </>
  );
}

/**
 * What one press of a preset group did — P6-T4, D17.
 *
 * Here rather than beside the palette that pressed it, because the palette closes on Enter and
 * this is news about N background sessions that will take seconds to appear in the list. It is
 * dismissable for the same reason: it is the only banner here that reports something that WENT
 * RIGHT, so unlike the two above it does not go away by the machine being fixed.
 *
 * The failed presets are named. A press that started two of three is the normal shape of a bad
 * morning, and which one did not is the only useful thing to say about it.
 */
function GroupBanner({
  line,
  onDismiss,
}: {
  readonly line: GroupBannerLine;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <p className={`banner banner-${line.tone === 'good' ? 'good' : 'bad'}`} data-group-banner>
      {line.text}
      {line.failed.length > 0 && <> Did not start: {line.failed.join(', ')}.</>}{' '}
      <button type="button" className="ghost" data-group-dismiss onClick={onDismiss}>
        dismiss
      </button>
    </p>
  );
}
