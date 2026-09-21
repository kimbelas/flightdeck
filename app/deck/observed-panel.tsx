'use client';

// What Claude actually did in a folder — P3-T5, SPEC §5.1(b).
//
// **It sits beside the workflow map on purpose.** SPEC's framing is that the contrast between what
// Claude is CONFIGURED to do here and what it ACTUALLY did is the part nothing else shows, so the
// two are adjacent `<details>` on the same row: open both and you are looking at the comparison.
//
// **It is behind a button, and the button says what it costs.** This is the most expensive read the
// deck can make — every transcript of the folder in both subscriptions: 90 MB and ~1 s for this
// repository's own folder, 423 MB and 9.9 s for the owner's biggest — so nothing is fetched until
// somebody asks, exactly as a session preview is not (P5a-T4, F.2.5's "never poll it"). The
// reading then says how long it took and how much it read, because a number that cost ten seconds
// should say so.
//
// **The warning was wrong until it was run.** It said "tens of megabytes and about a second",
// which is true of this repository and understates the owner's biggest project by ten times. A
// button whose warning is an underestimate is worse than no warning, because it is the reason
// somebody presses it (G.47).
import type { JSX } from 'react';
import type { ObservedBehaviour, ObservedCount } from '../../contracts/observed-behaviour.ts';

interface ObservedPanelProps {
  /** The folder this is about. */
  readonly path: string;
  readonly name: string;
  /** `undefined` while a read is in flight; absent from the map entirely before one (`asked`). */
  readonly reading: ObservedBehaviour | undefined;
  readonly asked: boolean;
  readonly disabled: boolean;
  readonly onRead: (path: string) => void;
}

export function ObservedPanel(props: ObservedPanelProps): JSX.Element {
  return (
    <details className="project-detail project-observed">
      <summary>what Claude did here</summary>
      <div className="project-observed-body" data-observed={props.name}>
        <button
          type="button"
          className="ghost"
          data-observed-read
          disabled={props.disabled || (props.asked && props.reading === undefined)}
          onClick={() => {
            props.onRead(props.path);
          }}
        >
          {props.asked && props.reading === undefined ? 'reading…' : 'read the transcripts'}
        </button>
        {props.reading === undefined ? (
          <Explainer asked={props.asked} />
        ) : (
          <Reading reading={props.reading} />
        )}
      </div>
    </details>
  );
}

/** Why there is a button here rather than a number. Said before the first press, and only then. */
function Explainer({ asked }: { readonly asked: boolean }): JSX.Element {
  return (
    <p className="muted project-observed-note">
      {asked
        ? 'Reading every transcript of this folder, in both subscriptions.'
        : 'Nothing is read until you ask: this walks every transcript of this folder in both subscriptions — hundreds of megabytes and up to ten seconds for a long-running project.'}
    </p>
  );
}

function Reading({ reading }: { readonly reading: ObservedBehaviour }): JSX.Element {
  return (
    <div className="project-observed-fields">
      <Headline reading={reading} />
      <Counts label="tools" entries={reading.tools} />
      <Counts label="skills" entries={reading.skills} />
      <Counts label="session names" entries={reading.sessionNames} />
      <Counts label="files" entries={reading.files} />
      <Footnote reading={reading} />
    </div>
  );
}

/** The five numbers a person reads first: how much work, on which account, at what cost. */
function Headline({ reading }: { readonly reading: ObservedBehaviour }): JSX.Element {
  return (
    <dl className="observed-head">
      <Field label="sessions">
        {reading.sessions} · {reading.sessionsThisWeek} this week
      </Field>
      {reading.shares.map((share) => (
        <Field key={share.subscription} label={share.subscription}>
          {share.sessions} session{share.sessions === 1 ? '' : 's'} · ${share.costUsd.toFixed(2)}
        </Field>
      ))}
      <Field label="median context">
        {reading.medianPeakContextTokens === 0
          ? 'not reported'
          : `${String(Math.round(reading.medianPeakContextTokens / 1000))}k tokens at its peak`}
      </Field>
      <Field label="compactions">{reading.compactions}</Field>
      <Field label="scheduled fires">{reading.scheduledFires}</Field>
    </dl>
  );
}

/**
 * What the reading cost, and the drift alarm.
 *
 * `unknownLines` is drawn only when it is non-zero, and it is the one line here that is a warning:
 * a Claude Code release that moves the transcript format shows up in bulk in this read first
 * (SPEC §8 R2).
 */
function Footnote({ reading }: { readonly reading: ObservedBehaviour }): JSX.Element {
  return (
    <p className="muted project-observed-note">
      {Math.round(reading.bytesRead / 1_000_000)} MB in {reading.tookMs} ms
      {reading.unknownLines > 0 && (
        <span className="project-observed-drift" data-observed-drift>
          {' '}
          · {reading.unknownLines} lines of a shape this build has never seen
        </span>
      )}
    </p>
  );
}

/** One list. Absent entirely when empty — a heading over nothing reads as a failed read. */
function Counts({
  label,
  entries,
}: {
  readonly label: string;
  readonly entries: readonly ObservedCount[];
}): JSX.Element | undefined {
  if (entries.length === 0) return undefined;
  return (
    <div className="observed-counts" data-observed-counts={label}>
      <span className="observed-label">{label}</span>
      {entries.map((entry) => (
        // `title` carries the whole of it: a file entry is an absolute path and the pill clips.
        <span key={entry.name} className="observed-count" title={entry.name}>
          {entry.name} <b>{entry.count}</b>
        </span>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="observed-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
