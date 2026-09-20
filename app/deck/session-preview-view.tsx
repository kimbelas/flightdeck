'use client';

// The preview block inside an expanded row — P5a-T4, SPEC §5.3.
//
// **A button, never a timer.** One preview costs a 2.7 s spawn and 330 KB of terminal frame
// (RESEARCH.md F.2.5, which ends "never poll it"), so this is the whole refresh mechanism: press
// it, get a photograph, press it again for a newer one. SPEC §5.3's "refreshed every few seconds"
// was written before that measurement existed.
//
// **Who it is for.** SPEC §5.3 gave previews to panes a WebGL budget had no renderer for, and D40
// deleted that budget. The set this serves was never empty: an interactive session cannot be
// attached at all (SPEC §5.2), so for those a preview is not a cheaper terminal — it is the only
// way to see what the session is doing.
//
// Markup only; every decision is in `SessionPreviewViewModel`. Nothing here is interactive except
// the button, and the lines are text nodes — they came out of a session, and a session is not a
// trusted author (SEC-UI-2).
import type { JSX } from 'react';
import type { SessionPreviewViewModel } from './session-preview-view-model.ts';

interface SessionPreviewViewProps {
  /** Absent when nobody has asked; `undefined` while a request is in flight. */
  readonly preview: SessionPreviewViewModel | undefined;
  readonly asked: boolean;
  readonly now: number;
  readonly onPreview: () => void;
}

export function SessionPreviewView({
  preview,
  asked,
  now,
  onPreview,
}: SessionPreviewViewProps): JSX.Element {
  return (
    <div className="detail-preview" data-deck-preview>
      <div className="detail-preview-head">
        <h3>{preview?.heading ?? 'preview'}</h3>
        {preview !== undefined && <span className="muted">{preview.takenAgo(now)}</span>}
        {/* The label is the honest verb for what happens, which is not "refresh": the first press
            reads and every press after it reads again, and each one spawns a process. Disabled
            only while a read is in flight — a second press would be a second `claude logs`. */}
        <button
          type="button"
          className="ghost"
          data-deck-preview-read
          disabled={asked && preview === undefined}
          onClick={onPreview}
        >
          {preview === undefined ? 'read' : 'read again'}
        </button>
      </div>
      <PreviewBody preview={preview} asked={asked} />
    </div>
  );
}

function PreviewBody({
  preview,
  asked,
}: {
  readonly preview: SessionPreviewViewModel | undefined;
  readonly asked: boolean;
}): JSX.Element | null {
  if (preview === undefined) {
    if (asked) return <p className="detail-note muted">reading…</p>;
    return null;
  }
  return (
    <>
      {preview.note !== undefined && <p className="detail-note muted">{preview.note}</p>}
      {preview.isEmpty ? (
        <p className="detail-note muted">Nothing to show — this session has left no trace yet.</p>
      ) : (
        // `<pre>` and not a list of `<p>`: a screen's alignment is the alignment Claude Code drew,
        // and re-wrapping it at the box's width would take a status bar and a progress gauge apart.
        // The trail is drawn the same way so the two cannot be told apart by their whitespace.
        <pre className={preview.isScreen ? 'preview-screen' : 'preview-trail'}>
          {preview.lines.join('\n')}
        </pre>
      )}
    </>
  );
}
