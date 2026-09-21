// One Ask run, as the panel prints it — P4-T4, CODING-STANDARDS §3.
//
// `SessionRowViewModel`'s habit: the store holds wire values and this decides how they read, so
// every sentence below is assertable without rendering a page.
//
// **The meta line names the permission mode the run ACTUALLY had**, off the `started` record,
// rather than the one the dropdown was set to. That is D47 on screen: through a profile function
// the two differ silently (`bypassPermissions` whatever was asked for, F.9.3), and a panel that
// echoed the request back would look identical in the case the control had stopped working.
import type { AskRun } from './ask-slice.ts';

export class AskRunViewModel {
  private readonly run: AskRun;

  constructor(run: AskRun) {
    this.run = run;
  }

  public get running(): boolean {
    return this.run.running;
  }

  /** The answer so far, or a placeholder while nothing has arrived. Never empty. */
  public get answer(): string {
    if (this.run.answer !== '') return this.run.answer;
    return this.run.running ? '…' : '(no answer)';
  }

  public get notices(): readonly string[] {
    return this.run.notices;
  }

  /**
   * One line: what ran, what it was allowed to do, and what it cost.
   *
   * The permission mode is the load-bearing part. `unreported` rather than a guess when the run has
   * not said yet — a panel that filled the gap with the requested mode would be asserting the thing
   * it exists to check.
   */
  public get metaLine(): string {
    const parts = [this.run.model ?? 'model unreported', `mode: ${this.modeLabel}`];
    if (this.run.running) parts.push('running…');
    else parts.push(this.outcomeLabel);
    const cost = this.costLabel;
    if (cost !== undefined) parts.push(cost);
    return parts.join(' · ');
  }

  /**
   * What the run reported it was allowed to do.
   *
   * Flagged when it is `bypassPermissions`, because that is the value SEC-PROC-4 forbids and the
   * one a regression would produce: the day this reads `bypassPermissions` is the day Ask has been
   * quietly routed back through a profile function.
   */
  public get modeLabel(): string {
    const mode = this.run.permissionMode;
    if (mode === undefined) return this.run.running ? 'unreported' : 'never reported';
    return mode === 'bypassPermissions' ? `${mode} — UNSANDBOXED` : mode;
  }

  /** True when the run reported a mode SEC-PROC-4 forbids. The panel draws it as a warning. */
  public get unsandboxed(): boolean {
    return this.run.permissionMode === 'bypassPermissions';
  }

  /** `ended`, or why it did not. */
  public get outcomeLabel(): string {
    if (this.run.ok === true) return this.run.stopReason ?? 'ended';
    return `stopped: ${this.run.stopReason ?? 'failed'}`;
  }

  /** `$0.0135`, or `undefined` when the run has not reported one. Four places: it is cents. */
  public get costLabel(): string | undefined {
    const cost = this.run.costUsd;
    return cost === undefined ? undefined : `$${cost.toFixed(4)}`;
  }

  /** What was asked, for the heading above the answer. */
  public get prompt(): string {
    return this.run.prompt;
  }
}
