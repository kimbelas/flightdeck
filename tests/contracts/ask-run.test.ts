// `parseAskRequest` and the caps — P4-T4, SEC-PROC-4.
//
// The decision this file pins is the absence of `bypassPermissions` from `ASK_PERMISSION_MODES`.
// SEC-PROC-4 says an Ask never runs with `--dangerously-skip-permissions` unless it says so
// explicitly; the union is that control expressed as a type, so a value the deck cannot send is a
// run core cannot be asked for. A parser that fell back to a default on an unknown mode would turn
// "this build does not support that" into "we ran it in plan mode anyway", which is the friendlier
// of the two behaviours and the wrong one — the request asked for something else.
import { describe, expect, it } from 'vitest';
import {
  askBudgetInRange,
  parseAskRequest,
  parseAskAccepted,
  parseAskRefusal,
  ASK_DEFAULT_BUDGET_USD,
  ASK_DEFAULT_MAX_TURNS,
  ASK_DEFAULT_PERMISSION_MODE,
  ASK_MAX_BUDGET_USD,
  ASK_MAX_TURNS,
  ASK_PERMISSION_MODES,
  MAX_ASK_PROMPT_CHARS,
  type AskRequest,
} from '../../contracts/ask-run.ts';

function body(fields: Record<string, unknown>): string {
  return JSON.stringify({ subscription: '365', prompt: 'what changed today', ...fields });
}

function parsed(fields: Record<string, unknown> = {}): AskRequest {
  const request = parseAskRequest(body(fields));
  if (request === undefined) throw new Error('expected a request');
  return request;
}

describe('ASK_PERMISSION_MODES — SEC-PROC-4 as a type', () => {
  it('does not contain bypassPermissions', () => {
    // The whole control. If this ever gains a fourth member, the flag SEC-PROC-4 bans becomes
    // reachable from a browser.
    expect(ASK_PERMISSION_MODES).toEqual(['plan', 'default', 'acceptEdits']);
    expect([...ASK_PERMISSION_MODES]).not.toContain('bypassPermissions');
  });

  it('falls back to plan — the mode that reads and proposes but does not edit', () => {
    expect(ASK_DEFAULT_PERMISSION_MODE).toBe('plan');
    expect(parsed().permissionMode).toBe('plan');
  });

  it('will not be talked into bypassPermissions by a body that asks for it', () => {
    // Not an error: an unknown mode takes the default, and the default is the safe one. What must
    // never happen is the requested mode being honoured.
    expect(parsed({ permissionMode: 'bypassPermissions' }).permissionMode).toBe('plan');
    expect(parsed({ permissionMode: 'anything-else' }).permissionMode).toBe('plan');
  });

  it('honours the three it does know', () => {
    for (const mode of ASK_PERMISSION_MODES) {
      expect(parsed({ permissionMode: mode }).permissionMode).toBe(mode);
    }
  });
});

describe('parseAskRequest — what it refuses outright', () => {
  it('refuses a body that is not JSON, or not an object', () => {
    expect(parseAskRequest('not json')).toBeUndefined();
    expect(parseAskRequest('[]')).toBeUndefined();
    expect(parseAskRequest('"a string"')).toBeUndefined();
  });

  it('refuses an unknown subscription rather than guessing one', () => {
    expect(parseAskRequest(JSON.stringify({ subscription: 'other', prompt: 'x' }))).toBeUndefined();
    expect(parseAskRequest(JSON.stringify({ prompt: 'x' }))).toBeUndefined();
  });

  it('refuses an empty prompt — there is nothing to ask', () => {
    expect(parseAskRequest(body({ prompt: '' }))).toBeUndefined();
    expect(parseAskRequest(body({ prompt: '   ' }))).toBeUndefined();
  });

  it('caps the prompt where it is parsed, as every other contract here does', () => {
    const huge = 'x'.repeat(MAX_ASK_PROMPT_CHARS + 500);

    expect(parsed({ prompt: huge }).prompt).toHaveLength(MAX_ASK_PROMPT_CHARS);
  });
});

describe('askBudgetInRange — the cap is a refusal, not a clamp', () => {
  it('takes the defaults when the body named no numbers', () => {
    const request = parsed();

    expect(request.budgetUsd).toBe(ASK_DEFAULT_BUDGET_USD);
    expect(request.maxTurns).toBe(ASK_DEFAULT_MAX_TURNS);
    expect(askBudgetInRange(request)).toBe(true);
  });

  it('accepts the ceiling and rejects one cent over it', () => {
    expect(askBudgetInRange(parsed({ budgetUsd: ASK_MAX_BUDGET_USD }))).toBe(true);
    expect(askBudgetInRange(parsed({ budgetUsd: ASK_MAX_BUDGET_USD + 0.01 }))).toBe(false);
  });

  it('rejects a budget of zero or less — a run that may spend nothing is not a run', () => {
    expect(askBudgetInRange(parsed({ budgetUsd: 0 }))).toBe(false);
    expect(askBudgetInRange(parsed({ budgetUsd: -5 }))).toBe(false);
  });

  it('rejects a budget that is not a number at all, rather than treating it as the default', () => {
    // A default for a MISSING field is a convenience; a default for a field that was present and
    // wrong is core deciding what the caller meant.
    expect(askBudgetInRange(parsed({ budgetUsd: 'lots' }))).toBe(false);
    expect(askBudgetInRange(parsed({ budgetUsd: null }))).toBe(true);
  });

  it('rejects a turn cap outside its bounds', () => {
    expect(askBudgetInRange(parsed({ maxTurns: ASK_MAX_TURNS }))).toBe(true);
    expect(askBudgetInRange(parsed({ maxTurns: ASK_MAX_TURNS + 1 }))).toBe(false);
    expect(askBudgetInRange(parsed({ maxTurns: 0 }))).toBe(false);
  });
});

describe('the replies', () => {
  it('reads an accepted run id, and refuses an empty one', () => {
    expect(parseAskAccepted({ runId: 'ask-17' })?.runId).toBe('ask-17');
    expect(parseAskAccepted({ runId: '' })).toBeUndefined();
    expect(parseAskAccepted({})).toBeUndefined();
  });

  it('reads a refusal this build knows, and drops one it does not', () => {
    expect(parseAskRefusal({ error: 'busy' })).toBe('busy');
    expect(parseAskRefusal({ error: 'bad_budget' })).toBe('bad_budget');
    expect(parseAskRefusal({ error: 'something_new' })).toBeUndefined();
  });
});
