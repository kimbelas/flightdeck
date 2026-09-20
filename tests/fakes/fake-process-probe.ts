// Which pids are alive — the fake for `ProcessProbe` (CODING-STANDARDS §10.1).
//
// The alternative in a test is spawning something and killing it, which makes a test about preview
// routing into a test about process lifetimes on the CI runner.
import type { ProcessProbe } from '../../core/ports/process-probe.ts';

export class FakeProcessProbe implements ProcessProbe {
  /** Every pid asked about, in order. */
  public readonly asked: number[] = [];

  private readonly alive = new Set<number>();

  public willBeAlive(pid: number): this {
    this.alive.add(pid);
    return this;
  }

  public isAlive(pid: number): boolean {
    this.asked.push(pid);
    return this.alive.has(pid);
  }
}
