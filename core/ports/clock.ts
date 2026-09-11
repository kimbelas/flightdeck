// Time, as a dependency — CODING-STANDARDS §10.1.
//
// Nothing in core reads `Date.now()` directly. A flag derived from "how long since the last event"
// (D7's `wedged`) is untestable against a real clock, and a snapshot timestamped by one is
// untestable at all.
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
