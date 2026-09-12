// How the ingest key reaches a Claude Code session's environment (P1-T11, SEC-HTTP-7).
//
// Connect writes `Bearer ${FLIGHTDECK_TOKEN}` into settings.json; something has to put a value
// behind that name, or every hook authenticates with an empty string and 401s — which is a `Stop
// hook error occurred` banner in every interactive session (F.1.5). Installing the hooks without
// this is worse than not connecting at all, so the two are one operation.
//
// **The port never exposes the key.** `publish()` takes no value and `isPublished()` returns a
// boolean: the secret is read and written inside the adapter, so it cannot reach a plan, a diff,
// a log line or the console (SEC-DATA-4). That is the whole reason this is a port shaped like
// this rather than a `set(name, value)`.
export interface SessionEnvironment {
  /** True when a newly launched session would already carry the current ingest key. */
  isPublished(): boolean;

  /** Makes the key available to sessions launched from now on. @throws if it cannot. */
  publish(): void;

  /** Takes it away again. Idempotent — withdrawing what was never published is not an error. */
  withdraw(): void;

  /** One line for the plan, naming the variable and where it is kept. Never the value. */
  describe(): string;
}
