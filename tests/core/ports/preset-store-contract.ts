// The preset half of the `Store` contract, run against every implementation — P4-T1.
//
// A second file rather than a fifth `describe` in `store-contract.ts`, which reached its 250-line
// limit: the two halves are different KINDS of state, which is the split `core/ports/store.ts`
// spends four paragraphs on. Everything in that file but the registry is an append-only
// observation; a preset is a keyed, replaceable row that can be taken away — and taking a project
// away has to take its presets with it, which is the cascade the last two cases are here for.
import { describe, expect, it } from 'vitest';
import type { LaunchPreset } from '../../../contracts/launch-preset.ts';
import { projectKey } from '../../../contracts/project.ts';
import type { Store } from '../../../core/ports/store.ts';

/** Runs the preset contract against `make`. Called once per implementation. */
export function describePresetStoreContract(name: string, make: () => Store): void {
  describe(`${name} — launch presets (P4-T1)`, () => {
    const APP_NEXT = String.raw`C:\Users\belas\Documents\development\app-next`;
    const DOCS_TOOL = String.raw`C:\Users\belas\Documents\development\docs-tool`;
    const KEY = projectKey(APP_NEXT);

    function preset(over: Partial<LaunchPreset> = {}): LaunchPreset {
      return {
        projectKey: KEY,
        id: 'ticket',
        name: 'ticket',
        profileFn: 'claude-isg-ticket',
        cwd: APP_NEXT,
        sessionName: 'XWEB-2019',
        promptSource: 'ticket',
        prompt: '',
        group: undefined,
        builtIn: false,
        ...over,
      };
    }

    it('starts empty — the built-ins are computed, never seeded', () => {
      expect(make().savedPresets()).toEqual([]);
    });

    it('round-trips one', () => {
      const store = make();

      store.savePreset(preset());

      expect(store.savedPresets()).toEqual([preset()]);
    });

    it('keys by (project, id), so saving the same name replaces rather than duplicates', () => {
      const store = make();

      store.savePreset(preset());
      store.savePreset(preset({ sessionName: 'XWEB-2020', group: 'morning' }));

      expect(store.savedPresets()).toEqual([
        preset({ sessionName: 'XWEB-2020', group: 'morning' }),
      ]);
    });

    it('forces builtIn false: a stored preset is one somebody saved', () => {
      const store = make();

      store.savePreset(preset({ builtIn: true }));

      expect(store.savedPresets()[0]?.builtIn).toBe(false);
    });

    it('orders by project then name, so a React list does not reshuffle between reads', () => {
      const store = make();

      store.savePreset(preset({ id: 'zebra', name: 'zebra' }));
      store.savePreset(preset({ id: 'alpha', name: 'alpha' }));

      expect(store.savedPresets().map((held) => held.name)).toEqual(['alpha', 'zebra']);
    });

    it('removes one and says whether it did', () => {
      const store = make();
      store.savePreset(preset());

      expect(store.forgetPreset(KEY, 'ticket')).toBe(true);
      expect(store.forgetPreset(KEY, 'ticket')).toBe(false);
      expect(store.savedPresets()).toEqual([]);
    });

    // The cascade the port promises. A preset names a folder to start a session in, and a folder
    // that is no longer imported is one core may not read — an orphaned launch button is worse
    // than an absent one.
    it('drops a project’s presets when the project is forgotten', () => {
      const store = make();
      store.rememberProject({ path: APP_NEXT, name: 'app-next', importedAt: 1 });
      store.savePreset(preset());

      expect(store.forgetProject(APP_NEXT)).toBe(true);

      expect(store.savedPresets()).toEqual([]);
    });

    it('leaves another project’s presets alone when one is forgotten', () => {
      const store = make();
      store.savePreset(preset());
      store.savePreset(preset({ projectKey: projectKey(DOCS_TOOL), cwd: DOCS_TOOL }));

      store.forgetProject(APP_NEXT);

      expect(store.savedPresets().map((held) => held.projectKey)).toEqual([projectKey(DOCS_TOOL)]);
    });
  });
}
