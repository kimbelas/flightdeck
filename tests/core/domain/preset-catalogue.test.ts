// The four presets every imported folder has — P4-T1.
//
// The case worth more than the rest is the last one: **nothing is seeded**. These are computed on
// every request, so a future change that "helpfully" wrote them into the store on import would
// break D26's habit — the owner's database holds nothing they did not put there — and would leave
// last month's copy of a built-in behind after a build that changed it.
import { describe, expect, it } from 'vitest';
import { presetPrompt, type LaunchPreset } from '../../../contracts/launch-preset.ts';
import type { ProjectRecord } from '../../../contracts/project.ts';
import { PresetCatalogue } from '../../../core/domain/preset-catalogue.ts';

const APP_NEXT: ProjectRecord = {
  path: String.raw`C:\Users\belas\Documents\development\app-next`,
  name: 'app-next',
  importedAt: 1_700_000_000_000,
};

describe('PresetCatalogue', () => {
  const catalogue = new PresetCatalogue();

  /** One built-in by id. Throwing beats `?.` here: a missing preset is the bug, not the assertion. */
  function find(id: string): LaunchPreset {
    const preset = catalogue.builtInsFor(APP_NEXT).find((held) => held.id === id);
    if (preset === undefined) throw new Error(`no built-in preset called ${id}`);
    return preset;
  }

  it('gives a folder one preset per launchable profile function', () => {
    const presets = catalogue.builtInsFor(APP_NEXT);

    expect(presets.map((held) => held.id)).toEqual(['365', 'isg', 'ticket', 'orchestrator']);
    expect(presets.map((held) => held.profileFn)).toEqual([
      'claude-365',
      'claude-isg',
      'claude-isg-ticket',
      'claude-isg-orch',
    ]);
  });

  it('files them under the project and starts them in its root', () => {
    for (const preset of catalogue.builtInsFor(APP_NEXT)) {
      expect(preset.projectKey).toBe(APP_NEXT.path.toLowerCase());
      expect(preset.cwd).toBe(APP_NEXT.path);
      expect(preset.builtIn).toBe(true);
    }
  });

  it('names a plain session after the folder, which is D7’s `unnamed` answered for free', () => {
    const plain = catalogue.builtInsFor(APP_NEXT).filter((held) => held.promptSource === 'literal');

    expect(plain.map((held) => held.sessionName)).toEqual([
      'app-next',
      'app-next',
      // `claude-isg-orch` passes its own `-n orchestrator`, so the preset carries that name.
      'orchestrator',
    ]);
  });

  it('ships the two plain presets with no prompt, because the prompt is the owner’s', () => {
    // `--bg` will not start without one (RESEARCH.md B.4), so the deck's start button stays
    // disabled until it is typed. Inventing a prompt would spend quota on a sentence nobody wrote.
    expect(presetPrompt(find('365'))).toBe('');
    expect(presetPrompt(find('isg'))).toBe('');
  });

  it('gives the ticket preset no session name, because the ticket id is what is typed', () => {
    const ticket = find('ticket');

    expect(ticket.sessionName).toBe('');
    expect(ticket.promptSource).toBe('ticket');
    // With nothing typed there is nothing to plan, so nothing can start yet.
    expect(presetPrompt(ticket)).toBe('');
  });

  it('makes the ticket preset’s prompt out of whatever the ticket is called', () => {
    const named = { ...find('ticket'), sessionName: 'XWEB-2019' };

    expect(presetPrompt(named)).toContain('plan ticket XWEB-2019');
  });

  it('puts none of them in a group — groups are for presets somebody saved (P6-T4)', () => {
    expect(catalogue.builtInsFor(APP_NEXT).map((held) => held.group)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('answers the same four every time, holding nothing between calls', () => {
    expect(catalogue.builtInsFor(APP_NEXT)).toEqual(catalogue.builtInsFor(APP_NEXT));
  });
});
