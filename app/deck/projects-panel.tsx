'use client';

// Importing a folder, and seeing which ones are imported — P3-T1, DECISIONS.md D26.
//
// **A text box and nothing else, on purpose.** There is no "browse" button because the deck is a
// page in a browser and a page cannot open a folder picker that reports a real path; and there is
// no list of suggestions because nothing scans the disk. The owner names the folder they mean,
// which is what makes the allowlist behind this readable — it grows by one deliberate act at a
// time (SEC-FS-1).
//
// **The path is displayed, never linked.** `file://` from a page is refused by every browser and
// would look like a broken feature, and a path is not model-generated text but it is still
// something to show rather than to interpret (SEC-UI-2's habit, applied where it costs nothing).
//
// Every decision this panel makes lives in `ProjectsViewModel` — the empty message, the sentence a
// refusal turns into. What is left here is markup and two callbacks (CODING-STANDARDS §3).
import { useState, type JSX, type SyntheticEvent } from 'react';
import { PROJECT_PATH_ID } from './deck-keyboard.ts';
import type { ProjectLine, ProjectsViewModel } from './projects-view-model.ts';
import { WorkflowMapPanel } from './workflow-map-panel.tsx';

interface ProjectsPanelProps {
  readonly model: ProjectsViewModel;
  readonly disabled: boolean;
  readonly onImport: (path: string) => void;
  readonly onForget: (path: string) => void;
}

export function ProjectsPanel({
  model,
  disabled,
  onImport,
  onForget,
}: ProjectsPanelProps): JSX.Element {
  return (
    <section className="projects" aria-label="projects">
      <ImportBox disabled={disabled} onImport={onImport} />
      {model.problem !== undefined && (
        <p className="banner-bad project-problem" role="status">
          {model.problem}
        </p>
      )}
      {model.isEmpty ? (
        <p className="muted pad">{model.emptyMessage}</p>
      ) : (
        <ul className="project-list">
          {model.lines.map((line) => (
            <ProjectRow key={line.key} line={line} onForget={onForget} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ImportBoxProps {
  readonly disabled: boolean;
  readonly onImport: (path: string) => void;
}

/** The box and the button. The only piece of this panel that holds state of its own. */
function ImportBox({ disabled, onImport }: ImportBoxProps): JSX.Element {
  const [path, setPath] = useState('');

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (path.trim() === '') return;
    onImport(path);
    // Cleared optimistically: a refused path is explained in the message underneath, and a box
    // that kept the text would have the owner editing the thing they just watched fail.
    setPath('');
  };

  return (
    <form className="project-add" onSubmit={submit}>
      {/* The id is the palette's handle: "Import a project" focuses this. */}
      <input
        id={PROJECT_PATH_ID}
        value={path}
        placeholder="import a folder by path"
        aria-label="project path"
        onChange={(event) => {
          setPath(event.target.value);
        }}
      />
      <button type="submit" disabled={disabled || path.trim() === ''}>
        import
      </button>
    </form>
  );
}

interface ProjectRowProps {
  readonly line: ProjectLine;
  readonly onForget: (path: string) => void;
}

/**
 * One imported folder, with the button that withdraws it.
 *
 * No confirmation step, deliberately, and the reason is the direction of the risk: forgetting
 * NARROWS what core may read and is undone by importing the same path again, so a dialogue would
 * buy nothing and would teach the owner to click through dialogues. `title` carries the full path
 * for a folder whose name is the interesting part and whose path is long.
 */
function ProjectRow({ line, onForget }: ProjectRowProps): JSX.Element {
  return (
    <li className="project">
      <span className="project-name">{line.name}</span>
      <span className="project-path" title={line.path}>
        {line.path}
      </span>
      <button
        type="button"
        aria-label={`forget ${line.name}`}
        onClick={() => {
          onForget(line.path);
        }}
      >
        forget
      </button>
      <ProjectMeta line={line} />
      <WorkflowMapPanel model={line.map} project={line.name} />
    </li>
  );
}

/**
 * The second line: what this repository is, and where git has got to — P3-T2.
 *
 * Absent entirely when nothing is known, rather than drawn empty. A folder with no marker and no
 * repository is an ordinary thing to import — SPEC §5.1's "degrades gracefully" half is a repo
 * with no `.claude` at all — and a row that reserved space for a branch it will never have would
 * make the common case look like a failed read.
 *
 * Every value here came out of a closed union or a number core counted. Nothing on this line was
 * composed by core from what is on disk, which is the same property `ProjectsViewModel`'s refusal
 * sentences have.
 */
function ProjectMeta({ line }: { readonly line: ProjectLine }): JSX.Element | undefined {
  if (line.stack.length === 0 && line.gitSummary === undefined) return undefined;
  return (
    <span className="project-meta">
      {line.stack.map((label) => (
        <span key={label} className="project-stack">
          {label}
        </span>
      ))}
      {line.branch !== undefined && (
        // Clipped rather than wrapped, like the path above it — `title` carries the whole of a
        // branch name that a task-per-branch machine makes long.
        <span className="project-branch" title={line.branch}>
          {line.branch}
        </span>
      )}
      {line.progress !== undefined && <span className="project-progress">{line.progress}</span>}
      {line.gitSummary !== undefined && <span className="project-git">{line.gitSummary}</span>}
    </span>
  );
}
