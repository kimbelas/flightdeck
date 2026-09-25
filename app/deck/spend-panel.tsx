'use client';

// Cost per week, subscription and project — P7-T3, SPEC §6(9).
//
// **Closed until opened, and opening it is what asks.** The ledger has already read the
// transcripts in core, so a read is two queries — but it is still nothing to spend while nobody is
// looking, so the panel asks on open and on its own refresh button, and never on a timer.
//
// Every number and sentence here comes from `SpendViewModel`; this file only lays them out.
import type { JSX } from 'react';
import type { ProjectRecord } from '../../contracts/project.ts';
import type { SpendHeld } from './spend-slice.ts';
import { SpendViewModel, type SpendProjectLine, type SpendWeekLine } from './spend-view-model.ts';

interface SpendPanelProps {
  readonly spend: SpendHeld;
  readonly projects: readonly ProjectRecord[];
  readonly disabled: boolean;
  readonly onRead: () => void;
}

export function SpendPanel(props: SpendPanelProps): JSX.Element {
  const { spend } = props;
  const model =
    spend.summary === undefined ? undefined : new SpendViewModel(spend.summary, props.projects);
  return (
    <details
      className="spend"
      onToggle={(event) => {
        if (event.currentTarget.open) props.onRead();
      }}
    >
      <summary>
        spend
        {model === undefined ? '' : ` · ${model.total} over ${String(model.weeks.length)} weeks`}
      </summary>
      <div className="spend-body" data-spend>
        <SpendTools spend={spend} disabled={props.disabled} onRead={props.onRead} />
        {model === undefined ? (
          <p className="muted spend-note">{spend.reading ? 'Asking core…' : 'Not read yet.'}</p>
        ) : (
          <SpendReading model={model} />
        )}
      </div>
    </details>
  );
}

/** The refresh button, and the line that says the last refresh did not reach core. */
function SpendTools({ spend, disabled, onRead }: Omit<SpendPanelProps, 'projects'>): JSX.Element {
  return (
    <div className="spend-tools">
      <button
        type="button"
        className="ghost"
        data-spend-refresh
        disabled={disabled || spend.reading}
        onClick={onRead}
      >
        {spend.reading ? 'reading…' : 'refresh'}
      </button>
      {spend.failed && (
        <span className="spend-failed" role="status">
          core did not answer — these are the last numbers it gave
        </span>
      )}
    </div>
  );
}

function SpendReading({ model }: { readonly model: SpendViewModel }): JSX.Element {
  return (
    <>
      <p
        className={model.filling ? 'spend-note spend-filling' : 'muted spend-note'}
        data-spend-coverage
      >
        {model.coverage}
      </p>
      <p className="spend-totals" data-spend-totals>
        {model.totals.map((line) => (
          <span key={line.subscription} className={`spend-total spend-sub-${line.subscription}`}>
            {line.subscription} {line.cost}
          </span>
        ))}
      </p>
      {model.empty ? (
        <p className="muted spend-note">Nothing spent in these weeks, or nothing read yet.</p>
      ) : (
        <>
          <ol className="spend-weeks">
            {model.weeks.map((week) => (
              <Week key={week.weekStart} week={week} />
            ))}
          </ol>
          <ul className="spend-projects">
            {model.projects.map((project) => (
              <Project key={project.key} project={project} />
            ))}
          </ul>
          {model.more !== undefined && <p className="muted spend-note">{model.more}</p>}
        </>
      )}
    </>
  );
}

/** One week: its Monday, a bar split by account, and what it came to. */
function Week({ week }: { readonly week: SpendWeekLine }): JSX.Element {
  return (
    <li
      className={week.current ? 'spend-week is-current' : 'spend-week'}
      data-spend-week={week.label}
    >
      <span className="spend-week-label">{week.label}</span>
      <span className="spend-bar" aria-hidden="true">
        {week.bars.map((bar) => (
          <span
            key={bar.subscription}
            className={`spend-seg spend-sub-${bar.subscription}`}
            style={{ width: `${String(bar.percent)}%` }}
            title={`${bar.subscription} ${bar.cost}`}
          />
        ))}
      </span>
      <span className="spend-week-cost">{week.cost}</span>
      <span className="muted spend-week-sessions">
        {week.sessions} session{week.sessions === 1 ? '' : 's'}
      </span>
    </li>
  );
}

/** One folder: what it is called, what it cost, and which account paid. */
function Project({ project }: { readonly project: SpendProjectLine }): JSX.Element {
  return (
    <li className="spend-project" data-spend-project={project.label}>
      <span
        className={project.imported ? 'spend-project-name' : 'spend-project-name muted'}
        title={project.key}
      >
        {project.label}
      </span>
      <span className="spend-project-cost">{project.cost}</span>
      <span className="muted spend-project-split">
        {project.split} · {project.sessions} session{project.sessions === 1 ? '' : 's'} ·{' '}
        {project.lines}
      </span>
    </li>
  );
}
