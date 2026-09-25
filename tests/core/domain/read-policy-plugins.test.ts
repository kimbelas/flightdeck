// SEC-FS-1's one subtree per config dir, `plugins\cache\`, and the one index above it — P9-T5.
//
// The refusals are the half that matters: a plugin is a whole repository, and the only things in
// it the map may open are the three asset shapes. `plugins\marketplaces\` — every plugin ever
// published — must stay unreadable however its paths are shaped.
import { describe, expect, it } from 'vitest';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';

const CFG = 'C:\\Users\\x\\.claude-365';
const INSTALL = `${CFG}\\plugins\\cache\\claude-plugins-official\\superpowers\\6.4.1`;

function policy(): ReadPolicy {
  return new ReadPolicy([CFG]);
}

describe('ReadPolicy — the plugin subtree SEC-FS-1 allows', () => {
  const allowed: readonly string[] = [
    `${CFG}\\plugins\\installed_plugins.json`,
    `${INSTALL}\\agents`,
    `${INSTALL}\\commands`,
    `${INSTALL}\\skills`,
    `${INSTALL}\\agents\\bash-script-auditor.md`,
    `${INSTALL}\\commands\\about.md`,
    `${INSTALL}\\skills\\brainstorming\\SKILL.md`,
  ];

  for (const path of allowed) {
    it(`allows ${path.replace(CFG, '$CFG')}`, () => {
      expect(policy().refusal(path)).toBeUndefined();
    });
  }
});

describe('ReadPolicy — the rest of plugins\\ stays refused', () => {
  const refused: readonly string[] = [
    // The marketplace clones, in exactly the shape an install has — the reason for the whole list.
    `${CFG}\\plugins\\marketplaces\\claude-plugins-official\\superpowers\\6.4.1\\skills`,
    `${CFG}\\plugins\\marketplaces\\claude-plugins-official\\plugins\\x\\skills\\y\\SKILL.md`,
    `${CFG}\\plugins\\known_marketplaces.json`,
    `${CFG}\\plugins\\blocklist.json`,
    `${CFG}\\plugins\\plugin-catalog-cache.json`,
    `${CFG}\\plugins\\cache`,
    `${INSTALL}\\.claude-plugin\\plugin.json`,
    `${INSTALL}\\package.json`,
    `${INSTALL}\\README.md`,
    `${INSTALL}\\src\\index.ts`,
    `${INSTALL}\\agents\\notes.txt`,
    `${INSTALL}\\agents\\.md`,
    `${INSTALL}\\agents\\nested\\deeper.md`,
    `${INSTALL}\\skills\\brainstorming\\reference.md`,
    `${INSTALL}\\skills\\brainstorming\\scripts\\run.mjs`,
    `${INSTALL}\\skills\\brainstorming`,
    // One segment short of an install: `*` is exactly one segment, never zero.
    `${CFG}\\plugins\\cache\\claude-kit\\shell-review\\agents\\a.md`,
  ];

  for (const path of refused) {
    it(`refuses ${path.replace(CFG, '$CFG')}`, () => {
      expect(policy().allows(path)).toBe(false);
    });
  }

  it('refuses a .key in an agents folder, because the deny-list runs first', () => {
    expect(policy().refusal(`${INSTALL}\\agents\\x.key`)).toContain('SEC-FS-2');
  });

  it('refuses a .. out of an install', () => {
    expect(policy().allows(`${INSTALL}\\agents\\..\\..\\..\\..\\..\\..\\daemon\\control.md`)).toBe(
      false,
    );
  });
});
