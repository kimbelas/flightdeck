// In-memory SessionEnvironment — CODING-STANDARDS §10.1.
//
// `published` is a boolean and never a value, which mirrors the port: the ingest key must not be
// able to reach a plan or a test assertion any more than it can reach a log line (SEC-DATA-4).
import type { SessionEnvironment } from '../../core/ports/session-environment.ts';

export class FakeSessionEnvironment implements SessionEnvironment {
  public published = false;
  public failOnPublish = false;
  public calls: string[] = [];

  public isPublished(): boolean {
    return this.published;
  }

  public publish(): void {
    if (this.failOnPublish) throw new Error('setx refused');
    this.calls.push('publish');
    this.published = true;
  }

  public withdraw(): void {
    this.calls.push('withdraw');
    this.published = false;
  }

  public describe(): string {
    return '$FLIGHTDECK_TOKEN (fake)';
  }
}
