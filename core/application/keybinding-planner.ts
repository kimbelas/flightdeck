// What the keyboard helper would write, without writing any of it — P5a-T7, D13, SEC-FS-3.
//
// `ConnectPlanner`'s shape, deliberately: whole before/after pairs, every failure a refusal rather
// than a throw, and nothing here opens a file. The `FileChange` and `PlanRefusal` types are
// Connect's own, imported rather than copied — two plan shapes that rendered differently would be
// two diff views for the same promise, and the promise (the owner sees it before a byte moves) is
// the thing D13 is about.
import type { FileChange, PlanRefusal } from '../../contracts/connect-plan.ts';
import {
  KEYBINDINGS_DOCS,
  KEYBINDINGS_SCHEMA,
  parseKeybindingsFile,
  type KeybindingDirection,
  type KeybindingPlan,
  type KeybindingsFile,
} from '../../contracts/keybinding-plan.ts';
import { JsonFormat } from '../shared/json-format.ts';
import { KeybindingBlock } from './keybinding-block.ts';

/** One config dir's keybindings.json, as read. `contents` is `undefined` when it is not there. */
export interface KeybindingSource {
  readonly subscription: string;
  readonly path: string;
  readonly contents: string | undefined;
}

export class KeybindingPlanner {
  private readonly sources: readonly KeybindingSource[];
  private readonly block = new KeybindingBlock();

  constructor(sources: readonly KeybindingSource[]) {
    this.sources = sources;
  }

  public apply(): KeybindingPlan {
    return this.plan('apply');
  }

  /** The exact inverse, file for file. */
  public restore(): KeybindingPlan {
    return this.plan('restore');
  }

  private plan(direction: KeybindingDirection): KeybindingPlan {
    const changes: FileChange[] = [];
    const alreadyDone: string[] = [];
    const refusals: PlanRefusal[] = [];

    for (const source of this.sources) {
      const change = this.changeFor(source, direction, alreadyDone);
      if (change === undefined) continue;
      if ('reason' in change) refusals.push(change);
      else changes.push(change);
    }

    // One refusal fails the whole plan rather than half of it applying: the two subscriptions are
    // one keyboard, and a Ctrl+T that moved on 365 and not on isg is worse than one that did not
    // move at all, because it is now unpredictable per session.
    if (refusals.length > 0) return { ok: false, refusals };
    return { ok: true, changes, alreadyDone };
  }

  private changeFor(
    source: KeybindingSource,
    direction: KeybindingDirection,
    alreadyDone: string[],
  ): FileChange | PlanRefusal | undefined {
    const absent = source.contents === undefined;
    if (absent && direction === 'restore') {
      alreadyDone.push(source.path);
      return undefined;
    }

    const before = source.contents ?? '';
    const file = absent ? emptyFile() : parseKeybindingsFile(before);
    if (file === undefined) {
      return {
        path: source.path,
        reason:
          'not a keybindings.json this can rewrite — it does not parse, or its "bindings" is not ' +
          'an array of {context, bindings} blocks. Left alone.',
      };
    }

    const done = direction === 'apply' ? this.block.isApplied(file) : !this.block.isPresent(file);
    if (done) {
      alreadyDone.push(source.path);
      return undefined;
    }

    const next = direction === 'apply' ? this.block.add(file) : this.block.remove(file);
    // G.13: re-print in the ORIGINAL file's line endings, indent and trailing newline. A new file
    // gets the defaults, which is what `JsonFormat.of('')` gives.
    const format = JsonFormat.of(before);
    return {
      path: source.path,
      label: `${source.subscription} keybindings.json`,
      before,
      after: format.print(this.block.print(next, next.bindings)),
    };
  }
}

/**
 * The file written when there is none: the two schema links, then `bindings`.
 *
 * The links are not decoration. Claude Code validates against `$schema` and the skill that edits
 * this file by hand expects both — a file this project created without them is a file that looks
 * hand-rolled to the next thing that opens it.
 */
function emptyFile(): KeybindingsFile {
  return { bindings: [], rest: { $schema: KEYBINDINGS_SCHEMA, $docs: KEYBINDINGS_DOCS } };
}
