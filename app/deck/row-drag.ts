// Dragging a session card onto the panes — P10-T1, the mockup's "drag a card here to attach".
//
// The drag carries the row's KEY and nothing else, under a type of its own. The drop looks the key
// up in the rows the deck is drawing and opens a pane through `onOpenPane`, the same call the card's
// button makes, so a drop cannot attach anything the button would not — and a drag from somewhere
// else (a file, a link, text) carries no such type and is ignored rather than guessed at.
import type { DragEvent } from 'react';

const ROW_DRAG_TYPE = 'application/x-flightdeck-row';

export function startRowDrag(event: DragEvent, key: string): void {
  event.dataTransfer.setData(ROW_DRAG_TYPE, key);
  event.dataTransfer.effectAllowed = 'link';
}

/** Whether this drag is a session card — asked on `dragover`, where the data cannot be read yet. */
export function isRowDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(ROW_DRAG_TYPE);
}

/** The dropped card's key, or `undefined` when the drop was anything else. */
export function droppedRowKey(event: DragEvent): string | undefined {
  const key = event.dataTransfer.getData(ROW_DRAG_TYPE);
  return key === '' ? undefined : key;
}
