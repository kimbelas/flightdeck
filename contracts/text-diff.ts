// A unified diff of two whole files, so Connect can show what it would do (D13, SEC-FS-3).
//
// **In contracts/ because two sides render it.** `npm run connect` prints it to a terminal and the
// deck's Connect panel draws it in a `<details>` (P4-T6), and contracts/ is the only folder both
// TypeScript projects compile — `tsconfig.app.json` cannot see `core/shared/`, which is where this
// lived until then. Two diff implementations would be two accounts of the same write, and the
// whole promise is that the owner approved THE diff.
//
// Hand-written rather than a dependency for the reason the repo keeps giving: this is one screen
// of pure code with one test, and the alternative is a package on the critical path of the one
// command that edits the owner's live config. It renders whole-file before/after pairs — never a
// summary — because "here is what changes" is the only claim a diff is allowed to make.
//
// Plain LCS over lines. Both files here are hundreds of lines, not millions, and the table is
// gone before the caller prints anything.

export interface DiffOptions {
  /** Unchanged lines kept either side of a change. Three, as every diff tool has always used. */
  readonly context?: number;
}

/** Unified-diff text, or the empty string when the two sides are identical. */
export function unifiedDiff(before: string, after: string, options: DiffOptions = {}): string {
  const context = options.context ?? 3;
  const left = before.split('\n');
  const right = after.split('\n');
  const ops = diffLines(left, right);
  if (!ops.some((op) => op.kind !== 'same')) return '';
  return renderHunks(ops, context).join('\n');
}

type Op =
  | { readonly kind: 'same'; readonly text: string }
  | { readonly kind: 'add'; readonly text: string }
  | { readonly kind: 'remove'; readonly text: string };

/** Longest common subsequence, walked back into an edit script. */
function diffLines(left: readonly string[], right: readonly string[]): readonly Op[] {
  const table = lcsTable(left, right);
  const score = (i: number, j: number): number => table[i]?.[j] ?? 0;
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (lineAt(left, i) === lineAt(right, j)) {
      ops.push({ kind: 'same', text: lineAt(left, i) });
      i += 1;
      j += 1;
    } else if (score(i + 1, j) >= score(i, j + 1)) {
      ops.push({ kind: 'remove', text: lineAt(left, i) });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: lineAt(right, j) });
      j += 1;
    }
  }
  // Whatever is left on one side is a pure insertion or a pure deletion; neither needs the table.
  return [...ops, ...runOf('remove', left, i), ...runOf('add', right, j)];
}

/** `noUncheckedIndexedAccess` makes every index optional; this is the one place that answers it. */
function lineAt(lines: readonly string[], index: number): string {
  return lines[index] ?? '';
}

function runOf(kind: 'add' | 'remove', lines: readonly string[], from: number): readonly Op[] {
  return lines.slice(from).map((text) => ({ kind, text }));
}

function lcsTable(
  left: readonly string[],
  right: readonly string[],
): readonly (readonly number[])[] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const next = table[i + 1];
      if (row === undefined || next === undefined) continue;
      row[j] =
        left[i] === right[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

const MARKS: Readonly<Record<Op['kind'], string>> = { same: ' ', add: '+', remove: '-' };

/** Runs of change with `context` unchanged lines around them, each under an `@@` header. */
function renderHunks(ops: readonly Op[], context: number): readonly string[] {
  const changed = ops.map((op) => op.kind !== 'same');
  const keep = ops.map((unused, index) =>
    changed.slice(Math.max(0, index - context), index + context + 1).includes(true),
  );

  const lines: string[] = [];
  let leftNo = 1;
  let rightNo = 1;
  let open = false;
  ops.forEach((op, index) => {
    if (keep[index] === true) {
      if (!open) {
        lines.push(`@@ -${String(leftNo)} +${String(rightNo)} @@`);
        open = true;
      }
      lines.push(`${MARKS[op.kind]}${op.text}`);
    } else {
      open = false;
    }
    if (op.kind !== 'add') leftNo += 1;
    if (op.kind !== 'remove') rightNo += 1;
  });
  return lines;
}
