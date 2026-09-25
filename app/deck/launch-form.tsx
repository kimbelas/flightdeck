'use client';

// Start a background session. The only control on the deck that creates something out of nothing.
//
// **It picks a profile function, not a subscription** — P4-T2. The subscription select it replaces
// was honest while core spawned `claude.exe` with a config directory; the launcher goes through
// the owner's profile now (D4), so the four functions are four different sessions and the picker
// has to say which. `claude-365` and `claude-isg` are the plain pair; `claude-isg-ticket` and
// `claude-isg-orch` come with a model, an agent and, for the second, a name.
//
// **The recommendation is a DEFAULT, never a write** — P4-T3, D46, and the trap this form exists
// to avoid. A `quota` frame arrives on every statusLine render, which on a busy machine is every
// few seconds. An effect that pushed the recommendation into the select would therefore re-pick it
// forever: the owner would change the account, keep typing their prompt, and launch on the other
// one. So there is no effect. `picked` is what the owner explicitly chose and starts `undefined`,
// the rendered value is `picked ?? recommended ?? claude-365`, and the first deliberate change
// wins permanently. Override is not a mode this form enters — it is what a `useState` already is.
//
// **The name is required** (SPEC §5.7, D7's `unnamed`), except for the one function that names
// itself. `--bg` will not start without a prompt either (RESEARCH.md B.4), and the placeholders say
// so rather than the button just being grey: an unexplained disabled control is the most common
// way a constraint gets mistaken for a bug.
//
// **There is no folder box here on purpose.** A folder that may be started in is one core has
// screened (`ProjectRegistry`), and this form has no project to screen against — a free-text path
// would be a text box that is refused more often than not. Starting somewhere in particular is
// what the project row's presets are for (P4-T1); this form starts one wherever core is.
import { useState, type JSX, type SyntheticEvent } from 'react';
import {
  pinsSessionName,
  PROFILE_FUNCTIONS,
  subscriptionOfProfileFunction,
  type PresetLaunch,
  type ProfileFunction,
} from '../../contracts/launch-preset.ts';
import { recommendRouting } from '../../contracts/quota-routing.ts';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import { LAUNCH_PROMPT_ID } from './deck-keyboard.ts';
import { RoutingViewModel } from './routing-view-model.ts';

const DEFAULT_PROFILE_FN: ProfileFunction = 'claude-365';

interface LaunchFormProps {
  readonly disabled: boolean;
  /** Both accounts' gauges, or `undefined` until the first `quota` frame — then no advice. */
  readonly quota: QuotaSummary | undefined;
  /** The clock the deck already ticks, so "the reading may be old" agrees with the header. */
  readonly now: number;
  /** A property, not a method: a method signature here is an unbound `this` waiting to happen. */
  readonly onLaunch: (request: PresetLaunch) => void;
}

interface FieldsProps {
  readonly profileFn: ProfileFunction;
  readonly name: string;
  readonly onProfileFn: (value: string) => void;
  readonly onName: (value: string) => void;
}

function LaunchFields({ profileFn, name, onProfileFn, onName }: FieldsProps): JSX.Element {
  const namesItself = pinsSessionName(profileFn);
  return (
    <div className="launch-row">
      <select
        value={profileFn}
        aria-label="profile function"
        onChange={(event) => {
          onProfileFn(event.target.value);
        }}
      >
        {PROFILE_FUNCTIONS.map((id) => (
          <option key={id} value={id}>
            {`${id} · ${subscriptionOfProfileFunction(id)}`}
          </option>
        ))}
      </select>
      <input
        value={namesItself ? '' : name}
        disabled={namesItself}
        placeholder={namesItself ? 'named by the profile function' : 'session name — required'}
        aria-label="session name"
        onChange={(event) => {
          onName(event.target.value);
        }}
      />
    </div>
  );
}

/**
 * The one line of advice under the picker.
 *
 * Its own component so the form body stays inside 40 lines, and so the smoke checks have a stable
 * `aria-label` to read whatever the verdict is — an element that disappears on one of four
 * outcomes is an element a check cannot assert the absence of (G.40).
 */
function RoutingHint({ routing }: { readonly routing: RoutingViewModel }): JSX.Element {
  return (
    <p className={routing.className} aria-label="quota recommendation">
      {routing.sentence}
    </p>
  );
}

interface PromptProps {
  readonly prompt: string;
  readonly onPrompt: (value: string) => void;
}

/** The id is the palette's handle: "Start a background session" focuses this (P2-T5). */
function LaunchPrompt({ prompt, onPrompt }: PromptProps): JSX.Element {
  return (
    <textarea
      id={LAUNCH_PROMPT_ID}
      value={prompt}
      rows={2}
      placeholder="first prompt — --bg will not start without one"
      aria-label="first prompt"
      onChange={(event) => {
        onPrompt(event.target.value);
      }}
    />
  );
}

export function LaunchForm({ disabled, quota, now, onLaunch }: LaunchFormProps): JSX.Element {
  // `undefined` until the owner touches the select — see the header. This is the override.
  const [picked, setPicked] = useState<ProfileFunction | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');

  const { profileFn, routing } = routingFor(quota, picked, now);
  // The two rules core enforces, said here so the button explains itself rather than just refusing.
  const named = name.trim() !== '' || pinsSessionName(profileFn);
  const ready = prompt.trim() !== '' && named;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!ready) return;
    // The global launch names no agent: there is no project, so there is no roster (P9-T1).
    onLaunch({ profileFn, prompt, name, cwd: '', agent: undefined });
    setPrompt('');
  };

  return (
    <form className="launch" onSubmit={submit}>
      <LaunchFields
        profileFn={profileFn}
        name={name}
        onProfileFn={(value) => {
          const chosen = PROFILE_FUNCTIONS.find((id) => id === value);
          if (chosen !== undefined) setPicked(chosen);
        }}
        onName={setName}
      />
      {routing !== undefined && <RoutingHint routing={routing} />}
      <LaunchPrompt prompt={prompt} onPrompt={setPrompt} />
      <button type="submit" disabled={disabled || !ready}>
        start background session
      </button>
    </form>
  );
}

interface Routed {
  /** What the select shows: the override, else the recommendation, else the default. */
  readonly profileFn: ProfileFunction;
  /** The advice, or `undefined` before the first `quota` frame — then the form says nothing. */
  readonly routing: RoutingViewModel | undefined;
}

/**
 * What to show, and what to say about it.
 *
 * **Two calls, and the second one is the fix for a bug the smoke run caught.** The routing has to
 * be told what is SELECTED so it can say whether the owner is following the advice — and the
 * selected value is itself derived from the advice. Passing the raw override instead made a
 * freshly-loaded form report itself as overridden: the select said `claude-isg` because that was
 * recommended, the hint was asked about `claude-365` because that was the untouched default, and a
 * form nobody had touched drew its advice in the warning colour.
 *
 * So the comparison is asked first with no `chosen` at all — `recommended` does not depend on it —
 * and the verdict is asked again with what that produced. `not_routable` stays reachable, because
 * the only way `profileFn` is one of the pinned two is `picked` being one of them.
 */
function routingFor(
  quota: QuotaSummary | undefined,
  picked: ProfileFunction | undefined,
  now: number,
): Routed {
  if (quota === undefined) {
    return { profileFn: picked ?? DEFAULT_PROFILE_FN, routing: undefined };
  }
  const profileFn = picked ?? recommendRouting(quota, { now }).recommended ?? DEFAULT_PROFILE_FN;
  const routing = recommendRouting(quota, { now, chosen: profileFn });
  return { profileFn, routing: new RoutingViewModel(routing, profileFn) };
}
