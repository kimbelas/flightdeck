'use client';

// The presets on a project row — press one, check what it will send, start it (P4-T1).
//
// **One selection at a time, and one set of boxes.** The first draft gave every preset its own
// name box, prompt box and button, which is four sets of controls per project before anybody has
// saved anything. Pressing a chip fills one editor instead: the chips are what there is, and the
// editor is what is about to happen.
//
// **The prompt is always visible before it is sent.** A `ticket` preset's four sentences are
// computed from the ticket id and are the model routing (see `TicketPrompt`), so they are shown
// read-only rather than hidden behind the word `ticket` — the owner can see what plan-first means
// without starting a session to find out.
//
// **The start button is disabled while there is no prompt, and that is a constraint rather than a
// bug.** `--bg` will not start without one (RESEARCH.md B.4), which is why the two plain built-ins
// ship with an empty prompt and why the placeholder says so.
//
// **The pieces below return fragments, not wrappers.** `.preset-editor` is a two-column grid and
// every control is one of its items, so a `<div>` introduced to satisfy a component boundary would
// silently become the grid item instead and take the layout with it.
//
// Every decision lives in `PresetsViewModel` — the refusal sentence, the folder phrase, what a
// half-typed ticket id would actually send. What is left here is markup and four callbacks.
import { useState, type JSX, type SyntheticEvent } from 'react';
import type { PresetDraft, PresetLaunch, PresetRef } from '../../contracts/launch-preset.ts';
import { draftPrompt, type PresetLine, type PresetsViewModel } from './presets-view-model.ts';

export interface PresetsPanelProps {
  readonly model: PresetsViewModel;
  /** The project these are filed under, as the registry spells it. Sent back with every write. */
  readonly projectPath: string;
  readonly projectName: string;
  readonly disabled: boolean;
  readonly onLaunch: (request: PresetLaunch) => void;
  readonly onSave: (draft: PresetDraft) => void;
  readonly onForget: (ref: PresetRef) => void;
}

/** What is currently in the three boxes. One object, so one setter threads through the fragments. */
interface EditorDraft {
  readonly sessionName: string;
  readonly typed: string;
  readonly cwd: string;
}

export function PresetsPanel(props: PresetsPanelProps): JSX.Element | undefined {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const { lines } = props.model;
  if (lines.length === 0) return undefined;
  const line = lines.find((held) => held.key === selected);
  return (
    <section className="presets" aria-label={`presets for ${props.projectName}`}>
      <ul className="preset-chips">
        {lines.map((held) => (
          <li key={held.key}>
            <button
              type="button"
              className="preset-chip"
              aria-pressed={held.key === selected}
              /* What the chip cannot say in one word, and the only thing that tells a saved
                 preset from the built-in it shadows before you open it (running it, P4-T1). */
              title={`${held.builtIn ? '' : 'saved · '}${held.profileFn} · ${held.where}`}
              onClick={() => {
                setSelected(held.key === selected ? undefined : held.key);
              }}
            >
              {held.name}
            </button>
          </li>
        ))}
      </ul>
      {props.model.problem !== undefined && (
        <p className="banner-bad preset-problem" role="status">
          {props.model.problem}
        </p>
      )}
      {/* Keyed by the preset, so choosing another one remounts the editor and resets its boxes —
          which is what a `useEffect` synchronising state to a prop would otherwise be for. */}
      {line !== undefined && <PresetEditor key={line.key} line={line} {...props} />}
    </section>
  );
}

interface PresetEditorProps extends PresetsPanelProps {
  readonly line: PresetLine;
}

/** The boxes for one preset, and the two things that can be done with what is in them. */
function PresetEditor(props: PresetEditorProps): JSX.Element {
  const { line } = props;
  const [draft, setDraft] = useState<EditorDraft>({
    sessionName: line.sessionName,
    typed: line.prompt,
    cwd: line.isRoot ? '' : line.cwd,
  });
  const prompt = draftPrompt(line.promptSource, draft.sessionName, draft.typed);
  const change = (patch: Partial<EditorDraft>): void => {
    setDraft({ ...draft, ...patch });
  };
  const start = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (prompt.trim() !== '') props.onLaunch(launchOf(props, draft, prompt));
  };

  return (
    <form className="preset-editor" onSubmit={start}>
      <p className="preset-where">
        {`${line.profileFn} · ${line.subscription} · ${line.where}`}
        {line.namesItself && <span className="preset-pinned"> · names itself</span>}
      </p>
      <PresetStartRow
        line={line}
        draft={draft}
        prompt={prompt}
        disabled={props.disabled}
        onChange={change}
      />
      <PresetTextBoxes line={line} draft={draft} prompt={prompt} onChange={change} />
      <PresetSaveRow {...props} draft={draft} />
    </form>
  );
}

interface FieldProps {
  readonly line: PresetLine;
  readonly draft: EditorDraft;
  readonly prompt: string;
  readonly onChange: (patch: Partial<EditorDraft>) => void;
}

/** The session name and the one button that acts on what is typed — the editor's first row. */
function PresetStartRow({
  line,
  draft,
  prompt,
  disabled,
  onChange,
}: FieldProps & { readonly disabled: boolean }): JSX.Element {
  return (
    <>
      <input
        className="preset-session-name"
        value={draft.sessionName}
        aria-label="session name"
        placeholder={line.promptSource === 'ticket' ? 'ticket id — XWEB-2019' : 'session name'}
        onChange={(event) => {
          onChange({ sessionName: event.target.value });
        }}
      />
      <button type="submit" className="preset-start" disabled={disabled || prompt.trim() === ''}>
        start
      </button>
    </>
  );
}

/** The prompt that will be sent, and the folder it will be sent in. Both span the grid. */
function PresetTextBoxes({ line, draft, prompt, onChange }: FieldProps): JSX.Element {
  return (
    <>
      <textarea
        className="preset-prompt"
        value={prompt}
        rows={3}
        readOnly={line.promptSource === 'ticket'}
        aria-label="first prompt"
        placeholder="first prompt — --bg will not start without one"
        onChange={(event) => {
          onChange({ typed: event.target.value });
        }}
      />
      <input
        className="preset-cwd"
        value={draft.cwd}
        aria-label="folder"
        placeholder="project root — or a worktree under it"
        onChange={(event) => {
          onChange({ cwd: event.target.value });
        }}
      />
    </>
  );
}

/**
 * Keeping what is in the boxes, and throwing a saved one away.
 *
 * Saving under the preset's own name REPLACES it, which is how a built-in is shadowed — there is
 * no separate "edit" and no mode to find (`PresetBook`). Forgetting is offered only where there is
 * a row to forget, and has no confirmation step for `ProjectsPanel`'s reason: it removes a button
 * and brings the built-in back, so the act narrows rather than widens.
 */
function PresetSaveRow(props: PresetEditorProps & { readonly draft: EditorDraft }): JSX.Element {
  const [name, setName] = useState(props.line.name);
  const [group, setGroup] = useState(props.line.group ?? '');
  return (
    <span className="preset-save-row">
      <input
        className="preset-save-name"
        value={name}
        aria-label="preset name"
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <input
        className="preset-group"
        value={group}
        aria-label="preset group"
        placeholder="group — morning"
        onChange={(event) => {
          setGroup(event.target.value);
        }}
      />
      <button
        type="button"
        className="preset-save"
        disabled={props.disabled || name.trim() === ''}
        onClick={() => {
          props.onSave(draftOf(props, name, group));
        }}
      >
        save
      </button>
      <PresetForgetButton {...props} />
    </span>
  );
}

/**
 * Offered only where there is a row to forget.
 *
 * Absent rather than disabled for a built-in, which is `session-row-card.tsx`'s rule: a control
 * that refuses teaches you not to trust the controls beside it. No confirmation step, for
 * `ProjectsPanel`'s reason — it removes a button and brings the built-in back, so the act narrows.
 */
function PresetForgetButton(props: PresetEditorProps): JSX.Element | undefined {
  if (props.line.builtIn) return undefined;
  return (
    <button
      type="button"
      className="preset-forget"
      aria-label={`forget preset ${props.line.name}`}
      onClick={() => {
        props.onForget({ projectPath: props.projectPath, id: props.line.id });
      }}
    >
      forget
    </button>
  );
}

/**
 * What pressing start sends.
 *
 * An empty folder box means the project root, which is what makes the common preset two fields
 * rather than four — and core reads an empty `cwd` as "core's own directory", which is not what a
 * preset ever means.
 */
function launchOf(props: PresetEditorProps, draft: EditorDraft, prompt: string): PresetLaunch {
  return {
    profileFn: props.line.profileFn,
    prompt,
    name: draft.sessionName,
    cwd: draft.cwd.trim() === '' ? props.projectPath : draft.cwd.trim(),
  };
}

/** What pressing save sends. The folder is left EMPTY here — core resolves it against the root. */
function draftOf(
  props: PresetEditorProps & { readonly draft: EditorDraft },
  name: string,
  group: string,
): PresetDraft {
  return {
    projectPath: props.projectPath,
    name,
    profileFn: props.line.profileFn,
    cwd: props.draft.cwd.trim(),
    sessionName: props.draft.sessionName,
    promptSource: props.line.promptSource,
    prompt: props.draft.typed,
    group: group.trim() === '' ? undefined : group.trim(),
  };
}
