// Adding the remaps to a `keybindings.json`, and taking them back out — P5a-T7, SEC-FS-3.
//
// The same shape as `HooksBlock` (P1-T11) and for the same reason: the merge and its exact inverse
// belong to one class, because "additive and reversible" is a claim about the pair of them. A
// remove written somewhere else is a remove that drifts from what the add wrote.
//
// **It only ever removes what it would have written.** Not "the Global block", not "every chord" —
// the exact `from: null` and `to: action` pairs from RECLAIMED_KEYS, and a context block only if
// taking those out leaves it empty. An owner who bound `ctrl+x ctrl+t` to something else keeps it.
import {
  RECLAIMED_KEYS,
  type KeybindingContext,
  type KeybindingsFile,
} from '../../contracts/keybinding-plan.ts';

export class KeybindingBlock {
  /** Whether every remap is already present, so the caller can say "nothing to do" rather than write. */
  public isApplied(file: KeybindingsFile): boolean {
    return RECLAIMED_KEYS.every((remap) => {
      const found = file.bindings.find((block) => block.context === remap.context);
      return found?.bindings[remap.from] === null && found.bindings[remap.to] === remap.action;
    });
  }

  /** Whether any part of it is present — what "remove" needs to know before it claims work. */
  public isPresent(file: KeybindingsFile): boolean {
    return RECLAIMED_KEYS.some((remap) => {
      const found = file.bindings.find((block) => block.context === remap.context);
      return found?.bindings[remap.from] === null || found?.bindings[remap.to] === remap.action;
    });
  }

  public add(file: KeybindingsFile): KeybindingsFile {
    const blocks = file.bindings.map((block) => ({
      context: block.context,
      bindings: { ...block.bindings },
    }));
    for (const remap of RECLAIMED_KEYS) {
      let found = blocks.find((block) => block.context === remap.context);
      if (found === undefined) {
        found = { context: remap.context, bindings: {} };
        blocks.push(found);
      }
      found.bindings[remap.from] = null;
      found.bindings[remap.to] = remap.action;
    }
    return { bindings: blocks, rest: file.rest };
  }

  public remove(file: KeybindingsFile): KeybindingsFile {
    const blocks: { context: string; bindings: Record<string, string | null> }[] =
      file.bindings.map((block) => ({ context: block.context, bindings: { ...block.bindings } }));
    for (const remap of RECLAIMED_KEYS) {
      const found = blocks.find((block) => block.context === remap.context);
      if (found === undefined) continue;
      // Value-checked, not key-checked, and rebuilt rather than deleted from: an owner who rebound
      // `ctrl+t` to something of their own after running this keeps it, and key order is preserved
      // for everything that stays, which is what keeps the diff readable.
      found.bindings = Object.fromEntries(
        Object.entries(found.bindings).filter(
          ([key, action]) =>
            !(key === remap.from && action === null) &&
            !(key === remap.to && action === remap.action),
        ),
      );
    }
    return {
      bindings: blocks.filter((block) => Object.keys(block.bindings).length > 0),
      rest: file.rest,
    };
  }

  /** The file as it will be written — `bindings` last, so a reader meets the schema links first. */
  public print(file: KeybindingsFile, blocks: readonly KeybindingContext[]): unknown {
    return { ...file.rest, bindings: blocks };
  }
}
