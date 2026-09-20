// `ProcessProbe`, as the null signal — P5a-T4.
//
// Signal 0 sends nothing; it asks the kernel to run the permission and existence checks it would
// run before delivering a real one. So `ESRCH` is "no such process" and **`EPERM` is a process
// that exists and is not ours** — which has to read as ALIVE, not as dead. On Windows the
// supervisor always is ours (core runs as the owner, SEC-OPS-3), so EPERM should not arise here;
// treating it as alive anyway costs one doomed spawn in a case that cannot happen, while the other
// reading would route every preview to the transcript on a machine where it did.
import type { ProcessProbe } from '../../ports/process-probe.ts';

export class SignalProcessProbe implements ProcessProbe {
  /** @throws never — see the port. */
  public isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      return codeOf(error) === 'EPERM';
    }
  }
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}
