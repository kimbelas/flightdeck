// The Start launcher, as data — P10-T2, the owner's morning.
//
// Three steps and a button, the owner's words: pick a project, pick the account, pick how to start
// (a skill, an agent, or just a prompt), and press Start. Everything it offers is something the deck
// already holds: the tiles are the imported folders (D26: nothing scans the disk), the skills and
// agents are the project's workflow map (P3-T3, plugins included since P9-T5), and the account is
// one of the two plain profile functions, `claude-isg` and `claude-365` (D44).
//
// **Every launch through a profile function bypasses permissions**, and this says so rather than
// offering a switch: all four functions pass `--dangerously-skip-permissions` (D47, F.9.3), and a
// "bypass: off" that the command line ignores would be a control that lies. The owner chose that
// on 2026-09-27 — the chip in the launcher is the notice.
//
// **An account can be LOCKED to a project.** Some folders belong to one account only (the owner's
// 365 Connect work is `claude-365`'s and nothing else's), and a toggle that remembered only the last
// choice would one day start it on the other. A lock is remembered in this browser beside the
// layout (`use-start-memory.ts`), and while it holds, the toggle is not offered at all.
//
// **A skill is the first prompt, an agent is `--agent`.** `/skill-name` IS how a skill is invoked,
// so pressing one writes it at the head of the prompt; an agent is the P9-T1 flag, from the same
// roster rule core checks at launch (`agentRoster`), so a chip here is one core will accept.
import type { ClaudeAsset } from '../../contracts/claude-assets.ts';
import { scopedAssetName } from '../../contracts/claude-assets.ts';
import {
  agentRoster,
  MAX_SESSION_NAME_CHARS,
  type PresetLaunch,
  type ProfileFunction,
} from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';
import { recommendRouting } from '../../contracts/quota-routing.ts';
import type { QuotaSummary } from '../../contracts/quota-summary.ts';
import type { SubscriptionId } from '../../contracts/session.ts';
import type { WorkflowMaps } from './workflow-map-slice.ts';

/** The two accounts, in the order the toggle draws them. */
export const START_ACCOUNTS: readonly SubscriptionId[] = ['isg', '365'];

/** What the launcher remembers about one project, in this browser. */
export interface AccountMemory {
  readonly account: SubscriptionId;
  readonly locked: boolean;
}

export type AccountMemories = Readonly<Record<string, AccountMemory>>;

/** How the session starts, beyond its prompt. */
export interface Starter {
  readonly kind: 'skill' | 'agent';
  /** The scoped name — `ship`, or `superpowers:brainstorming` for a plugin's. */
  readonly name: string;
  readonly description: string | undefined;
}

/** What the owner has picked so far. Everything optional: the launcher opens empty. */
export interface StartDraft {
  readonly projectKey: string | undefined;
  /** The account the toggle was PRESSED to, if it was. A lock overrides it. */
  readonly account: SubscriptionId | undefined;
  readonly starter: Starter | undefined;
  readonly prompt: string;
  /** What the owner typed over the suggested name; `''` means the suggestion. */
  readonly name: string;
}

export const EMPTY_START_DRAFT: StartDraft = {
  projectKey: undefined,
  account: undefined,
  starter: undefined,
  prompt: '',
  name: '',
};

export interface StartLauncherInput {
  readonly projects: readonly ProjectRecord[];
  readonly maps: WorkflowMaps;
  readonly quota: QuotaSummary | undefined;
  readonly memory: AccountMemories;
  readonly draft: StartDraft;
  readonly now: number;
}

/** A tile: one imported folder, and the account it is locked to, if it is. */
export interface ProjectTile {
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly lockedTo: SubscriptionId | undefined;
}

const PROFILE_OF: Readonly<Record<SubscriptionId, ProfileFunction>> = {
  isg: 'claude-isg',
  '365': 'claude-365',
};

export class StartLauncherViewModel {
  private readonly input: StartLauncherInput;

  constructor(input: StartLauncherInput) {
    this.input = input;
  }

  /** Every imported folder, by name — the list the owner imported, never one scanned. */
  public get tiles(): readonly ProjectTile[] {
    return [...this.input.projects]
      .sort((left, right) => (left.name.toLowerCase() < right.name.toLowerCase() ? -1 : 1))
      .map((project) => {
        const key = projectKey(project.path);
        const held = this.input.memory[key];
        return {
          key,
          name: project.name,
          path: project.path,
          lockedTo: held?.locked === true ? held.account : undefined,
        };
      });
  }

  /** The picked folder, or `undefined` before one is — or after it has been forgotten. */
  public get project(): ProjectRecord | undefined {
    const key = this.input.draft.projectKey;
    return this.input.projects.find((project) => projectKey(project.path) === key);
  }

  /** Whether the picked folder's account is locked, which takes the toggle away. */
  public get locked(): boolean {
    const project = this.project;
    return project !== undefined && this.input.memory[projectKey(project.path)]?.locked === true;
  }

  /**
   * The account the session will start on: a lock, else the toggle, else what was used last
   * here, else whichever has more headroom, else isg.
   */
  public get account(): SubscriptionId {
    const project = this.project;
    const held = project === undefined ? undefined : this.input.memory[projectKey(project.path)];
    if (held?.locked === true) return held.account;
    const recommended = recommendedAccount(this.input.quota, this.input.now);
    return this.input.draft.account ?? held?.account ?? recommended ?? 'isg';
  }

  /** The one flag every launch carries, said on screen (see the header). */
  public get bypassNotice(): string {
    return `${PROFILE_OF[this.account]} runs with --dangerously-skip-permissions`;
  }

  /** The project's skills and slash commands — each is invoked as `/name`. */
  public get skills(): readonly Starter[] {
    const seen = new Map<string, Starter>();
    for (const asset of this.assets()) {
      if (asset.kind === 'agent') continue;
      const name = scopedAssetName(asset);
      if (!seen.has(name)) seen.set(name, starter('skill', name, asset));
    }
    return [...seen.values()].sort(byName);
  }

  /** The agents core will accept for this folder — `agentRoster`, the rule core checks. */
  public get agents(): readonly Starter[] {
    const assets = this.assets();
    return agentRoster(assets).map((name) =>
      starter(
        'agent',
        name,
        assets.find((asset) => asset.kind === 'agent' && scopedAssetName(asset) === name),
      ),
    );
  }

  /** What goes in the name box before the owner types: `xpert-new-0927-0912`. */
  public get suggestedName(): string {
    const project = this.project;
    if (project === undefined) return '';
    const base = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    return `${base === '' ? 'session' : base}-${stamp(this.input.now)}`.slice(
      0,
      MAX_SESSION_NAME_CHARS,
    );
  }

  /** The first prompt as it will be sent: `/skill` ahead of what was typed, when there is one. */
  public get prompt(): string {
    const { starter: chosen, prompt } = this.input.draft;
    const typed = prompt.trim();
    if (chosen?.kind !== 'skill') return typed;
    return typed === '' ? `/${chosen.name}` : `/${chosen.name} ${typed}`;
  }

  /** Why Start is not pressable yet, or `undefined` when it is. The button says it. */
  public get missing(): string | undefined {
    if (this.project === undefined) return 'Pick a project';
    if (this.prompt === '') {
      return this.input.draft.starter?.kind === 'agent'
        ? 'Say what the agent should do'
        : 'Pick a skill, or type a prompt';
    }
    return undefined;
  }

  /** What `POST /sessions` is sent, or `undefined` while something is still missing. */
  public launch(): PresetLaunch | undefined {
    const project = this.project;
    if (project === undefined || this.missing !== undefined) return undefined;
    const { starter: chosen, name } = this.input.draft;
    return {
      profileFn: PROFILE_OF[this.account],
      prompt: this.prompt,
      name: name.trim() === '' ? this.suggestedName : name.trim(),
      cwd: project.path,
      agent: chosen?.kind === 'agent' ? chosen.name : undefined,
    };
  }

  private assets(): readonly ClaudeAsset[] {
    const project = this.project;
    if (project === undefined) return [];
    return this.input.maps[projectKey(project.path)]?.assets ?? [];
  }
}

/** The memories out of what storage held, dropping any entry that is not one. @throws never. */
export function parseMemories(raw: string | undefined): AccountMemories {
  let value: unknown;
  try {
    value = raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const kept: Record<string, AccountMemory> = {};
  for (const [key, entry] of Object.entries(value)) {
    const memory = parseMemory(entry);
    if (memory !== undefined) kept[key] = memory;
  }
  return kept;
}

function parseMemory(entry: unknown): AccountMemory | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
  const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(entry));
  const account = START_ACCOUNTS.find((known) => known === fields['account']);
  const locked = fields['locked'];
  if (account === undefined || typeof locked !== 'boolean') return undefined;
  return { account, locked };
}

/** The P4-T3 recommendation, as an account, or `undefined` when it has no opinion. */
function recommendedAccount(
  quota: QuotaSummary | undefined,
  now: number,
): SubscriptionId | undefined {
  if (quota === undefined) return undefined;
  const pick = recommendRouting(quota, { now }).recommended;
  if (pick === 'claude-365') return '365';
  return pick === 'claude-isg' ? 'isg' : undefined;
}

function starter(kind: Starter['kind'], name: string, asset: ClaudeAsset | undefined): Starter {
  return { kind, name, description: asset?.description };
}

function byName(left: Starter, right: Starter): number {
  return left.name < right.name ? -1 : 1;
}

/** `MMDD-HHMM` in local time — the day and minute a session was started, which is how it is found. */
function stamp(now: number): string {
  const at = new Date(now);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}`;
}
