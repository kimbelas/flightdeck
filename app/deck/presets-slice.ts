// The deck's fifth fetch path, as a class of its own — P4-T1.
//
// `WorkflowMapSlice` and `PreviewSlice` set the shape and the reason is unchanged: `DeckStore` owns
// the stream, the retry and the session verbs, and it is at its line limit. Three more methods on
// it would be the change that makes that file unreadable rather than merely long.
//
// **It is a slice, not a second store.** There is one `DeckState` and one set of subscribers; this
// is handed the API port and a way to publish, and holds nothing of its own.
//
// **Replaced wholesale, never merged**, which is every project read's rule here: core answers about
// every imported folder, and a merge would leave a preset on screen for a project that has just
// been forgotten — which core has already deleted the row for (the store's cascade).
//
// **A reply that cannot be read leaves what is held alone.** An empty list is not a real state here
// — every imported project has four built-ins — but a project list that is genuinely empty is, so
// the rule is the same one `loadProjects` follows: rendering nothing because a request failed would
// say something false about the machine rather than about the request.
import { CORE_PRESET_FORGET_PATH, CORE_PRESETS_PATH } from '../../contracts/deck-routes.ts';
import {
  parseLaunchPresetList,
  parsePresetRefusal,
  type LaunchPreset,
  type PresetDraft,
  type PresetRef,
  type PresetRefusal,
} from '../../contracts/launch-preset.ts';
import type { DeckApi } from './deck-api.ts';

/** The two fields of `DeckState` this slice owns. */
export interface PresetsHeld {
  readonly presets: readonly LaunchPreset[];
  readonly presetRefusal: PresetRefusal | undefined;
}

export class PresetsSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: Partial<PresetsHeld>) => void;

  /**
   * @param publish what to do with a change. A callback rather than the store itself, so this can
   * be unit-tested against a function and knows nothing about `DeckState`.
   */
  constructor(api: DeckApi, publish: (changes: Partial<PresetsHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /** Re-reads every imported folder's presets. Called beside the registry read, never on a timer. */
  public async load(): Promise<void> {
    const reply = await this.api.get(CORE_PRESETS_PATH);
    if (reply?.status !== 200) return;
    this.publish({ presets: parseLaunchPresetList(reply.body) });
  }

  /**
   * Saves one, then re-reads.
   *
   * The list is re-read rather than patched locally, for `forgetProject`'s reason: what core holds
   * is core's answer, and a deck that inserted the row itself would be guessing at the outcome of a
   * write — including whether it replaced a built-in or a row that was already there.
   *
   * @returns whether it was saved. The refusal, when there is one, goes into `presetRefusal` for
   * `PresetsViewModel` to put into English — core's own closed union, never a sentence core wrote.
   */
  public async save(draft: PresetDraft): Promise<boolean> {
    this.publish({ presetRefusal: undefined });
    const reply = await this.api.post(CORE_PRESETS_PATH, draft);
    if (reply?.status === 201) {
      await this.load();
      return true;
    }
    // `empty` for a request that reached nobody and for a code this build does not know — both
    // render as the generic sentence rather than as silence.
    this.publish({ presetRefusal: parsePresetRefusal(reply?.body) ?? 'empty' });
    return false;
  }

  /** Removes one saved preset, then re-reads. The built-in it was shadowing comes back. */
  public async forget(ref: PresetRef): Promise<void> {
    const reply = await this.api.post(CORE_PRESET_FORGET_PATH, ref);
    if (reply === undefined) return;
    await this.load();
  }
}
