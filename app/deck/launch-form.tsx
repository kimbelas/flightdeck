'use client';

// Start a background session. The only control on the deck that creates something.
//
// The prompt is required, and the placeholder says why rather than the button just being grey:
// `--bg` will not start without one (RESEARCH.md B.4), and an unexplained disabled control is the
// most common way a constraint gets mistaken for a bug.
import { useState, type JSX, type SyntheticEvent } from 'react';
import { SUBSCRIPTION_IDS, type SubscriptionId } from '../../contracts/session.ts';

interface LaunchFormProps {
  readonly disabled: boolean;
  /** A property, not a method: a method signature here is an unbound `this` waiting to happen. */
  readonly onLaunch: (subscription: SubscriptionId, prompt: string, name: string) => void;
}

interface FieldsProps {
  readonly subscription: SubscriptionId;
  readonly name: string;
  readonly onSubscription: (value: string) => void;
  readonly onName: (value: string) => void;
}

function LaunchFields({ subscription, name, onSubscription, onName }: FieldsProps): JSX.Element {
  return (
    <div className="launch-row">
      <select
        value={subscription}
        aria-label="subscription"
        onChange={(event) => {
          onSubscription(event.target.value);
        }}
      >
        {SUBSCRIPTION_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <input
        value={name}
        placeholder="name (optional)"
        aria-label="session name"
        onChange={(event) => {
          onName(event.target.value);
        }}
      />
    </div>
  );
}

export function LaunchForm({ disabled, onLaunch }: LaunchFormProps): JSX.Element {
  const [subscription, setSubscription] = useState<SubscriptionId>('365');
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (prompt.trim() === '') return;
    onLaunch(subscription, prompt, name);
    setPrompt('');
  };

  return (
    <form className="launch" onSubmit={submit}>
      <LaunchFields
        subscription={subscription}
        name={name}
        onSubscription={(value) => {
          const chosen = SUBSCRIPTION_IDS.find((id) => id === value);
          if (chosen !== undefined) setSubscription(chosen);
        }}
        onName={setName}
      />
      <textarea
        value={prompt}
        rows={2}
        placeholder="first prompt — --bg will not start without one"
        aria-label="first prompt"
        onChange={(event) => {
          setPrompt(event.target.value);
        }}
      />
      <button type="submit" disabled={disabled || prompt.trim() === ''}>
        start background session
      </button>
    </form>
  );
}
