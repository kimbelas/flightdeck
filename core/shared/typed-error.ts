// CODING-STANDARDS.md §6 — every thrown error is a subclass carrying a code.
//
// The code is what makes a failure loggable without interpolating a payload into a string
// (SEC-DATA-2): `{ code, sessionId }` is structured and redactable, `\`failed for ${prompt}\`` is
// neither. Details are a record for the same reason.

export abstract class FlightdeckError extends Error {
  public readonly code: string;
  public readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** A value object handed something it cannot represent. Thrown, because it is a caller bug. */
export class InvalidValueError extends FlightdeckError {
  constructor(what: string, details: Readonly<Record<string, unknown>> = {}) {
    super('invalid_value', `not a valid ${what}`, details);
  }
}
