'use client';

// Start a background session. The only control on the deck that creates something out of nothing.
//
// **It picks a profile function, not a subscription** — P4-T2. The subscription select it replaces
// was honest while core spawned `claude.exe` with a config directory; the launcher goes through
// the owner's profile now (D4), so the four functions are four different sessions and the picker
// has to say which. `claude-365` and `claude-isg` are the plain pair; `claude-isg-ticket` and
// `claude-isg-orch` come with a model, an agent and, for the second, a name.
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
import { LAUNCH_PROMPT_ID } from './deck-keyboard.ts';

interface LaunchFormProps {
  readonly disabled: boolean;
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

export function LaunchForm({ disabled, onLaunch }: LaunchFormProps): JSX.Element {
  const [profileFn, setProfileFn] = useState<ProfileFunction>('claude-365');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  // The two rules core enforces, said here so the button explains itself rather than just refusing.
  const named = name.trim() !== '' || pinsSessionName(profileFn);
  const ready = prompt.trim() !== '' && named;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!ready) return;
    onLaunch({ profileFn, prompt, name, cwd: '' });
    setPrompt('');
  };

  return (
    <form className="launch" onSubmit={submit}>
      <LaunchFields
        profileFn={profileFn}
        name={name}
        onProfileFn={(value) => {
          const chosen = PROFILE_FUNCTIONS.find((id) => id === value);
          if (chosen !== undefined) setProfileFn(chosen);
        }}
        onName={setName}
      />
      {/* The id is the palette's handle: "Start a background session" focuses this (P2-T5). */}
      <textarea
        id={LAUNCH_PROMPT_ID}
        value={prompt}
        rows={2}
        placeholder="first prompt — --bg will not start without one"
        aria-label="first prompt"
        onChange={(event) => {
          setPrompt(event.target.value);
        }}
      />
      <button type="submit" disabled={disabled || !ready}>
        start background session
      </button>
    </form>
  );
}
