'use client';

// The Start launcher's three steps — P10-T2. Pure drawing: every value comes off
// `StartLauncherViewModel` and every press goes back up as a draft change (`start-launcher.tsx`).
import { useState, type JSX } from 'react';
import type { SubscriptionId } from '../../contracts/session.ts';
import {
  START_ACCOUNTS,
  type ProjectTile,
  type Starter,
  type StartDraft,
  type StartLauncherViewModel,
} from './start-launcher-view-model.ts';

export interface StepProps {
  readonly model: StartLauncherViewModel;
  readonly draft: StartDraft;
  readonly onDraft: (change: Partial<StartDraft>) => void;
}

interface ImportProps {
  readonly refusal: string | undefined;
  readonly onImport: (path: string) => void;
}

const ACCOUNT_LABEL: Readonly<Record<SubscriptionId, string>> = { isg: 'isg', '365': '365' };

/** Step 1: the imported folders as tiles, and a way to import one more. */
export function ProjectStep(props: StepProps & ImportProps): JSX.Element {
  const { model, draft, onDraft } = props;
  return (
    <li className="start-step">
      <h3 className="start-step-title">1 · Project</h3>
      <div className="start-tiles">
        {model.tiles.map((tile) => (
          <Tile
            key={tile.key}
            tile={tile}
            pressed={draft.projectKey === tile.key}
            onPick={() => {
              onDraft({ projectKey: tile.key, account: undefined, starter: undefined });
            }}
          />
        ))}
        <ChooseFolder refusal={props.refusal} onImport={props.onImport} />
      </div>
    </li>
  );
}

function Tile({
  tile,
  pressed,
  onPick,
}: {
  readonly tile: ProjectTile;
  readonly pressed: boolean;
  readonly onPick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="start-tile"
      data-start-project={tile.key}
      aria-pressed={pressed}
      title={tile.path}
      onClick={onPick}
    >
      <span className="start-tile-name">{tile.name}</span>
      {tile.lockedTo !== undefined && (
        <span className="tag">{`${ACCOUNT_LABEL[tile.lockedTo]} only`}</span>
      )}
    </button>
  );
}

/**
 * "Choose folder…": a path box, because a browser cannot hand a page a folder's PATH, and a path is
 * what core imports (`POST /projects`, screened by `ProjectImport`). Imported, it becomes a tile.
 */
function ChooseFolder(props: ImportProps): JSX.Element {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="start-tile start-tile-choose"
        data-start-choose
        onClick={() => {
          setOpen(true);
        }}
      >
        choose folder…
      </button>
    );
  }
  return <FolderPath {...props} />;
}

function FolderPath({ refusal, onImport }: ImportProps): JSX.Element {
  const [path, setPath] = useState('');
  return (
    <form
      className="start-choose"
      onSubmit={(event) => {
        event.preventDefault();
        if (path.trim() !== '') onImport(path.trim());
      }}
    >
      <input
        // A deliberate press put the caret here; the one box on screen that wants it.
        autoFocus
        value={path}
        aria-label="folder path"
        placeholder="C:\Users\…\project"
        data-start-path
        onChange={(event) => {
          setPath(event.target.value);
        }}
      />
      <button type="submit" disabled={path.trim() === ''}>
        import
      </button>
      {refusal !== undefined && <p className="start-refusal">{refusal}</p>}
    </form>
  );
}

/** Step 2: isg or 365 — or the one account this folder is locked to. */
export function AccountStep(
  props: StepProps & { readonly onLock: (locked: boolean) => void },
): JSX.Element {
  const { model } = props;
  return (
    <li className="start-step">
      <h3 className="start-step-title">2 · Account</h3>
      <div className="start-accounts" role="group" aria-label="account">
        {START_ACCOUNTS.map((id) => (
          <AccountButton key={id} id={id} {...props} />
        ))}
        <label className="start-lock">
          <input
            type="checkbox"
            data-start-lock
            checked={model.locked}
            onChange={(event) => {
              props.onLock(event.target.checked);
            }}
          />
          {`always ${ACCOUNT_LABEL[model.account]} for this project`}
        </label>
      </div>
      <p className="start-bypass" data-start-bypass>
        <span className="tag start-bypass-tag">bypass permissions</span> {model.bypassNotice}
      </p>
    </li>
  );
}

function AccountButton({
  id,
  model,
  onDraft,
}: StepProps & { readonly id: SubscriptionId }): JSX.Element {
  return (
    <button
      type="button"
      className="start-account"
      data-start-account={id}
      aria-pressed={model.account === id}
      // Locked, the other account is not a choice at all — see the view model's header.
      disabled={model.locked && model.account !== id}
      onClick={() => {
        onDraft({ account: id });
      }}
    >
      {ACCOUNT_LABEL[id]}
    </button>
  );
}

/** Step 3: a skill, an agent or neither — then the prompt and the name. */
export function StarterStep(props: StepProps): JSX.Element {
  const { model, draft, onDraft } = props;
  return (
    <li className="start-step">
      <h3 className="start-step-title">3 · Start with</h3>
      <div className="start-chips">
        <button
          type="button"
          className="start-chip"
          aria-pressed={draft.starter === undefined}
          data-start-starter=""
          onClick={() => {
            onDraft({ starter: undefined });
          }}
        >
          just a prompt
        </button>
        <StarterChips starters={model.skills} sigil="/" {...props} />
        <StarterChips starters={model.agents} sigil="@" {...props} />
      </div>
      {model.skills.length + model.agents.length === 0 && (
        <p className="muted">
          No skills or agents in this project&apos;s .claude — a prompt works.
        </p>
      )}
      <PromptFields {...props} />
    </li>
  );
}

function PromptFields({ model, draft, onDraft }: StepProps): JSX.Element {
  const afterSkill = draft.starter?.kind === 'skill';
  return (
    <>
      <textarea
        className="start-prompt"
        value={draft.prompt}
        rows={3}
        aria-label="first prompt"
        data-start-prompt
        placeholder={afterSkill ? 'anything to add after the skill' : 'what should it do?'}
        onChange={(event) => {
          onDraft({ prompt: event.target.value });
        }}
      />
      <input
        className="start-name"
        value={draft.name}
        aria-label="session name"
        data-start-name
        placeholder={model.suggestedName}
        onChange={(event) => {
          onDraft({ name: event.target.value });
        }}
      />
    </>
  );
}

function StarterChips({
  starters,
  sigil,
  draft,
  onDraft,
}: StepProps & { readonly starters: readonly Starter[]; readonly sigil: string }): JSX.Element {
  return (
    <>
      {starters.map((each) => (
        <button
          key={`${each.kind}:${each.name}`}
          type="button"
          className={`start-chip start-chip-${each.kind}`}
          data-start-starter={`${each.kind}:${each.name}`}
          aria-pressed={draft.starter?.kind === each.kind && draft.starter.name === each.name}
          title={each.description}
          onClick={() => {
            onDraft({ starter: each });
          }}
        >
          {`${sigil}${each.name}`}
        </button>
      ))}
    </>
  );
}
