// One `Session` to one `SessionRow` — the domain entity to the wire shape.
//
// Promoted out of DeckQuery when the reconciler needed the same answer. Two mappers would be two
// definitions of `attachable`, and the one thing contracts/session-row.ts exists to prevent is a
// second opinion about that: `claude attach` takes background sessions only (SPEC §5.2), so a row
// that said otherwise would offer a pane that cannot open.
import {
  INTERACTIVE_NOT_ATTACHABLE,
  NOT_LIVE,
  type SessionRow,
} from '../../contracts/session-row.ts';
import type { Session } from '../domain/session.ts';

/** The DTO for one session. Pure — no clock, no IO, same answer every time for the same session. */
export function toSessionRow(session: Session): SessionRow {
  const attachable = session.kind === 'background' && session.state.isLive;
  return {
    sessionId: session.id.full,
    shortId: session.id.short,
    subscription: session.subscription,
    kind: session.kind,
    name: session.name,
    cwd: session.cwd,
    startedAt: session.startedAt.getTime(),
    live: session.state.isLive,
    runState: session.state.runState,
    status: session.state.status,
    attachable,
    notAttachableBecause: reasonFor(session, attachable),
  };
}

/**
 * Whether two rows describe the same session in the same condition.
 *
 * Field by field rather than by JSON string: key order is not part of the contract, and a
 * serialisation that happened to differ would publish a `changed` event for a session nothing
 * had happened to.
 */
export function sameRow(left: SessionRow, right: SessionRow): boolean {
  return (
    left.live === right.live &&
    left.runState === right.runState &&
    left.status === right.status &&
    left.name === right.name &&
    left.cwd === right.cwd &&
    left.attachable === right.attachable
  );
}

function reasonFor(session: Session, attachable: boolean): string | undefined {
  if (attachable) return undefined;
  return session.kind === 'interactive' ? INTERACTIVE_NOT_ATTACHABLE : NOT_LIVE;
}
