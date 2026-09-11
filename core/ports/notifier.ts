// Raising a Windows toast — DECISIONS.md D16, SPEC §7.
//
// A port because the toast is the one output that does not go through the browser: SPEC §11 is
// "completion toasts from core, with no browser needed", so the notifier is reachable from a
// background sweep with nothing open. `toasted-notifier` is the adapter (SPEC §14); it shells out
// to SnoreToast, which is both slow and absent on a CI runner — neither of which any test above
// this line should have to care about.
//
// Muting is not modelled here. Per-session mute is a deck preference (P6-T5), and a port that
// asked "should I?" as well as "do it" would be two responsibilities (R1); the caller decides.
export interface Notification {
  readonly title: string;
  /** Shown as text, never interpreted. It can carry a session name, which is user input. */
  readonly body: string;
  /** `SessionId.full`, so a click can focus the right pane and a mute can be per-session. */
  readonly sessionId: string;
}

export interface Notifier {
  /**
   * Raises the toast, or does nothing if it cannot.
   *
   * @throws never — a toast is a courtesy. A missing SnoreToast, a Focus Assist session or a
   * notification budget that has run out must not fail the action that earned the toast.
   */
  notify(notification: Notification): void;
}
