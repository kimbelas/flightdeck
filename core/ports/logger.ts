// Structured local logging — SEC-DATA-2.
//
// `info(event, details)` rather than `info(message)` so nothing is ever built by interpolation.
// A refusal logs `{ event: 'request_denied', reason: 'bad_token' }`; it must not log the token,
// the prompt, or the transcript line that provoked it, and a signature that only accepts a record
// is what makes that the path of least resistance.
export type LogDetails = Readonly<Record<string, string | number | boolean>>;

export interface Logger {
  info(event: string, details?: LogDetails): void;
  warn(event: string, details?: LogDetails): void;
  error(event: string, details?: LogDetails): void;
}
