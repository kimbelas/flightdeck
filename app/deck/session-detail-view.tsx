'use client';

// The inside of an expanded row — P2-T4, SPEC §5.5.
//
// Markup only. Every decision — which of three sources answers "doing now", how a token count
// reads, what the sparkline's points are — is in `SessionDetailViewModel`, where it can be tested
// without a DOM (CODING-STANDARDS §3).
//
// **Nothing here is interactive, and that is a security decision rather than a missing feature.**
// The doing-now line, the recap and every `text` below are model-written (SEC-UI-2). React escapes
// them, so they cannot be markup; what this file additionally refuses to do is make them
// ACTIONABLE. The files list is the one that tempts: those paths came out of a transcript, and
// turning one into a link or a "open in editor" button would be letting model output choose what
// the owner's machine opens. They are text.
import type { JSX } from 'react';
import type { TimelineEntry } from '../../contracts/job-state.ts';
import type { SessionDetailViewModel } from './session-detail-view-model.ts';

interface SessionDetailViewProps {
  /** `undefined` while the request is in flight — the store marks the key before it awaits. */
  readonly detail: SessionDetailViewModel | undefined;
  readonly now: number;
}

export function SessionDetailView({ detail, now }: SessionDetailViewProps): JSX.Element {
  if (detail === undefined) return <p className="detail-note muted">reading…</p>;
  if (detail.isBare) {
    // An interactive session that has not rendered a status line, or a background one whose daemon
    // has written nothing yet. Both are ordinary, and neither is an error to report as one.
    return (
      <p className="detail-note muted">Nothing to show yet — this session has not reported.</p>
    );
  }
  return (
    <div className="detail">
      <DoingNowLine detail={detail} />
      {detail.intent !== undefined && (
        <p className="detail-intent" title="The prompt this session was started with">
          {detail.intent}
        </p>
      )}
      <VitalsStrip detail={detail} />
      <Sparkline detail={detail} />
      <Recap detail={detail} now={now} />
      <Files detail={detail} />
    </div>
  );
}

function DoingNowLine({ detail }: { readonly detail: SessionDetailViewModel }): JSX.Element {
  const doing = detail.doingNow;
  return (
    <p className={`detail-doing doing-${doing.source}`}>
      {/* The badge names the SOURCE, because the three do not mean the same thing: `needs` is the
          session asking for something, `detail` is it narrating, and `tool` is an inference from
          the transcript when it said nothing (SPEC §5.5's ◇ fallback). */}
      <span className="tag">{doing.source === 'needs' ? 'needs you' : doing.source}</span>
      <span>{doing.text}</span>
    </p>
  );
}

function VitalsStrip({ detail }: { readonly detail: SessionDetailViewModel }): JSX.Element | null {
  const context = detail.contextPercent;
  const cost = detail.costLabel;
  const lines = detail.linesLabel;
  if (context === undefined && cost === undefined && lines === undefined) return null;
  return (
    <div className="detail-vitals">
      {detail.modelName !== undefined && <span className="tag">{detail.modelName}</span>}
      {/* `undefined` survives to here rather than becoming 0: a session before its first turn has
          no context reading, and "0% used" is a claim nothing has made (RESEARCH.md F.3.5). */}
      {context !== undefined && <span title="Context window used">{context}% ctx</span>}
      {cost !== undefined && <span title="Cost, as Claude Code computed it">{cost}</span>}
      {lines !== undefined && <span title="Lines added and removed">{lines}</span>}
    </div>
  );
}

/**
 * Cumulative tokens over time.
 *
 * Inline SVG with no library and no y-axis. The axis is absent on purpose: the trail starts
 * wherever feed 4 began reading this transcript, so its floor is an artefact of when core last
 * started and only the SHAPE is meaningful. The two endpoint labels carry the real numbers.
 */
function Sparkline({ detail }: { readonly detail: SessionDetailViewModel }): JSX.Element | null {
  const points = detail.sparkline;
  const range = detail.trailRange;
  if (points === undefined || range === undefined) return null;
  return (
    <div className="detail-spark" title="Cumulative tokens over this session, newest on the right">
      <span className="muted">{range.from}</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} />
      </svg>
      <span className="muted">{range.to}</span>
    </div>
  );
}

function Recap({
  detail,
  now,
}: {
  readonly detail: SessionDetailViewModel;
  readonly now: number;
}): JSX.Element | null {
  const recap = detail.recap;
  if (recap.length === 0) return null;
  return (
    <div className="detail-recap">
      <h3>while you were away</h3>
      <ol>
        {recap.map((entry) => (
          <li key={`${String(entry.at ?? 0)}-${entry.state ?? '?'}`}>
            <RecapEntry entry={entry} now={now} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function RecapEntry({
  entry,
  now,
}: {
  readonly entry: TimelineEntry;
  readonly now: number;
}): JSX.Element {
  return (
    <>
      <span className="tag">{entry.state ?? '—'}</span>
      <span className="muted">{ago(entry.at, now)}</span>
      {/* `detail` is the daemon's one-line summary and `text` is the whole assistant message that
          caused the transition; the summary is what a recap wants, and the message is the tooltip
          for when it is not enough. Both are capped in contracts/job-state.ts. */}
      <span title={entry.text}>{entry.detail ?? entry.text ?? 'state changed'}</span>
    </>
  );
}

function Files({ detail }: { readonly detail: SessionDetailViewModel }): JSX.Element | null {
  const files = detail.files;
  if (files.length === 0) return null;
  return (
    <div className="detail-files">
      <h3>files</h3>
      <ul>
        {files.map((path) => (
          // Text, never a link. See the header — these paths came out of a transcript.
          <li key={path} title={path}>
            {detail.fileName(path)}
          </li>
        ))}
        {detail.moreFiles > 0 && <li className="muted">and {detail.moreFiles} more</li>}
      </ul>
    </div>
  );
}

/** Coarse and local to this file: the recap is read at a glance and nothing else needs this. */
function ago(at: number | undefined, now: number): string {
  if (at === undefined) return '';
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}
