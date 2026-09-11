// CODING-STANDARDS.md §6 — expected failures return a Result; bugs throw.
//
// The distinction is not stylistic. A session that cannot leave `done` without a resume is an
// ordinary answer to an ordinary question, and a use case that has to `try`/`catch` to ask it will
// eventually catch a real bug with the same handler. Anything that can be *predicted* comes back
// as a value.

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Narrows a Result to its value, throwing if it is an error.
 *
 * For tests and for the composition root, where an error genuinely is a bug. Never in a use case:
 * that is what the discriminated union exists to prevent.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap called on an error result: ${JSON.stringify(result.error)}`);
}
