// In-memory Clock — CODING-STANDARDS §10.1 (fakes, not mocks).
//
// Expiry is a real control (SEC-WS-1's ticket window), so it needs a real test, and a test that
// waits ten seconds for one is a test that gets deleted. `advance` is the whole point.
import type { Clock } from '../../core/ports/clock.ts';

export class FakeClock implements Clock {
  private current: number;

  constructor(start = Date.parse('2026-09-11T12:00:00.000Z')) {
    this.current = start;
  }

  public now(): Date {
    return new Date(this.current);
  }

  public advance(ms: number): void {
    this.current += ms;
  }
}
