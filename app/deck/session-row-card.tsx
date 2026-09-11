'use client';

// One session row. Renders a view model and nothing else — CODING-STANDARDS §3.
//
// The `open pane` button is absent rather than disabled when a session cannot be attached, and the
// reason takes its place. A disabled button invites a second click and explains nothing; the
// constraint here is permanent (SPEC §5.2) and worth a sentence.
import type { JSX } from 'react';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface SessionRowCardProps {
  readonly row: SessionRowViewModel;
  readonly now: number;
  readonly onOpen: () => void;
}

export function SessionRowCard({ row, now, onOpen }: SessionRowCardProps): JSX.Element {
  return (
    <article className={`row tone-${row.tone}`}>
      <div className="row-main">
        <span className="row-title">{row.title}</span>
        <span className="tag">{row.subscriptionLabel}</span>
        <span className="tag">{row.kindLabel}</span>
      </div>
      <div className="row-meta">
        <span>{row.project}</span>
        <span>{row.stateLabel}</span>
        <span>{row.startedAgo(now)}</span>
      </div>
      {row.canOpenPane ? (
        <button type="button" onClick={onOpen}>
          open pane
        </button>
      ) : (
        <p className="row-blocked">{row.blockedReason}</p>
      )}
    </article>
  );
}
