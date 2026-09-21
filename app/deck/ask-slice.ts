// The Ask panel's state — P4-T4, D48.
//
// `PresetsSlice`'s sibling and a slice for the same reason: `DeckStore` owns the stream, the retry
// and the session verbs, and it is at its line limit. What is different here is that this slice
// has two inputs rather than one — it POSTs the question and then receives the answer as `ask`
// frames off the stream the store already holds, so the store hands it both a way to send and a
// way to be told.
//
// **The answer is accumulated from the DELTAS, and the complete `text` blocks are ignored.** Both
// arrive: `--include-partial-messages` streams `content_block_delta` tokens as they are written,
// and an `assistant` record follows carrying the same sentence whole. Appending both would print
// every answer twice. The deltas are what make the panel fill while the run works, so they win,
// and `text` is kept only as the fallback for a run that produced no deltas at all — which is what
// a run without `--include-partial-messages` would do, and what a cached or refused turn does.
//
// **A record for a run that is not the current one is DROPPED.** Core allows one run at a time, so
// this is not defensive: it is what keeps a late frame from a run the owner has already replaced
// out of the panel they are reading now.
import { CORE_RUN_PATH } from '../../contracts/deck-routes.ts';
import { MAX_ASK_ANSWER_CHARS, type AskFrame, type AskRecord } from '../../contracts/ask-record.ts';
import {
  parseAskAccepted,
  parseAskRefusal,
  type AskRefusal,
  type AskRequest,
} from '../../contracts/ask-run.ts';
import type { DeckApi } from './deck-api.ts';

/** One run, as the panel draws it. `undefined` in `DeckState` until the owner asks something. */
export interface AskRun {
  readonly runId: string;
  /** What was asked, kept so the panel can show the question above its answer. */
  readonly prompt: string;
  /** The answer so far, built from the deltas. */
  readonly answer: string;
  /** Whether the run is still going. Drives the button and the spinner. */
  readonly running: boolean;
  /** What the run was allowed to do, off the `started` record — the D47 field, on screen. */
  readonly permissionMode: string | undefined;
  readonly model: string | undefined;
  /** Notices the CLI raised beside the answer, newest last. */
  readonly notices: readonly string[];
  /** Set once the run ends. `false` means it stopped on an error, a budget or the timeout. */
  readonly ok: boolean | undefined;
  readonly costUsd: number | undefined;
  readonly stopReason: string | undefined;
  /** True once any delta has arrived — see the header for why `text` is only a fallback. */
  readonly streamed: boolean;
}

/** The two fields of `DeckState` this slice owns. */
export interface AskHeld {
  readonly ask: AskRun | undefined;
  readonly askRefusal: AskRefusal | undefined;
}

export class AskSlice {
  private readonly api: DeckApi;
  private readonly publish: (changes: Partial<AskHeld>) => void;
  private current: AskRun | undefined;

  constructor(api: DeckApi, publish: (changes: Partial<AskHeld>) => void) {
    this.api = api;
    this.publish = publish;
  }

  /**
   * Sends the question and opens a run.
   *
   * It does NOT wait for the answer: core replies 202 with a run id in milliseconds and the records
   * arrive on the stream (D48). So this resolves as soon as the run was accepted, and everything
   * after that comes through `receive`.
   *
   * @returns whether it was accepted. The refusal goes into `askRefusal` as core's own code.
   */
  public async ask(draft: AskRequest): Promise<boolean> {
    this.publish({ askRefusal: undefined });
    const reply = await this.api.post(CORE_RUN_PATH, draft);
    const accepted = reply?.status === 202 ? parseAskAccepted(reply.body) : undefined;
    if (accepted === undefined) {
      // `empty` for a request that reached nobody and for a code this build does not know — both
      // render as the generic sentence rather than as silence. `PresetsSlice`'s rule.
      this.publish({ askRefusal: parseAskRefusal(reply?.body) ?? 'empty' });
      return false;
    }
    this.current = opened(accepted.runId, draft.prompt);
    this.publish({ ask: this.current });
    return true;
  }

  /**
   * One `ask` frame off the stream.
   *
   * A frame for any run but the current one is dropped — see the header. So is a frame that
   * arrives before this deck sent anything, which is what a second tab's run looks like from here.
   */
  public receive(frame: AskFrame): void {
    const held = this.current;
    if (frame.runId !== held?.runId) return;
    this.current = applied(held, frame.record);
    this.publish({ ask: this.current });
  }

  /** Clears the panel. The run itself is core's and is not cancelled by closing the panel. */
  public clear(): void {
    this.current = undefined;
    this.publish({ ask: undefined, askRefusal: undefined });
  }
}

function opened(runId: string, prompt: string): AskRun {
  return {
    runId,
    prompt,
    answer: '',
    running: true,
    permissionMode: undefined,
    model: undefined,
    notices: [],
    ok: undefined,
    costUsd: undefined,
    stopReason: undefined,
    streamed: false,
  };
}

/**
 * One record folded into the run.
 *
 * Pure, and a free function rather than a method, so the whole state machine of the panel is one
 * expression a test can drive record by record without a store, an API or a stream.
 */
function applied(run: AskRun, record: AskRecord): AskRun {
  switch (record.kind) {
    case 'started':
      return { ...run, model: record.model, permissionMode: record.permissionMode };
    case 'delta':
      return { ...run, answer: capped(run.answer + record.text), streamed: true };
    case 'text':
      // Only when nothing streamed: otherwise this is the same sentence the deltas already spelled
      // out, and appending it would print every answer twice.
      return run.streamed ? run : { ...run, answer: capped(run.answer + record.text) };
    case 'notice':
      return { ...run, notices: [...run.notices, record.text] };
    case 'quota':
      // The header's gauges are core's to update (P2-T3); a run's own reading is not a second
      // opinion about the account, so the panel does not draw it.
      return run;
    case 'done':
      // The first `done` wins. Core publishes a closing frame of its own after the CLI's, so a
      // completed run would otherwise have its cost overwritten with `undefined`.
      return run.running
        ? {
            ...run,
            running: false,
            ok: record.ok,
            costUsd: record.costUsd,
            stopReason: record.stopReason,
          }
        : run;
  }
}

/** The panel stops growing rather than the tab falling over on a very long answer. */
function capped(answer: string): string {
  return answer.length <= MAX_ASK_ANSWER_CHARS ? answer : answer.slice(0, MAX_ASK_ANSWER_CHARS);
}
