// The plan-first ticket prompt — P4-T1.
//
// The value of this suite is that the prompt is ROUTING rather than politeness: with
// `claude-isg-ticket` pinning `opusplan[1m]`, "enter plan mode first" is what puts the planning
// turn on Fable 5.1 and the execution turns on Opus 5. A change that quietly dropped that sentence
// would leave a preset that looks identical and plans on the expensive model.
import { describe, expect, it } from 'vitest';
import { TicketPrompt } from '../../contracts/ticket-prompt.ts';

describe('TicketPrompt', () => {
  it('asks for plan mode first, which is what selects the planning model', () => {
    const prompt = new TicketPrompt('XWEB-2019').text;

    expect(prompt.startsWith('Enter plan mode first (EnterPlanMode)')).toBe(true);
  });

  it('names the ticket in the sentence and in both paths it points at', () => {
    const prompt = new TicketPrompt('XWEB-2019').text;

    expect(prompt).toContain('plan ticket XWEB-2019');
    expect(prompt).toContain('.claude/specs/XWEB-2019/');
    expect(prompt).toContain('.claude/state/XWEB-2019.md');
  });

  it('holds the line about not editing until the plan is approved', () => {
    // The other half of the routing: ExitPlanMode is what returns to bypass, so an agent that
    // starts editing in plan mode never gets there.
    expect(new TicketPrompt('XWEB-1').text).toContain('Do not edit until the plan is approved');
  });

  it('upper-cases a ticket-shaped name, because the tracker spells it that way', () => {
    expect(new TicketPrompt('xweb-2019').name).toBe('XWEB-2019');
    expect(new TicketPrompt('xweb-2019').text).toContain('XWEB-2019');
  });

  it('leaves a name that is not ticket-shaped exactly as it was typed', () => {
    // A session called `nightly cleanup` is not an issue id and must not be shouted at.
    expect(new TicketPrompt('nightly cleanup').name).toBe('nightly cleanup');
    expect(new TicketPrompt('Orchestrator').name).toBe('Orchestrator');
  });

  it('trims what came out of a text box', () => {
    expect(new TicketPrompt('  XWEB-7  ').name).toBe('XWEB-7');
  });

  it('answers an empty prompt when there is no ticket to plan', () => {
    // Not a prompt with a hole in it. `--bg` will not start without a prompt (RESEARCH.md B.4),
    // and an empty string is what keeps the deck's start button disabled until the id is typed.
    expect(new TicketPrompt('').text).toBe('');
    expect(new TicketPrompt('   ').text).toBe('');
  });

  it('keeps an apostrophe, because nothing here builds a command string', () => {
    // open-tab.mjs strips quotes because its prompt is interpolated into PowerShell `-Command`.
    // Flightdeck passes the prompt as an argv element and then as an environment variable
    // (SEC-PROC-1), so copying that workaround would only mangle a real ticket title.
    expect(new TicketPrompt("don't-1").name).toBe("don't-1");
  });
});
