'use client';

// The `?` sheet — SPEC §5.4's "shortcut sheet with the browser-owned keys called out".
//
// Four tables, and the point of the sheet is that they are four rather than one. A key can be
// bound by the deck, handled by the browser in a way the deck is happy with, claimed by the deck
// *away from* a terminal pane, or owned by the browser and unreclaimable — and someone hunting for
// "why did Ctrl+W close my window" needs the fourth kind labelled as such, not mixed in with keys
// that would work if only they pressed them somewhere else.
//
// The last table re-derives nothing: RESEARCH.md E.2 measured it, contracts/reserved-keys.ts
// carries the findings, and this renders them.
import type { JSX } from 'react';
import type { DeckKeymap, KeyBinding, KeySection } from '../../contracts/keymap.ts';
import {
  BROWSER_OWNED_KEYS,
  NATIVE_KEYS,
  TERMINAL_CLAIMED,
  type ReservedKey,
} from '../../contracts/reserved-keys.ts';

interface ShortcutSheetProps {
  readonly keymap: DeckKeymap;
  readonly onClose: () => void;
}

const SECTIONS: readonly (readonly [KeySection, string])[] = [
  ['global', 'Anywhere'],
  ['sessions', 'The session list'],
  ['panes', 'Panes'],
  ['palette', 'In the palette'],
];

export function ShortcutSheet({ keymap, onClose }: ShortcutSheetProps): JSX.Element {
  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="keyboard shortcuts"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <header className="sheet-head">
          <h2>Keyboard</h2>
          <button type="button" className="ghost" onClick={onClose}>
            close
          </button>
        </header>
        <div className="sheet-body">
          {SECTIONS.map(([section, title]) => (
            <KeyTable key={section} title={title} rows={keymap.inSection(section)} />
          ))}
          <KeyTable title="The browser already does these" rows={NATIVE_KEYS} />
          <KeyTable title="Taken from a terminal pane" rows={TERMINAL_CLAIMED} />
          <BrowserOwned />
        </div>
      </div>
    </div>
  );
}

/** A `KeyBinding` and a `ReservedKey` both print as a key and a sentence. One table does both. */
type SheetRow = Pick<KeyBinding, 'label' | 'description'> | ReservedKey;

interface KeyTableProps {
  readonly title: string;
  readonly rows: readonly SheetRow[];
}

function KeyTable({ title, rows }: KeyTableProps): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <section className="sheet-group">
      <h3>{title}</h3>
      <dl className="sheet-keys">
        {rows.map((row) => (
          <div key={row.label} className="sheet-key">
            <dt>
              <kbd>{row.label}</kbd>
            </dt>
            <dd>{'description' in row ? row.description : row.effect}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The keys the deck cannot have, with the reason stated once rather than per row.
 *
 * The reason is the finding: Keyboard Lock works only in JavaScript-initiated fullscreen, so it is
 * unavailable in the `--app` window the deck runs in, and nothing else suppresses these
 * (RESEARCH.md E.2). Saying it here is what turns a list of complaints into an explanation.
 */
function BrowserOwned(): JSX.Element {
  return (
    <section className="sheet-group">
      <h3>The browser owns these — the deck cannot have them</h3>
      <p className="muted sheet-note">
        A page can only capture these under Keyboard Lock, which Chromium allows solely in
        JavaScript-initiated fullscreen — not in the app window the deck runs in. VS Code for the
        Web documents the same keys as reserved. The desktop shell is where this changes, because
        there are no tabs left for them to act on.
      </p>
      <dl className="sheet-keys">
        {BROWSER_OWNED_KEYS.map((key) => (
          <div key={key.label} className="sheet-key">
            <dt>
              <kbd>{key.label}</kbd>
            </dt>
            <dd>{key.effect}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
