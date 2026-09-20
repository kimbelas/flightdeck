// The three preset routes — `GET`, `POST` and `POST …/forget` (P4-T1).
//
// Three classes in one file, as `keybindings-route.ts` already does, because they are three verbs
// over one thing and `RequestRouter` matches method and path literally: a GET that could not write
// and a POST that could are separate rows in the table that says what is reachable, and folding
// them into one handler with a branch would put the decision inside the thing being decided about.
//
// **The ports are interfaces over one method each**, for `ProjectSource`'s reason: a test of "the
// list comes back as `{ presets }`" should not have to build a store, a registry, a clock, an
// audit log and a path canonicaliser.
import {
  parsePresetDraft,
  parsePresetRef,
  type LaunchPreset,
  type PresetDraft,
  type PresetRef,
  type PresetRefusal,
} from '../../contracts/launch-preset.ts';
import type { RouteLimit } from './limits.ts';
import type { Credential, RequestFacts } from './loopback-guard.ts';
import type { Result } from '../shared/result.ts';
import { json, type JsonResponse, type Route } from './route.ts';

/** Reading the merged list — built-ins and saved together (`PresetBook.list`). */
export interface PresetSource {
  list(): readonly LaunchPreset[];
}

/** Writing one. Async because saving resolves two real paths before it writes anything. */
export interface PresetWriter {
  save(draft: PresetDraft): Promise<Result<LaunchPreset, PresetRefusal>>;
}

/** Removing one. A built-in has no row and answers `false`. */
export interface PresetRemover {
  forget(ref: PresetRef): boolean;
}

/**
 * `GET /projects/presets` — every preset for every imported folder.
 *
 * All of them in one request rather than one per project, exactly as `/projects/status` and
 * `/projects/map` are: the deck draws every row at once, the answer is computed from memory plus
 * one keyed table, and N round trips through the rewrite for a list of four would be three more
 * than are needed.
 */
export class PresetsRoute implements Route {
  public readonly method = 'GET';
  public readonly path = '/projects/presets';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly book: PresetSource;

  constructor(book: PresetSource) {
    this.book = book;
  }

  /** Wrapped in an object, never a bare array — a top-level JSON array cannot grow a field. */
  public handle(): JsonResponse {
    return json(200, { presets: this.book.list() });
  }
}

/** `POST /projects/presets` — save one, or say which closed refusal code applies. */
export class SavePresetRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/projects/presets';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly book: PresetWriter;

  constructor(book: PresetWriter) {
    this.book = book;
  }

  /**
   * @returns 201 with the stored preset, or 400 with a `PresetRefusal`.
   *
   * 201 even when the save REPLACED a row, and even when it shadowed a built-in. The status
   * describes the outcome the caller asked for — there is now a preset at this name — and the deck
   * re-reads the list rather than reasoning about which of the three happened. That is the same
   * reading `ImportProjectRoute` takes of a re-import.
   *
   * No 503 branch: nothing here spawns a process, so `no_claude` has no analogue. The facts go
   * unread for `LaunchRoute`'s reason — CoreServer has already screened the request.
   */
  public async handle(facts: RequestFacts, body: string): Promise<JsonResponse> {
    const draft = parsePresetDraft(body);
    if (draft === undefined) return json(400, { error: 'empty' });
    const saved = await this.book.save(draft);
    return saved.ok ? json(201, { preset: saved.value }) : json(400, { error: saved.error });
  }
}

/**
 * `POST /projects/presets/forget` — remove one saved preset.
 *
 * Its own literal path and a POST, for the reasons `ForgetProjectRoute` gives at length: the
 * router has no patterns and no `DELETE` handling, and every control that protects a mutation is a
 * POST control. No confirmation step is involved here and none should be — forgetting a preset
 * removes a button, and the built-in it was shadowing comes back.
 */
export class ForgetPresetRoute implements Route {
  public readonly method = 'POST';
  public readonly path = '/projects/presets/forget';
  public readonly limit: RouteLimit = 'control';

  public readonly credential: Credential = 'token';
  private readonly book: PresetRemover;

  constructor(book: PresetRemover) {
    this.book = book;
  }

  /**
   * @returns 200 with whether a row was removed.
   *
   * Not a 404 for a preset that was not saved, for `ForgetProjectRoute`'s reason: the request asked
   * for a state, and that state holds either way. The boolean is there because "removed" and "that
   * one is built in" are different sentences to put on screen.
   */
  public handle(facts: RequestFacts, body: string): JsonResponse {
    const ref = parsePresetRef(body);
    if (ref === undefined) return json(400, { error: 'empty' });
    return json(200, { forgotten: this.book.forget(ref) });
  }
}
