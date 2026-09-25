// The presets every imported folder has before anybody saves one — P4-T1.
//
// **Computed, never seeded.** Importing a folder writes one row (P3-T1) and this adds none: the
// four built-ins are derived from the project and the four profile functions each time they are
// asked for. That is D26's habit applied one layer up — what ships is empty, and a database the
// owner did not write is a database they cannot read back. It also means a build that changes a
// built-in changes it everywhere, rather than leaving last month's copy in the store.
//
// A saved preset with the same id SHADOWS the built-in (`PresetBook`), so "I want `ticket` to open
// a different folder" is one save rather than a second row called `ticket (mine)`.
//
// **Why four presets and not five.** `contracts/launch-preset.ts` says it: `claude-isg-agents`
// opens the agents browser and starts nothing, so it has no preset. The other four are the ways
// the owner starts Claude today, and each one is here exactly as the PowerShell profile defines it
// — no model, no agent, no effort, because those live in the profile (D4).
//
// **Two of the four ship with an empty prompt, on purpose.** `--bg` will not start without one
// (RESEARCH.md B.4), so `365` and `isg` are a subscription, a folder and a name, and the first
// prompt is whatever the owner is about to ask for. Inventing one would spend quota on a sentence
// nobody wrote. `ticket` is the opposite case and is the reason this task exists: its prompt is
// four sentences that are the same every time, and it is computed from the ticket id by
// `TicketPrompt` rather than stored.
import type { LaunchPreset, ProfileFunction, PromptSource } from '../../contracts/launch-preset.ts';
import { projectKey, type ProjectRecord } from '../../contracts/project.ts';

interface BuiltIn {
  readonly id: string;
  readonly profileFn: ProfileFunction;
  readonly promptSource: PromptSource;
  /** `undefined` means "name it after the folder"; a string is a name the profile function pins. */
  readonly sessionName: string | undefined;
}

/**
 * The four, in the order the deck draws them: the two plain subscriptions, then the two shaped
 * ones. `orchestrator` names itself because `claude-isg-orch` already passes `-n orchestrator`
 * (`pinsSessionName`), and `ticket` names nothing because the ticket id is what the owner types.
 */
const BUILT_INS: readonly BuiltIn[] = [
  { id: '365', profileFn: 'claude-365', promptSource: 'literal', sessionName: undefined },
  { id: 'isg', profileFn: 'claude-isg', promptSource: 'literal', sessionName: undefined },
  { id: 'ticket', profileFn: 'claude-isg-ticket', promptSource: 'ticket', sessionName: '' },
  {
    id: 'orchestrator',
    profileFn: 'claude-isg-orch',
    promptSource: 'literal',
    sessionName: 'orchestrator',
  },
];

export class PresetCatalogue {
  /**
   * The built-in presets for one imported folder.
   *
   * The cwd is the project root itself. A worktree is a place to start a session too (P3-T4), and
   * it is reached by SAVING a preset with that cwd rather than by multiplying these four by every
   * tree — four presets times five trees is twenty buttons nobody asked for, and the trees move.
   *
   * `sessionName` defaults to the folder's name, which is the cheapest answer to D7's `unnamed`
   * flag: a session started from here is never called `development-63`.
   */
  public builtInsFor(project: ProjectRecord): readonly LaunchPreset[] {
    const key = projectKey(project.path);
    return BUILT_INS.map((template) => ({
      projectKey: key,
      id: template.id,
      name: template.id,
      profileFn: template.profileFn,
      cwd: project.path,
      sessionName: template.sessionName ?? project.name,
      promptSource: template.promptSource,
      prompt: '',
      group: undefined,
      // The four stay agent-less (P9-T1): an agent is a choice from one project's roster, and a
      // built-in is the same four for every project.
      agent: undefined,
      builtIn: true,
    }));
  }
}
