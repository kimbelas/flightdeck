'use client';

// Ask — one headless question and its answer, in the deck (P4-T4, SPEC §5.2, D47).
//
// **The permission mode is a control, and it is on screen, because that is the whole of D47.**
// Every profile function passes `--dangerously-skip-permissions`, so an Ask started through one
// runs unsandboxed whatever the dropdown says — `--permission-mode` is silently ignored beside it
// (RESEARCH.md F.9.3). Ask therefore spawns the binary directly, and what the run was ACTUALLY
// allowed to do comes back on the `started` record and is printed. A control that cannot be
// verified from the answer is a control nobody should trust.
//
// **The subscription picker reuses P4-T3's rule.** "Which account has more headroom" is the same
// question here as it is at the launch form, so it is the same function — and the same bargain:
// the recommendation is a default, never a write, so a `quota` frame landing mid-question does not
// move the account out from under the owner.
//
// **The answer is a `<pre>`, not markdown.** It is model text (SEC-UI-2): rendering it as HTML
// would be handing a language model the ability to write into this page, and a result panel is the
// last place that should be possible. Whitespace is preserved and nothing is interpreted.
import { useState, type JSX, type SyntheticEvent } from 'react';
import {
  ASK_DEFAULT_BUDGET_USD,
  ASK_DEFAULT_MAX_TURNS,
  ASK_MAX_BUDGET_USD,
  ASK_PERMISSION_MODES,
  type AskPermissionMode,
  type AskRefusal,
  type AskRequest,
} from '../../contracts/ask-run.ts';
import { recommendRouting } from '../../contracts/quota-routing.ts';
import { subscriptionOfProfileFunction } from '../../contracts/launch-preset.ts';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';
import type { AskRun } from './ask-slice.ts';
import { AskRunViewModel } from './ask-view-model.ts';

interface AskPanelProps {
  readonly run: AskRun | undefined;
  readonly refusal: AskRefusal | undefined;
  readonly quota: QuotaSummary | undefined;
  readonly now: number;
  readonly disabled: boolean;
  readonly onAsk: (draft: AskRequest) => void;
  readonly onClear: () => void;
}

export function AskPanel(props: AskPanelProps): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [picked, setPicked] = useState<SubscriptionId | undefined>(undefined);
  const [permissionMode, setPermissionMode] = useState<AskPermissionMode>('plan');
  const { subscription, view, ready } = derive(props, picked, prompt);

  return (
    <section className="ask" aria-label="ask">
      <form
        className="ask-form"
        onSubmit={(event: SyntheticEvent) => {
          event.preventDefault();
          if (!ready) return;
          props.onAsk(draftOf(subscription, prompt, permissionMode));
        }}
      >
        <AskControls
          subscription={subscription}
          permissionMode={permissionMode}
          onSubscription={setPicked}
          onPermissionMode={setPermissionMode}
        />
        <AskPrompt prompt={prompt} onPrompt={setPrompt} />
        <button type="submit" disabled={!ready}>
          {view?.running === true ? 'running…' : 'ask'}
        </button>
      </form>
      {props.refusal !== undefined && (
        <p className="ask-refusal" aria-label="ask refusal">
          {refusalText(props.refusal)}
        </p>
      )}
      {view !== undefined && <AskResult view={view} onClear={props.onClear} />}
    </section>
  );
}

interface Derived {
  readonly subscription: SubscriptionId;
  readonly view: AskRunViewModel | undefined;
  readonly ready: boolean;
}

/**
 * What the panel draws, from what it holds.
 *
 * Split out of the component so it stays inside its complexity limit, and so the one rule worth
 * reading is on its own: **the recommendation is a DEFAULT, never a write** — P4-T3's, for the same
 * reason. A `quota` frame lands every few seconds, and a picker that re-applied the recommendation
 * would move the account out from under somebody halfway through typing a question.
 */
function derive(props: AskPanelProps, picked: SubscriptionId | undefined, prompt: string): Derived {
  const view = props.run === undefined ? undefined : new AskRunViewModel(props.run);
  return {
    subscription: picked ?? recommendedSubscription(props.quota, props.now) ?? '365',
    view,
    ready: prompt.trim() !== '' && !props.disabled && view?.running !== true,
  };
}

/** The caps are core's, and the placeholder says so rather than the run being refused later. */
function AskPrompt({
  prompt,
  onPrompt,
}: {
  readonly prompt: string;
  readonly onPrompt: (value: string) => void;
}): JSX.Element {
  return (
    <textarea
      className="ask-prompt"
      value={prompt}
      rows={2}
      placeholder={`ask a question — capped at $${String(ASK_DEFAULT_BUDGET_USD)} of ${String(ASK_MAX_BUDGET_USD)}`}
      aria-label="ask prompt"
      onChange={(event) => {
        onPrompt(event.target.value);
      }}
    />
  );
}

/** The budget and the turn cap are not controls yet — SEC-PROC-4's defaults, sent every time. */
function draftOf(
  subscription: SubscriptionId,
  prompt: string,
  permissionMode: AskPermissionMode,
): AskRequest {
  return {
    subscription,
    prompt,
    cwd: '',
    permissionMode,
    budgetUsd: ASK_DEFAULT_BUDGET_USD,
    maxTurns: ASK_DEFAULT_MAX_TURNS,
  };
}

interface ControlsProps {
  readonly subscription: SubscriptionId;
  readonly permissionMode: AskPermissionMode;
  readonly onSubscription: (value: SubscriptionId) => void;
  readonly onPermissionMode: (value: AskPermissionMode) => void;
}

/** The two dropdowns. Its own component so the panel body stays inside 40 lines. */
function AskControls(props: ControlsProps): JSX.Element {
  return (
    <div className="ask-row">
      <select
        value={props.subscription}
        aria-label="ask subscription"
        onChange={(event) => {
          const chosen = SUBSCRIPTION_IDS.find((id) => id === event.target.value);
          if (chosen !== undefined) props.onSubscription(chosen);
        }}
      >
        {SUBSCRIPTION_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <select
        value={props.permissionMode}
        aria-label="ask permission mode"
        onChange={(event) => {
          const chosen = ASK_PERMISSION_MODES.find((mode) => mode === event.target.value);
          if (chosen !== undefined) props.onPermissionMode(chosen);
        }}
      >
        {ASK_PERMISSION_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The answer, and the line that says what the run was actually allowed to do. */
function AskResult({
  view,
  onClear,
}: {
  readonly view: AskRunViewModel;
  readonly onClear: () => void;
}): JSX.Element {
  return (
    <div className="ask-result">
      <p className="ask-meta" aria-label="ask meta">
        {view.metaLine}
      </p>
      {view.notices.map((notice) => (
        <p className="ask-notice" key={notice}>
          {notice}
        </p>
      ))}
      {/* Model text, never markdown — see the header (SEC-UI-2). */}
      <pre className="ask-answer" aria-label="ask answer">
        {view.answer}
      </pre>
      <button type="button" onClick={onClear} disabled={view.running}>
        clear
      </button>
    </div>
  );
}

/**
 * Which account to default to, by P4-T3's rule.
 *
 * `recommendRouting` answers in profile functions because that is what a launch picks; an Ask
 * picks an account, so the answer is mapped back. Reusing the rule rather than writing a second
 * comparison is the same argument P4-T3 made about the CLI: two screens recommending different
 * accounts is worse than neither recommending anything.
 */
function recommendedSubscription(
  quota: QuotaSummary | undefined,
  now: number,
): SubscriptionId | undefined {
  if (quota === undefined) return undefined;
  const recommended = recommendRouting(quota, { now }).recommended;
  return recommended === undefined ? undefined : subscriptionOfProfileFunction(recommended);
}

/** Core names the cause; the deck writes the English. `PresetRefusal`'s habit. */
function refusalText(refusal: AskRefusal): string {
  switch (refusal) {
    case 'busy':
      return 'One question at a time — a run is already going.';
    case 'bad_budget':
      return `That is outside the cap. A run may spend up to $${String(ASK_MAX_BUDGET_USD)}.`;
    case 'bad_prompt':
      return 'There was nothing to ask.';
    case 'bad_subscription':
      return 'That is not one of the two accounts.';
    case 'no_claude':
      return 'Claude Code is not where core looks for it, so nothing could be run.';
    case 'empty':
      return 'Core would not take that question.';
  }
}
