// In-memory SourcePatcher — CODING-STANDARDS §10.1.
//
// The real one is `StatuslinePatcher`, which needs a 506-line file with two exact anchors to do
// anything interesting. This one makes the branch that matters easy to reach: `refuseWith`, the
// anchor that has moved (F.3.7), which is the case Connect must report rather than guess past.
import type { PatchOutcome, SourcePatcher } from '../../core/ports/source-patcher.ts';

const MARK = '# patched';

export class FakeSourcePatcher implements SourcePatcher {
  public refuseWith: string | undefined;

  public isApplied(source: string): boolean {
    return source.includes(MARK);
  }

  public apply(source: string): PatchOutcome {
    if (this.refuseWith !== undefined) return { ok: false, reason: this.refuseWith };
    return { ok: true, source: `${source}\n${MARK}` };
  }

  public remove(source: string): PatchOutcome {
    if (this.refuseWith !== undefined) return { ok: false, reason: this.refuseWith };
    return { ok: true, source: source.replace(`\n${MARK}`, '') };
  }
}
