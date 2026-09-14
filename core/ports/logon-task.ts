// The Windows logon task that starts core — DECISIONS.md D21, SEC-OPS-3 (P1-T12).
//
// A port because `doctor` asks it a question and the installer tells it to do something, and those
// are two callers with one definition of what the task is. It is also the only way to test either
// of them: registering a real scheduled task in CI is not something a unit test may do.
//
// **Why a task at all.** Hooks POST whenever a session does anything, browser open or not, and a
// session whose receiver is down records a hook error on every turn (RESEARCH.md D.2, F.1.5). So
// hooks are only safe to install permanently if the receiver is always up — and permanent hooks
// are the whole premise of feed 1 (D3). D21 settled it: a logon task.
export interface LogonTaskState {
  readonly name: string;
  readonly installed: boolean;
  /**
   * The definition as the OS stored it, or `undefined` when the task is not there.
   *
   * Deliberately the raw text rather than a parsed object: `doctor` checks two fields of it
   * (SEC-OPS-3 — interactive token, least privilege) and a parser for the whole Task Scheduler
   * schema would be a lot of code nothing else needs.
   */
  readonly definition: string | undefined;
}

export interface LogonTask {
  /** What is registered right now. @throws never — a missing task is `installed: false`. */
  describe(): LogonTaskState;

  /**
   * The definition `install` would register, without registering it.
   *
   * The same shape as `Connector.plan` and for the same reason (D13): the installer shows what it
   * is about to write and a dry run is the default, so there is no path where something is
   * registered that the owner was not shown first.
   */
  plan(): string;

  /** Registers or replaces the task. @throws if the OS refuses it. */
  install(): void;

  /** Unregisters it. @throws if the OS refuses; a task that is not there is not an error. */
  remove(): void;
}
