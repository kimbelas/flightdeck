'use client';

// The search's results — one row per SESSION, with the line that matched (P7-T2).
//
// **What a hit can do depends on whether the session is still on the deck.** One that is — a live
// or retired `--bg` session in the list — gets the row's own verbs: open a pane when it can be
// attached (SPEC §5.2), resume when it has retired. One that is not — most of them: a search is
// about work that finished — gets the command that goes back to it, with the folder when the
// folder is known, and a button that copies it. Nothing is started from here that the owner did
// not press, and nothing is typed into a terminal for them.
//
// The snippet is a text node (SEC-UI-2). It is model- and user-written, and nothing in it is ever
// interpreted, linked or turned into the command beside it.
import type { JSX } from 'react';
import type { SessionRowViewModel } from './session-row-view-model.ts';
import type { SearchHitView } from './transcript-search-view-model.ts';

interface SearchHitsProps {
  readonly hits: readonly SearchHitView[];
  readonly onOnly: (shortId: string) => void;
  readonly onOpenPane: (row: SessionRowViewModel) => void;
  readonly onResume: (row: SessionRowViewModel) => void;
}

export function SearchHits({
  hits,
  onOnly,
  onOpenPane,
  onResume,
}: SearchHitsProps): JSX.Element | null {
  if (hits.length === 0) return null;
  return (
    <ol className="search-hits">
      {hits.map((hit) => (
        <li key={hit.key} className="search-hit" data-session={hit.shortId}>
          <p className="search-hit-head">
            <span className="search-hit-project">{hit.project}</span>
            <span className="chip">{hit.subscription}</span>
            <span className="muted">
              {hit.when} · {hit.said}
            </span>
          </p>
          <p className="search-hit-snippet">{hit.snippet}</p>
          <HitActions hit={hit} onOnly={onOnly} onOpenPane={onOpenPane} onResume={onResume} />
        </li>
      ))}
    </ol>
  );
}

interface HitActionsProps {
  readonly hit: SearchHitView;
  readonly onOnly: (shortId: string) => void;
  readonly onOpenPane: (row: SessionRowViewModel) => void;
  readonly onResume: (row: SessionRowViewModel) => void;
}

function HitActions({ hit, onOnly, onOpenPane, onResume }: HitActionsProps): JSX.Element {
  const { row } = hit;
  return (
    <div className="search-hit-actions">
      <code className="search-hit-id">{hit.shortId}</code>
      <button
        type="button"
        className="ghost search-hit-only"
        onClick={() => {
          onOnly(hit.shortId);
        }}
      >
        only this session
      </button>
      {row?.canOpenPane === true && (
        <button
          type="button"
          className="search-hit-open"
          onClick={() => {
            onOpenPane(row);
          }}
        >
          open pane
        </button>
      )}
      {row?.canResume === true && (
        <button
          type="button"
          className="search-hit-wake"
          onClick={() => {
            onResume(row);
          }}
        >
          resume
        </button>
      )}
      {row === undefined && <ResumeCommand command={hit.resume} />}
    </div>
  );
}

/** The command that goes back to a session the deck no longer lists, selectable and copyable. */
function ResumeCommand({ command }: { readonly command: string }): JSX.Element {
  return (
    <>
      <code className="search-hit-resume">{command}</code>
      <button
        type="button"
        className="ghost search-hit-copy"
        onClick={() => {
          // Loopback is a secure context, so the clipboard is there; a refusal leaves the command
          // on screen to be selected by hand, which is what it was before this button existed.
          void navigator.clipboard.writeText(command).catch(() => undefined);
        }}
      >
        copy
      </button>
    </>
  );
}
