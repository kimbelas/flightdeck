// The hooks block Connect merges into `$CFG/settings.json`, and takes back out (P1-T11, D13).
//
// Two rules shape everything here, and both come from the file belonging to somebody else.
//
// **Additive.** The owner already has a `PreToolUse` command hook and a `statusLine` in both
// config dirs. Connect appends its own entries beside them and touches nothing else; Disconnect
// removes exactly what Connect added and leaves the rest, including an event array Flightdeck
// shares with a handler the owner wrote (SEC-FS-3, SEC-ING-3).
//
// **Recognised by target, not by a marker.** JSON has no comments, and an extra field on a hook
// entry is a field Claude Code's own schema did not ask for. So a handler is Flightdeck's if and
// only if it is an `http` handler pointing at `CORE_HOOKS_URL` — which is also the only property
// that makes it ours in any sense that matters.
import {
  CONNECTED_EVENTS,
  CORE_HOOKS_URL,
  flightdeckHandler,
} from '../../contracts/connect-plan.ts';

/** A JSON object, as it comes back from `JSON.parse`, before anything is believed about it. */
type JsonObject = Record<string, unknown>;

export class HooksBlock {
  /**
   * The settings object with Flightdeck's handlers merged in.
   *
   * Returns a new object rather than mutating: the caller still holds the original to diff
   * against, and a planner that had already edited its own input could not show a `before`.
   */
  public merge(settings: JsonObject): JsonObject {
    const hooks = asObject(settings['hooks']) ?? {};
    const merged: JsonObject = { ...hooks };
    for (const event of CONNECTED_EVENTS) {
      const existing = asArray(hooks[event]) ?? [];
      // Appended, not prepended: the owner's handlers run first, and a hook of ours that is slow
      // or wrong must not delay one of theirs.
      merged[event] = [...withoutOurs(existing), { hooks: [flightdeckHandler()] }];
    }
    return { ...settings, hooks: merged };
  }

  /**
   * The settings object with Flightdeck's handlers removed, and nothing else changed.
   *
   * An event array that becomes empty is deleted, and a `hooks` object that becomes empty is
   * deleted too — so Disconnect on a settings.json that had no hooks before Connect leaves no
   * `"hooks": {}` behind. `remove(merge(x))` is `x`, and that is the test (hooks-block.test.ts).
   */
  public remove(settings: JsonObject): JsonObject {
    const hooks = asObject(settings['hooks']);
    if (hooks === undefined) return { ...settings };

    const kept: JsonObject = {};
    for (const [event, entries] of Object.entries(hooks)) {
      const survivors = withoutOurs(asArray(entries) ?? []);
      // A non-array value was never ours and is put back untouched rather than normalised.
      if (asArray(entries) === undefined) kept[event] = entries;
      else if (survivors.length > 0) kept[event] = survivors;
    }

    const rest: JsonObject = { ...settings };
    if (Object.keys(kept).length === 0) delete rest['hooks'];
    else rest['hooks'] = kept;
    return rest;
  }

  public isApplied(settings: JsonObject): boolean {
    const hooks = asObject(settings['hooks']);
    if (hooks === undefined) return false;
    return Object.values(hooks).some((entries) => (asArray(entries) ?? []).some(isOurEntry));
  }
}

/**
 * Entries with every Flightdeck handler taken out, and entries emptied by that dropped.
 *
 * An entry the owner wrote that happens to sit in one of our events survives untouched; an entry
 * that held our handler alongside one of theirs keeps theirs.
 */
function withoutOurs(entries: readonly unknown[]): readonly unknown[] {
  const kept: unknown[] = [];
  for (const entry of entries) {
    const object = asObject(entry);
    const handlers = object === undefined ? undefined : asArray(object['hooks']);
    if (object === undefined || handlers === undefined) {
      kept.push(entry);
      continue;
    }
    const theirs = handlers.filter((handler) => !isOurHandler(handler));
    if (theirs.length === handlers.length) kept.push(entry);
    else if (theirs.length > 0) kept.push({ ...object, hooks: theirs });
  }
  return kept;
}

function isOurEntry(entry: unknown): boolean {
  const object = asObject(entry);
  if (object === undefined) return false;
  return (asArray(object['hooks']) ?? []).some(isOurHandler);
}

function isOurHandler(handler: unknown): boolean {
  const object = asObject(handler);
  if (object === undefined) return false;
  return object['type'] === 'http' && object['url'] === CORE_HOOKS_URL;
}

/** `null` is an object to `typeof` and an array is one to both; neither is what this asks. */
function asObject(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
