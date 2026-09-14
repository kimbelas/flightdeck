'use client';

// The Ctrl+K palette. Renders a view model and nothing else — CODING-STANDARDS §3.
//
// **There is no `onKeyDown` in this file.** `↑`, `↓`, `Enter` and `Esc` arrive through the deck's
// one capturing window listener (deck-keyboard.ts) like every other key, because the palette being
// open is already a `KeyContext` and the keymap already says what is live in it. A second handler
// here would be a second, disagreeing source for the same four keys — and the one that would win
// is the one that is harder to test.
//
// The input is uncontrolled in the sense that matters: everything typed into it goes to the field,
// because in the `palette` context the keymap binds nothing printable. That is what `j` and `k`
// being absent from the palette's row of the table buys.
import type { JSX } from 'react';
import type { CommandPaletteViewModel, DeckCommand } from './command-palette-view-model.ts';

interface CommandPaletteProps {
  readonly palette: CommandPaletteViewModel;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onSelect: (index: number) => void;
  readonly onRun: (command: DeckCommand) => void;
  readonly onClose: () => void;
}

export function CommandPalette({
  palette,
  query,
  onQuery,
  onSelect,
  onRun,
  onClose,
}: CommandPaletteProps): JSX.Element {
  const selected = palette.selectedIndex;
  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="command palette"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        {/* autoFocus is right here and nowhere else: the palette exists for the length of one
            keystroke-to-command, and it is opened by a key, so the caret has to already be in it. */}
        <input
          className="palette-input"
          value={query}
          autoFocus
          placeholder="run a command, or jump to a session"
          aria-label="command"
          onChange={(event) => {
            onQuery(event.target.value);
          }}
        />
        <PaletteResults palette={palette} selected={selected} onSelect={onSelect} onRun={onRun} />
        <p className="palette-foot muted">↑ ↓ move · Enter run · Esc close</p>
      </div>
    </div>
  );
}

interface PaletteResultsProps {
  readonly palette: CommandPaletteViewModel;
  readonly selected: number;
  readonly onSelect: (index: number) => void;
  readonly onRun: (command: DeckCommand) => void;
}

/**
 * The results, or the sentence that replaces them.
 *
 * `onMouseMove` moves the selection rather than a hover style doing it: the highlight is what
 * `Enter` runs, and two different rows looking chosen — one under the pointer, one under the
 * cursor — is how you press Enter and get the wrong command.
 */
function PaletteResults({ palette, selected, onSelect, onRun }: PaletteResultsProps): JSX.Element {
  if (palette.resultCount === 0) {
    return <p className="palette-empty muted">Nothing matches. Esc to close.</p>;
  }
  return (
    <ul className="palette-list" role="listbox" aria-label="commands">
      {palette.results.map((command, index) => (
        <li
          key={command.id}
          role="option"
          aria-selected={index === selected}
          className={`palette-item${index === selected ? ' palette-item-on' : ''}`}
          onMouseMove={() => {
            onSelect(index);
          }}
          onMouseDown={() => {
            onRun(command);
          }}
        >
          <span className="palette-label">{command.label}</span>
          <span className="palette-hint muted">{command.hint}</span>
        </li>
      ))}
    </ul>
  );
}
