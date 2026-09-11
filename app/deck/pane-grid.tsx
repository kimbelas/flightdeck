'use client';

// The pane area — layouts 1/2/4 (part of P5a-T5), and the two states that are not a terminal.
//
// The empty state carries the sentence that explains the whole deck: only background sessions can
// be attached. Putting it here rather than in a tooltip is deliberate — it is the first thing
// someone wonders when every row refuses a pane.
import type { JSX } from 'react';
import type { OpenPane } from './deck-view.tsx';
import { PaneView } from './pane-view.tsx';

interface PaneGridProps {
  readonly panes: readonly OpenPane[];
  readonly onClose: (key: string) => void;
}

export function PaneGrid({ panes, onClose }: PaneGridProps): JSX.Element {
  return (
    <section className={`panes panes-${String(panes.length)}`} aria-label="terminal panes">
      {panes.length === 0 && (
        <p className="muted pad">
          No panes open. Only background sessions can be attached — an interactive session is
          already bound to the terminal you started it in.
        </p>
      )}
      {/* No grid-wide credential check any more: each pane mints its own ticket and reports its
          own refusal, so core being down shows on the pane that asked rather than on all of them
          (DECISIONS.md D32). */}
      {panes.map((pane) => (
        <PaneView
          key={pane.key}
          target={pane.target}
          title={pane.title}
          onClose={() => {
            onClose(pane.key);
          }}
        />
      ))}
    </section>
  );
}
