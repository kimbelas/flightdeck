'use client';

// The left column: start a session, then every session that exists.
import type { JSX } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';
import { LaunchForm } from './launch-form.tsx';
import type { SessionDetailViewModel } from './session-detail-view-model.ts';
import { SessionRowCard } from './session-row-card.tsx';
import type { SessionRowViewModel } from './session-row-view-model.ts';

interface SessionListProps {
  readonly rows: readonly SessionRowViewModel[];
  readonly now: number;
  readonly loading: boolean;
  readonly coreUp: boolean;
  /** Which rows are open, by `SessionRowViewModel.key`. A set, because several can be. */
  readonly expanded: ReadonlySet<string>;
  /** The open rows' details, by the same key. A key with `undefined` is still in flight. */
  readonly details: Readonly<Record<string, SessionDetailViewModel | undefined>>;
  readonly onToggle: (row: SessionRowViewModel) => void;
  readonly onLaunch: (subscription: SubscriptionId, prompt: string, name: string) => void;
  readonly onOpen: (row: SessionRowViewModel) => void;
}

export function SessionList({
  rows,
  now,
  loading,
  coreUp,
  expanded,
  details,
  onToggle,
  onLaunch,
  onOpen,
}: SessionListProps): JSX.Element {
  return (
    <section className="rows" aria-label="sessions">
      <LaunchForm disabled={!coreUp || loading} onLaunch={onLaunch} />
      {rows.length === 0 && !loading && (
        <p className="muted pad">No sessions. Start one above and it becomes a pane.</p>
      )}
      {rows.map((row) => (
        <SessionRowCard
          key={row.key}
          row={row}
          now={now}
          expanded={expanded.has(row.key)}
          detail={details[row.key]}
          onToggle={() => {
            onToggle(row);
          }}
          onOpen={() => {
            onOpen(row);
          }}
        />
      ))}
    </section>
  );
}
