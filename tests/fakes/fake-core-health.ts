// In-memory CoreHealth — CODING-STANDARDS §10.1.
//
// One boolean, because the rule it serves is one branch: Connect refuses while core is down
// (RESEARCH.md F.1.5) and Disconnect never asks.
import type { CoreHealth } from '../../core/ports/core-health.ts';

export class FakeCoreHealth implements CoreHealth {
  public running: boolean;
  public asked = 0;

  constructor(running = true) {
    this.running = running;
  }

  public isRunning(): Promise<boolean> {
    this.asked += 1;
    return Promise.resolve(this.running);
  }
}
