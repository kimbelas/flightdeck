// The instruction stack — SPEC §5.1's first row, in resolution order with byte sizes (P3-T3).
//
// **The order is the answer.** Five files can tell Claude what to do in one repository, they are
// merged rather than overridden, and the question the row exists to settle is which of them is
// speaking when two disagree. A set of filenames with sizes would be a directory listing; the
// order is what makes it a stack.
//
// **The two user files are alternatives, not a pair.** A session runs under exactly one
// `CLAUDE_CONFIG_DIR`, so `~/.claude-365/CLAUDE.md` and `~/.claude-isg/CLAUDE.md` never both
// apply — both are listed because the deck shows both subscriptions and the owner's question is
// "what does Claude do in this repo", which has two answers on this machine. That they currently
// hold the same 683-byte import of one canonical file is a fact about today, not something this
// type may assume.
//
// **Sizes in bytes, from `stat`, never from reading the file.** What the row shows is how much of
// the context window each file spends, and the whole point of not reading them is that the largest
// of them is the one it would be most expensive to read. A file core cannot open still has a size.
//
// **Absent is a value.** A repository with no `AGENTS.md` and no `soul.md` is the ordinary case,
// and `docs-tool` — the P3 gate's degrade-gracefully half — has only a `CLAUDE.md`. So every
// source is reported, present or not, and the deck draws the gaps: a stack that silently omitted
// what is missing could not answer "does this repo have a CLAUDE.md at all", which is the
// cross-project question SPEC §5.1's enhancements name.

/**
 * Every file that can speak, in the order Claude Code resolves them.
 *
 * User scope first because it is the outermost: it applies to every repository on that
 * subscription and the project's own files are read on top of it. `CLAUDE.md` before `AGENTS.md`
 * because the first is Claude Code's own and the second is the cross-tool convention it also
 * reads; `soul.md` last because it is a `.claude/` convention of the repository's own making and
 * is the most specific thing in the stack.
 */
export const INSTRUCTION_SOURCES = [
  'user-365',
  'user-isg',
  'claude-md',
  'agents-md',
  'soul-md',
] as const;

export type InstructionSource = (typeof INSTRUCTION_SOURCES)[number];

export interface InstructionFile {
  readonly source: InstructionSource;
  /**
   * Size in bytes, or `undefined` when the file is not there.
   *
   * `undefined` rather than `0`: an empty `CLAUDE.md` somebody created and never filled in is a
   * different thing from no `CLAUDE.md`, and only one of the two is worth a nudge.
   */
  readonly bytes: number | undefined;
}

/**
 * The stack from a `GET /projects/map` body, in `INSTRUCTION_SOURCES` order.
 *
 * Rebuilt in the declared order rather than trusted from the wire, which is what makes the order a
 * property of this build rather than of whatever answered: a reply that listed them backwards
 * would still draw correctly, and a source this build does not know is dropped rather than shown
 * under a heading that does not exist.
 *
 * @throws never.
 */
export function parseInstructionStack(value: unknown): readonly InstructionFile[] {
  const sizes = new Map<string, number>();
  if (Array.isArray(value)) {
    for (const entry of value) collect(sizes, entry);
  }
  return INSTRUCTION_SOURCES.map((source) => {
    const bytes = sizes.get(source);
    return bytes === undefined ? { source, bytes: undefined } : { source, bytes };
  });
}

/** One wire entry into the map. A size that is not a whole count of bytes is an absent file. */
function collect(sizes: Map<string, number>, entry: unknown): void {
  if (typeof entry !== 'object' || entry === null) return;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(entry));
  const source = fields['source'];
  const bytes = fields['bytes'];
  if (typeof source !== 'string') return;
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return;
  sizes.set(source, Math.trunc(bytes));
}
