// Silent Logger — CODING-STANDARDS §10.1.
//
// Promoted out of tests/core/adapters/claude-cli-session-source.test.ts, which built one by
// casting a `{ write }` object into a `NodeJS.WritableStream` to keep ConsoleLogger quiet. That
// cast is banned in core (§4, no `as`) and it made a test that wanted silence depend on the
// logger's output format. This implements the port instead, and keeps the lines so a test can
// assert that a refusal was logged without asserting how it was spelled.
import type { LogDetails, Logger } from '../../core/ports/logger.ts';

export interface LoggedLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  readonly details: LogDetails;
}

export class FakeLogger implements Logger {
  public readonly lines: LoggedLine[] = [];

  public get last(): LoggedLine | undefined {
    return this.lines.at(-1);
  }

  /** Every line logged at `level`, in order. */
  public at(level: LoggedLine['level']): readonly LoggedLine[] {
    return this.lines.filter((line) => line.level === level);
  }

  /** Whether anything was logged under `event` — the usual assertion, without the wording. */
  public logged(event: string): boolean {
    return this.lines.some((line) => line.event === event);
  }

  public info(event: string, details: LogDetails = {}): void {
    this.lines.push({ level: 'info', event, details });
  }

  public warn(event: string, details: LogDetails = {}): void {
    this.lines.push({ level: 'warn', event, details });
  }

  public error(event: string, details: LogDetails = {}): void {
    this.lines.push({ level: 'error', event, details });
  }
}
