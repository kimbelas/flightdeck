'use client';

// The boxes of the preset editor — split out of `presets-panel.tsx` at P9-T2, when the map draft's
// caret hook pushed that file over its line limit. They return fragments, not wrappers, for the
// reason that file's header gives: `.preset-editor` is a grid and every control is one of its items.
import { useEffect, useId, useRef, type JSX } from 'react';
import type { PresetLine } from './presets-view-model.ts';

/** What is currently in the boxes. One object, so one setter threads through the fragments. */
export interface EditorDraft {
  readonly sessionName: string;
  readonly typed: string;
  readonly cwd: string;
  /** `''` is `none`. A roster name otherwise (P9-T1). */
  readonly agent: string;
}

export interface FieldProps {
  readonly line: PresetLine;
  readonly draft: EditorDraft;
  readonly prompt: string;
  readonly onChange: (patch: Partial<EditorDraft>) => void;
}

/**
 * The session name and the one button that acts on what is typed — the editor's first row.
 *
 * On a `ticket` preset whose project keeps specs or state notes, the name box offers their ids as a
 * `<datalist>` (P9-T3). A datalist rather than a select because it is an offer: an id that is not on
 * disk yet is typed and sent all the same. The list is hidden, so it takes no cell of the grid.
 */
export function PresetStartRow({
  line,
  draft,
  prompt,
  disabled,
  onChange,
}: FieldProps & { readonly disabled: boolean }): JSX.Element {
  const listId = useId();
  const offered = line.ticketChoices.length > 0;
  return (
    <>
      <input
        className="preset-session-name"
        value={draft.sessionName}
        aria-label="session name"
        list={offered ? listId : undefined}
        placeholder={line.promptSource === 'ticket' ? 'ticket id — XWEB-2019' : 'session name'}
        onChange={(event) => {
          onChange({ sessionName: event.target.value });
        }}
      />
      {offered && (
        <datalist id={listId} className="preset-tickets">
          {line.ticketChoices.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
      )}
      <button type="submit" className="preset-start" disabled={disabled || prompt.trim() === ''}>
        start
      </button>
    </>
  );
}

/** The prompt that will be sent, and the folder it will be sent in. Both span the grid. */
export function PresetTextBoxes({ line, draft, prompt, onChange }: FieldProps): JSX.Element {
  const box = useCaretAtEnd(line.origin !== undefined);
  return (
    <>
      <textarea
        ref={box}
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
 * Focuses the prompt with the cursor after its last character, once, when the editor mounts.
 *
 * For a map draft only (P9-T2): `/fix-review ` is waiting for its arguments, and a caret at the
 * start of the box would have the owner typing them before the slash. Focusing also scrolls the
 * editor into view, which matters because the row that was pressed is further down the project.
 */
function useCaretAtEnd(wanted: boolean): React.RefObject<HTMLTextAreaElement | null> {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = box.current;
    if (!wanted || element === null) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [wanted]);
  return box;
}

/**
 * The agent the session starts under — `none`, or a name from the project's roster (P9-T1).
 *
 * Absent rather than disabled where there is nothing to choose, for `PresetForgetButton`'s reason.
 * A saved agent the roster no longer holds is still listed, marked, so the select shows what the
 * preset says; core refuses the press and the banner says why.
 */
export function PresetAgentSelect({ line, draft, onChange }: FieldProps): JSX.Element | undefined {
  if (line.agentChoices.length === 0) return undefined;
  return (
    <select
      className="preset-agent"
      value={draft.agent}
      aria-label="agent"
      onChange={(event) => {
        onChange({ agent: event.target.value });
      }}
    >
      <option value="">agent — none</option>
      {line.agentChoices.map((name) => (
        <option key={name} value={name}>
          {line.agentMissing && name === line.agent
            ? `${name} (no longer in .claude/agents)`
            : name}
        </option>
      ))}
    </select>
  );
}
