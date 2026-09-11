// P0-T5 / P1-T6 — merges the flightdeck block from scripts/statusline-block.py into a copy of
// ~/.claude/hooks/statusline.py, and takes it out again.
//
// SEC-ING-3 makes the change additive, so the patcher never rewrites a line it did not add: it
// inserts two marker-delimited regions at two unique anchors, and Disconnect (SEC-OPS-2) deletes
// exactly those regions. `remove(apply(source)) === source` is the test that keeps that promise
// (tests/scripts/statusline-patch.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOCK_FILE = fileURLToPath(new URL('./statusline-block.py', import.meta.url));

/** Where a region is spliced in, and the exact line it attaches to. */
interface Anchor {
  readonly line: string;
  readonly position: 'before' | 'after';
}

interface MarkerPair {
  readonly begin: string;
  readonly end: string;
}

const MODULE_ANCHOR: Anchor = { line: 'def main():', position: 'before' };
const CALL_ANCHOR: Anchor = { line: '    cache_flush()', position: 'after' };

const MODULE_MARKERS: MarkerPair = {
  begin: '# --- flightdeck begin',
  end: '# --- flightdeck end ---',
};
const CALL_MARKERS: MarkerPair = {
  begin: '# --- flightdeck call begin',
  end: '# --- flightdeck call end ---',
};

export type PatchOutcome =
  { readonly ok: true; readonly source: string } | { readonly ok: false; readonly reason: string };

type AnchorLookup =
  { readonly ok: true; readonly at: number } | { readonly ok: false; readonly reason: string };

/**
 * Applies and reverses the statusline POST block.
 *
 * Every failure is reported rather than thrown — a refusal is the correct answer when Claude
 * Code ships a statusline.py whose anchors have moved, and Connect must be able to say so
 * without a stack trace and without half-writing the file.
 */
export class StatuslinePatcher {
  private readonly moduleRegion: readonly string[];
  private readonly callRegion: readonly string[];

  constructor(blockSource: string) {
    this.moduleRegion = StatuslinePatcher.region(blockSource, MODULE_MARKERS);
    this.callRegion = StatuslinePatcher.region(blockSource, CALL_MARKERS);
  }

  /** Reads the block from scripts/statusline-block.py, the one place it is maintained. */
  public static fromRepo(): StatuslinePatcher {
    return new StatuslinePatcher(readFileSync(BLOCK_FILE, 'utf8'));
  }

  /**
   * Splits on either line ending and remembers which one won. statusline.py is CRLF on this
   * machine and the block in the repo is LF, so a patcher that ignored this would either miss
   * every anchor or write a file with mixed endings — and a mixed-ending rewrite is exactly the
   * kind of "change we did not intend" SEC-ING-3 rules out.
   */
  private static lines(source: string): {
    readonly lines: readonly string[];
    readonly eol: string;
  } {
    return {
      lines: source.split(/\r?\n/),
      eol: source.includes('\r\n') ? '\r\n' : '\n',
    };
  }

  /** Both marker lines inclusive, so `remove` deletes exactly what `apply` inserted. */
  private static region(source: string, markers: MarkerPair): readonly string[] {
    const { lines } = StatuslinePatcher.lines(source);
    const start = lines.findIndex((line) => line.trimStart().startsWith(markers.begin));
    const end = lines.findIndex((line) => line.trimStart() === markers.end);
    if (start < 0 || end < start) {
      throw new Error(`statusline-block.py is missing the "${markers.begin}" region`);
    }
    return lines.slice(start, end + 1);
  }

  private static findAnchor(lines: readonly string[], anchor: Anchor): AnchorLookup {
    const hits = lines.filter((line) => line === anchor.line).length;
    if (hits !== 1) {
      const found = String(hits);
      return { ok: false, reason: `anchor ${JSON.stringify(anchor.line)} matched ${found} lines` };
    }
    const index = lines.indexOf(anchor.line);
    return { ok: true, at: anchor.position === 'before' ? index : index + 1 };
  }

  /** Inserts the region plus one blank line, which `skipRegion` knows to take back out. */
  private static splice(
    lines: readonly string[],
    at: number,
    region: readonly string[],
  ): readonly string[] {
    return [...lines.slice(0, at), ...region, '', ...lines.slice(at)];
  }

  private static isBegin(line: string): boolean {
    const text = line.trimStart();
    return text.startsWith(MODULE_MARKERS.begin) || text.startsWith(CALL_MARKERS.begin);
  }

  private static isEnd(line: string): boolean {
    const text = line.trimStart();
    return text === MODULE_MARKERS.end || text === CALL_MARKERS.end;
  }

  /** The index just past the region starting at `from`, and past the blank line after it. */
  private static skipRegion(lines: readonly string[], from: number): number {
    let index = from;
    while (index < lines.length && !StatuslinePatcher.isEnd(lines[index] ?? '')) index += 1;
    index += 1;
    return (lines[index] ?? 'x') === '' ? index + 1 : index;
  }

  public isApplied(source: string): boolean {
    return source.includes(MODULE_MARKERS.begin);
  }

  public apply(source: string): PatchOutcome {
    if (this.isApplied(source)) return { ok: false, reason: 'already patched' };
    const { lines, eol } = StatuslinePatcher.lines(source);

    // The call site is spliced first: inserting the module region above `def main():` shifts
    // every line below it, and doing the lower edit first keeps both offsets honest.
    const call = StatuslinePatcher.findAnchor(lines, CALL_ANCHOR);
    if (!call.ok) return call;
    const withCall = StatuslinePatcher.splice(lines, call.at, this.callRegion);

    const module = StatuslinePatcher.findAnchor(withCall, MODULE_ANCHOR);
    if (!module.ok) return module;
    const patched = StatuslinePatcher.splice(withCall, module.at, this.moduleRegion);
    return { ok: true, source: patched.join(eol) };
  }

  public remove(source: string): PatchOutcome {
    if (!this.isApplied(source)) return { ok: false, reason: 'not patched' };
    const { lines, eol } = StatuslinePatcher.lines(source);
    const kept: string[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (StatuslinePatcher.isBegin(line)) {
        index = StatuslinePatcher.skipRegion(lines, index);
        continue;
      }
      kept.push(line);
      index += 1;
    }
    return { ok: true, source: kept.join(eol) };
  }
}
