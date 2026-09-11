// One JSON object per line on stdout, which is what a Windows logon task can redirect to a file
// (DECISIONS.md D21) and what `flightdeck-core status` can parse back.
//
// `process.stdout.write` rather than `console.log`: the lint rule bans console everywhere, and the
// ban is worth keeping absolute — a stray `console.log(session)` is exactly how a transcript ends
// up in a log file (SEC-DATA-4).
import type { LogDetails, Logger } from '../ports/logger.ts';

type Level = 'info' | 'warn' | 'error';

export class ConsoleLogger implements Logger {
  private readonly stream: NodeJS.WritableStream;

  constructor(stream: NodeJS.WritableStream = process.stdout) {
    this.stream = stream;
  }

  public info(event: string, details: LogDetails = {}): void {
    this.emit('info', event, details);
  }

  public warn(event: string, details: LogDetails = {}): void {
    this.emit('warn', event, details);
  }

  public error(event: string, details: LogDetails = {}): void {
    this.emit('error', event, details);
  }

  private emit(level: Level, event: string, details: LogDetails): void {
    const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...details });
    this.stream.write(`${line}\n`);
  }
}
