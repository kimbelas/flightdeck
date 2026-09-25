// The preset wire shape — P4-T1.
//
// Two things here are worth more than the parsing. **The profile function IS the subscription**, so
// a build that ever grew a second field for it would have two answers to one question, and
// `subscriptionOfProfileFunction` is where that is settled. **`claude-isg-orch` names itself**, so
// the launcher must not add a second `-n`; that fact is asserted here rather than discovered in
// P4-T2 with a duplicated flag on a real command line.
import { describe, expect, it } from 'vitest';
import {
  byProjectThenName,
  parseLaunchPreset,
  parseLaunchPresetList,
  parsePresetDraft,
  parsePresetRef,
  parsePresetRefusal,
  pinsSessionName,
  PRESET_REFUSALS,
  presetId,
  presetPrompt,
  PROFILE_FUNCTIONS,
  ROUTABLE_PROFILE_FUNCTIONS,
  subscriptionOfProfileFunction,
  type LaunchPreset,
} from '../../contracts/launch-preset.ts';

const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;

function preset(over: Partial<LaunchPreset> = {}): LaunchPreset {
  return {
    projectKey: APP_NEXT.toLowerCase(),
    id: 'ticket',
    name: 'ticket',
    profileFn: 'claude-isg-ticket',
    cwd: APP_NEXT,
    sessionName: 'XWEB-2019',
    promptSource: 'ticket',
    prompt: '',
    group: undefined,
    agent: undefined,
    builtIn: true,
    ...over,
  };
}

describe('the profile functions', () => {
  it('allowlists the four that can start a session, and not the agents browser', () => {
    // SPEC §5.7 says "all five profile functions"; `claude-isg-agents` runs `claude agents …`,
    // which opens the agents browser and starts nothing — SEC-PROC-2 has always named four.
    expect([...PROFILE_FUNCTIONS]).toEqual([
      'claude-365',
      'claude-isg',
      'claude-isg-ticket',
      'claude-isg-orch',
    ]);
    expect(PROFILE_FUNCTIONS).not.toContain('claude-isg-agents');
  });

  it('answers the config directory each one exports', () => {
    expect(subscriptionOfProfileFunction('claude-365')).toBe('365');
    for (const fn of ['claude-isg', 'claude-isg-ticket', 'claude-isg-orch'] as const) {
      expect(subscriptionOfProfileFunction(fn)).toBe('isg');
    }
  });

  it('offers quota routing only the two that are not pinned to one subscription', () => {
    // The other two are `~\.claude-isg` by construction, so "run it on whichever has headroom" is
    // not a question that can be asked about them (P4-T3).
    expect([...ROUTABLE_PROFILE_FUNCTIONS]).toEqual(['claude-365', 'claude-isg']);
  });

  it('says which function already passes its own -n', () => {
    // `claude-isg-orch` is `… --agent orchestrator -n orchestrator @args`. A preset adding `-n`
    // would put two on one command line, and nothing has measured which wins.
    expect(pinsSessionName('claude-isg-orch')).toBe(true);
    expect(pinsSessionName('claude-isg-ticket')).toBe(false);
    expect(pinsSessionName('claude-365')).toBe(false);
  });
});

describe('presetId', () => {
  it('derives the id from the name, so saving twice replaces rather than duplicates', () => {
    expect(presetId('Morning triage')).toBe('morning-triage');
    expect(presetId('ticket')).toBe('ticket');
  });

  it('folds runs of punctuation to one hyphen and trims the ends', () => {
    expect(presetId('  ++ticket // 2 ++ ')).toBe('ticket-2');
  });

  it('answers nothing for a name with nothing in it, which is what `bad_name` refuses', () => {
    expect(presetId('***')).toBe('');
    expect(presetId('   ')).toBe('');
  });
});

describe('presetPrompt', () => {
  it('computes a ticket preset’s prompt from its session name', () => {
    expect(presetPrompt(preset({ sessionName: 'XWEB-7' }))).toContain('plan ticket XWEB-7');
  });

  it('ignores the stored prompt on a ticket preset — the name is the input', () => {
    const held = preset({ prompt: 'something else entirely' });

    expect(presetPrompt(held)).not.toContain('something else entirely');
  });

  it('answers a literal preset’s prompt exactly as it was written', () => {
    const held = preset({ promptSource: 'literal', prompt: "don't touch this" });

    expect(presetPrompt(held)).toBe("don't touch this");
  });
});

describe('parseLaunchPreset', () => {
  it('round-trips one through JSON', () => {
    expect(parseLaunchPreset(JSON.parse(JSON.stringify(preset())))).toEqual(preset());
  });

  it('refuses a profile function this build does not know', () => {
    expect(parseLaunchPreset({ ...preset(), profileFn: 'claude-isg-agents' })).toBeUndefined();
  });

  it('refuses a prompt source this build does not know', () => {
    expect(parseLaunchPreset({ ...preset(), promptSource: 'template' })).toBeUndefined();
  });

  it('refuses a row with no id, no project or no folder', () => {
    expect(parseLaunchPreset({ ...preset(), id: '' })).toBeUndefined();
    expect(parseLaunchPreset({ ...preset(), projectKey: '' })).toBeUndefined();
    expect(parseLaunchPreset({ ...preset(), cwd: '' })).toBeUndefined();
  });

  it('falls back to the id when a row lost its name', () => {
    // A preset nobody can read is a preset nobody presses; the id is always something.
    expect(parseLaunchPreset({ ...preset(), name: '' })?.name).toBe('ticket');
  });

  it('reads builtIn as a fact, never as a default', () => {
    expect(parseLaunchPreset({ ...preset(), builtIn: undefined })?.builtIn).toBe(false);
    expect(parseLaunchPreset({ ...preset(), builtIn: 'yes' })?.builtIn).toBe(false);
  });

  it('is not fooled by an array or a string', () => {
    expect(parseLaunchPreset([preset()])).toBeUndefined();
    expect(parseLaunchPreset('ticket')).toBeUndefined();
  });
});

describe('parseLaunchPresetList', () => {
  it('drops the rows it cannot read rather than refusing the whole list', () => {
    const body = { presets: [preset(), { profileFn: 'nonsense' }, preset({ id: 'isg' })] };

    expect(parseLaunchPresetList(body).map((held) => held.id)).toEqual(['ticket', 'isg']);
  });

  it('answers empty for a body that carries no list', () => {
    expect(parseLaunchPresetList({})).toEqual([]);
    expect(parseLaunchPresetList(undefined)).toEqual([]);
  });
});

describe('parsePresetDraft', () => {
  const body = JSON.stringify({
    projectPath: APP_NEXT,
    name: 'ticket',
    profileFn: 'claude-isg-ticket',
    cwd: '',
    sessionName: 'XWEB-2019',
    promptSource: 'ticket',
    prompt: 'ignored',
    group: 'morning',
    agent: undefined,
  });

  it('reads the fields the panel sends', () => {
    expect(parsePresetDraft(body)).toEqual({
      projectPath: APP_NEXT,
      name: 'ticket',
      profileFn: 'claude-isg-ticket',
      cwd: '',
      sessionName: 'XWEB-2019',
      promptSource: 'ticket',
      // Dropped: a ticket preset's prompt is computed from the name every time it is read, so a
      // stored one would be a value that can disagree with what is sent.
      prompt: '',
      group: 'morning',
      agent: undefined,
    });
  });

  it('keeps a literal prompt', () => {
    const literal = JSON.stringify({
      projectPath: APP_NEXT,
      name: 'nightly',
      profileFn: 'claude-365',
      cwd: '',
      sessionName: 'nightly',
      promptSource: 'literal',
      prompt: 'read CLAUDE.md',
      group: '',
      agent: undefined,
    });

    expect(parsePresetDraft(literal)?.prompt).toBe('read CLAUDE.md');
    expect(parsePresetDraft(literal)?.group).toBeUndefined();
  });

  it('refuses a body that is not JSON, not an object, or names no project', () => {
    expect(parsePresetDraft('{')).toBeUndefined();
    expect(parsePresetDraft('"ticket"')).toBeUndefined();
    expect(
      parsePresetDraft(JSON.stringify({ name: 'x', profileFn: 'claude-365' })),
    ).toBeUndefined();
  });

  it('refuses a profile function or prompt source from another build', () => {
    // Spelled as whole bodies rather than by patching the one above: `"ticket"` is the NAME there
    // as well as the prompt source, and a replace that hit the wrong one would leave this green
    // while asserting nothing (RESEARCH.md G.38).
    expect(parsePresetDraft(body.replace('"claude-isg-ticket"', '"rm -rf"'))).toBeUndefined();
    expect(
      parsePresetDraft(body.replace('"promptSource":"ticket"', '"promptSource":"jinja"')),
    ).toBeUndefined();
  });
});

describe('parsePresetRef and parsePresetRefusal', () => {
  it('reads the two fields forget takes', () => {
    const body = JSON.stringify({ projectPath: APP_NEXT, id: 'ticket' });

    expect(parsePresetRef(body)).toEqual({ projectPath: APP_NEXT, id: 'ticket' });
  });

  it('refuses a ref missing either half', () => {
    expect(parsePresetRef(JSON.stringify({ projectPath: APP_NEXT }))).toBeUndefined();
    expect(parsePresetRef(JSON.stringify({ id: 'ticket' }))).toBeUndefined();
  });

  it('reads back every refusal core can send, and nothing else', () => {
    for (const refusal of PRESET_REFUSALS) {
      expect(parsePresetRefusal({ error: refusal })).toBe(refusal);
    }
    expect(parsePresetRefusal({ error: 'teapot' })).toBeUndefined();
  });
});

describe('byProjectThenName', () => {
  it('sorts by project, then by the name somebody reads, then by id', () => {
    const rows = [
      preset({ projectKey: 'b', id: 'a', name: 'a' }),
      preset({ projectKey: 'a', id: 'z', name: 'z' }),
      preset({ projectKey: 'a', id: 'b', name: 'b' }),
    ];

    expect(
      [...rows].sort(byProjectThenName).map((held) => `${held.projectKey}:${held.name}`),
    ).toEqual(['a:b', 'a:z', 'b:a']);
  });
});
