// P5a-T7. The planner's whole job is the before/after pair, so every test here reads the `after`
// as text — which is also the only way to catch G.13's line-ending trap.
import { describe, expect, it } from 'vitest';
import { KeybindingPlanner } from '../../../core/application/keybinding-planner.ts';
import { RECLAIMED_KEYS } from '../../../contracts/keybinding-plan.ts';

const PATH_365 = String.raw`C:\cfg\365\keybindings.json`;
const PATH_ISG = String.raw`C:\cfg\isg\keybindings.json`;

interface Source {
  subscription: string;
  path: string;
  contents: string | undefined;
}

/** Both config dirs holding the same thing — the usual case. */
function sources(contents: string | undefined): Source[] {
  return pair(contents, contents);
}

/**
 * The two holding different things.
 *
 * Separate from `sources` rather than a defaulted second parameter, which is how the first version
 * of this file asserted one refusal against a plan that had two: passing `undefined` explicitly
 * TRIGGERS a parameter default, so "the second file is absent" and "the second file is the same as
 * the first" were the same call.
 */
function pair(contents365: string | undefined, contentsIsg: string | undefined): Source[] {
  return [
    { subscription: '365', path: PATH_365, contents: contents365 },
    { subscription: 'isg', path: PATH_ISG, contents: contentsIsg },
  ];
}

function applied(after: string): Record<string, string | null> {
  const parsed: unknown = JSON.parse(after);
  const blocks = (
    parsed as { bindings: { context: string; bindings: Record<string, string | null> }[] }
  ).bindings;
  return blocks.find((block) => block.context === 'Global')?.bindings ?? {};
}

describe('KeybindingPlanner.apply', () => {
  it('creates a file, with both schema links, where there is none', () => {
    const plan = new KeybindingPlanner(sources(undefined)).apply();

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes).toHaveLength(2);
    const after = plan.changes[0]?.after ?? '';
    expect(after).toContain('schemastore.org/claude-code-keybindings.json');
    expect(after).toContain('code.claude.com/docs/en/keybindings');
    expect(plan.changes[0]?.before).toBe('');
  });

  it('unbinds the stolen key AND binds the chord, because user bindings are additive', () => {
    const plan = new KeybindingPlanner(sources(undefined)).apply();
    if (!plan.ok) throw new Error('expected a plan');

    const bindings = applied(plan.changes[0]?.after ?? '');
    for (const remap of RECLAIMED_KEYS) {
      expect(bindings[remap.from], remap.from).toBeNull();
      expect(bindings[remap.to], remap.to).toBe(remap.action);
    }
  });

  it('keeps every binding the owner already had, in their own context', () => {
    const existing = JSON.stringify(
      {
        $schema: 'x',
        bindings: [
          { context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } },
          { context: 'Global', bindings: { 'ctrl+o': null } },
        ],
      },
      undefined,
      2,
    );
    const plan = new KeybindingPlanner(sources(existing)).apply();
    if (!plan.ok) throw new Error('expected a plan');

    const after: unknown = JSON.parse(plan.changes[0]?.after ?? '');
    const file = after as {
      $schema: string;
      bindings: { context: string; bindings: Record<string, string | null> }[];
    };
    expect(file.$schema).toBe('x');
    expect(file.bindings.find((block) => block.context === 'Chat')?.bindings).toEqual({
      'ctrl+e': 'chat:externalEditor',
    });
    expect(
      file.bindings.find((block) => block.context === 'Global')?.bindings['ctrl+o'],
    ).toBeNull();
  });

  it('says nothing to do when it is already applied, rather than rewriting the file', () => {
    const first = new KeybindingPlanner(sources(undefined)).apply();
    if (!first.ok) throw new Error('expected a plan');
    const written = first.changes[0]?.after ?? '';

    const second = new KeybindingPlanner(sources(written)).apply();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changes).toEqual([]);
    expect(second.alreadyDone).toContain(PATH_365);
  });

  it('refuses a file it cannot read, and refuses the WHOLE plan when one is bad', () => {
    const plan = new KeybindingPlanner(pair('{ not json', undefined)).apply();

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.refusals).toHaveLength(1);
    expect(plan.refusals[0]?.path).toBe(PATH_365);
  });

  // G.13, in the file this task writes. `JSON.stringify` always emits LF; isg is CRLF.
  it('re-prints in the file own line endings and indent', () => {
    const crlf =
      '{\r\n\t"bindings": [\r\n\t\t{ "context": "Chat", "bindings": { "ctrl+e": null } }\r\n\t]\r\n}\r\n';
    const plan = new KeybindingPlanner(pair(crlf, undefined)).apply();
    if (!plan.ok) throw new Error('expected a plan');

    const after = plan.changes[0]?.after ?? '';
    expect(after.includes('\r\n')).toBe(true);
    expect(after.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
    expect(after).toContain('\r\n\t"bindings"');
    expect(after.endsWith('\r\n')).toBe(true);
  });
});

describe('KeybindingPlanner.restore', () => {
  it('takes back exactly what apply wrote, leaving the file it found', () => {
    const original =
      '{\n  "$schema": "x",\n  "bindings": [\n    {\n      "context": "Chat",\n      "bindings": {\n        "ctrl+e": "chat:externalEditor"\n      }\n    }\n  ]\n}\n';
    const applyPlan = new KeybindingPlanner(sources(original)).apply();
    if (!applyPlan.ok) throw new Error('expected a plan');

    const restorePlan = new KeybindingPlanner(sources(applyPlan.changes[0]?.after)).restore();
    expect(restorePlan.ok).toBe(true);
    if (!restorePlan.ok) return;
    expect(restorePlan.changes[0]?.after).toBe(original);
  });

  it('leaves a binding of the owner own on one of our keys alone', () => {
    const applyPlan = new KeybindingPlanner(sources(undefined)).apply();
    if (!applyPlan.ok) throw new Error('expected a plan');
    const theirs = (applyPlan.changes[0]?.after ?? '').replace(
      '"ctrl+x ctrl+t": "app:toggleTodos"',
      '"ctrl+x ctrl+t": "app:redraw"',
    );

    const restorePlan = new KeybindingPlanner(sources(theirs)).restore();
    if (!restorePlan.ok) throw new Error('expected a plan');
    expect(restorePlan.changes[0]?.after).toContain('"ctrl+x ctrl+t": "app:redraw"');
  });

  it('is a no-op on a file that has none of it, and on one that is not there', () => {
    const plan = new KeybindingPlanner(pair('{"bindings":[]}', undefined)).restore();
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes).toEqual([]);
    expect(plan.alreadyDone).toEqual([PATH_365, PATH_ISG]);
  });
});
