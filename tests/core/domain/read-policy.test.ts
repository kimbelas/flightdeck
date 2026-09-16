// SEC-FS-1's allowlist and SEC-FS-2's deny-list, one case per rule — P1-T12.
//
// The table is the point. Every row here is a sentence in SECURITY.md, and the ones that matter
// most are the refusals: a policy that allows too much fails no test unless the test says what
// must be refused.
import { describe, expect, it } from 'vitest';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';

const CFG = 'C:\\Users\\x\\.claude-365';
const OTHER = 'C:\\Users\\x\\.claude-isg';

function policy(): ReadPolicy {
  return new ReadPolicy([CFG, OTHER]);
}

describe('ReadPolicy — what SEC-FS-1 allows', () => {
  const allowed: readonly string[] = [
    `${CFG}\\projects\\a-slug\\11111111-2222-4333-a444-555555555555.jsonl`,
    `${CFG}\\sessions\\a-session`,
    `${CFG}\\jobs\\state`,
    `${CFG}\\history.jsonl`,
    `${CFG}\\settings.json`,
    `${CFG}\\daemon.log`,
    `${CFG}\\daemon\\roster.json`,
    `${OTHER}\\projects\\b-slug\\a.jsonl`,
  ];

  for (const path of allowed) {
    it(`allows ${path.replace(CFG, '$CFG').replace(OTHER, '$ISG')}`, () => {
      expect(policy().allows(path)).toBe(true);
      expect(policy().refusal(path)).toBeUndefined();
    });
  }

  it('does not care about separators or case, because Windows does not', () => {
    expect(policy().allows('c:/USERS/x/.CLAUDE-365/projects/s/a.jsonl')).toBe(true);
  });
});

describe('ReadPolicy — what SEC-FS-2 refuses', () => {
  const refused: readonly [string, string][] = [
    [`${CFG}\\sessions\\a-session.key`, '.key'],
    [`${CFG}\\daemon\\control.key`, '.key'],
    [`${CFG}\\daemon\\a.key`, '.key'],
    [`${CFG}\\.credentials.json`, 'credentials'],
    [`${CFG}\\.credentials`, 'credentials'],
    [`${CFG}\\statsig\\something.json`, '.json'],
    [`${CFG}\\daemon\\roster-backup.json`, '.json'],
    [`${CFG}\\projects\\s\\notes.json`, '.json'],
  ];

  for (const [path, rule] of refused) {
    it(`refuses ${path.replace(CFG, '$CFG')} — ${rule}`, () => {
      expect(policy().allows(path)).toBe(false);
      expect(policy().refusal(path)).toContain('SEC-FS-2');
    });
  }

  it('refuses a .key even inside an allowlisted directory, because the deny-list runs first', () => {
    expect(policy().allows(`${CFG}\\projects\\s\\a.key`)).toBe(false);
  });
});

describe('ReadPolicy — everything else', () => {
  it('refuses a path outside every root', () => {
    const refusal = policy().refusal('C:\\Users\\x\\.ssh\\id_rsa');

    expect(refusal).toBe('outside the config directories and every project');
  });

  it('refuses a sibling directory that merely starts like a config directory', () => {
    // The `SubscriptionPaths` lesson: a bare `startsWith` reads `.claude-365-backup` as 365, and
    // a folder some unrelated tool created starts being read as the owner's live config.
    expect(policy().allows(`${CFG}-backup\\projects\\s\\a.jsonl`)).toBe(false);
  });

  it('refuses traversal after normalisation', () => {
    const refusal = policy().refusal(`${CFG}\\projects\\..\\daemon\\control.key`);

    expect(refusal).toBeDefined();
  });

  it('refuses the config directory itself, with or without a trailing separator', () => {
    expect(policy().allows(CFG)).toBe(false);
    expect(policy().allows(`${CFG}\\`)).toBe(false);
  });

  it('refuses a file at the root of a config directory that is not named', () => {
    // `CLAUDE.md` used to be the example here and is allowlisted by name from P3-T3 (D38). That is
    // the point rather than a loosening: the list is named-or-nothing, so a neighbour of exactly
    // the same shape is still refused, and so is the markdown file the next release invents.
    expect(policy().refusal(`${CFG}\\AGENTS.md`)).toContain('SEC-FS-1');
    expect(policy().refusal(`${CFG}\\soul.md`)).toContain('SEC-FS-1');
    expect(policy().allows(`${CFG}\\CLAUDE.md`)).toBe(true);
    // By name, not by suffix — a CLAUDE.md deeper in the config directory is not the user file.
    expect(policy().refusal(`${CFG}\\plugins\\CLAUDE.md`)).toContain('SEC-FS-1');
  });

  it('refuses everything when it was given no config directories', () => {
    // A policy built before `ClaudeInstall` found a home must not be an open door.
    expect(new ReadPolicy(['']).allows(`${CFG}\\projects\\s\\a.jsonl`)).toBe(false);
  });
});

describe('ReadPolicy — the job state file (P2-T4)', () => {
  it('allows the one `.json` under jobs that an expanded row needs', () => {
    // It was REFUSED before this task, which is how the bug surfaced: SEC-FS-2 denies every `.json`
    // nobody has named, and `jobs\\<shortId>\\state.json` carries an id, so it could not be named
    // by exact string the way `settings.json` is.
    expect(policy().allows(`${CFG}\\jobs\\cb5e8102\\state.json`)).toBe(true);
  });

  it('still refuses every other `.json` under a job directory', () => {
    // The half of SEC-FS-2 with value: the settings file the NEXT Claude Code release invents is
    // unreadable until a person names it. One narrow pattern, not a hole for `jobs\\`.
    for (const name of ['secrets.json', 'config.json', 'state.json.bak.json']) {
      expect(policy().allows(`${CFG}\\jobs\\cb5e8102\\${name}`)).toBe(false);
    }
  });

  it('matches exactly one segment for the id, so the pattern cannot be walked', () => {
    // Deeper, shallower, and the same filename under a different directory. `*` is one segment and
    // there is deliberately no `**`.
    expect(policy().allows(`${CFG}\\jobs\\cb5e8102\\tmp\\state.json`)).toBe(false);
    expect(policy().allows(`${CFG}\\jobs\\state.json`)).toBe(false);
    expect(policy().allows(`${CFG}\\daemon\\x\\state.json`)).toBe(false);
  });

  it('keeps refusing the files the new pattern sits next to', () => {
    expect(policy().allows(`${CFG}\\jobs\\cb5e8102\\control.key`)).toBe(false);
    expect(policy().allows(`${CFG}\\daemon\\control.key`)).toBe(false);
  });

  it('allows the timeline, which never met the deny rule at all', () => {
    // `.jsonl` does not end with `.json`; it is admitted by `jobs` being an allowlisted directory,
    // and has been since P1-T12. Asserted so a future tightening of the deny rule cannot take it.
    expect(policy().allows(`${CFG}\\jobs\\cb5e8102\\timeline.jsonl`)).toBe(true);
  });

  it('refuses a job file under a directory that is not a config dir', () => {
    expect(policy().allows(`C:\\evil\\jobs\\cb5e8102\\state.json`)).toBe(false);
  });
});

describe('ReadPolicy — imported project roots (P3-T1)', () => {
  const PROJECT = 'C:\\Users\\x\\Documents\\development\\app-next';

  function withProject(): ReadPolicy {
    return new ReadPolicy([CFG, OTHER], [PROJECT]);
  }

  it('allows nothing under a project by default, because the registry ships empty (D26)', () => {
    // The whole design in one assertion: a folder is readable because somebody imported it, and
    // for no other reason. A policy that allowed a project nobody had named would be the bug.
    expect(policy().allows(`${PROJECT}\\CLAUDE.md`)).toBe(false);
  });

  const allowed: readonly [string, string][] = [
    ['CLAUDE.md', 'the instruction stack'],
    ['.claude\\agents\\reviewer.md', 'the subagent roster'],
    ['.claude\\settings.json', 'the hook timeline — a `.json`, deliberately'],
    ['.mcp.json', 'the MCP servers — the other `.json`'],
    ['package.json', 'the detected stack'],
    ['.claude\\skills\\ship\\SKILL.md', 'a skill, however deep'],
  ];

  for (const [relative, what] of allowed) {
    it(`allows ${relative} — ${what}`, () => {
      expect(withProject().refusal(`${PROJECT}\\${relative}`)).toBeUndefined();
    });
  }

  it('allows a `.json` under a project although SEC-FS-2 refuses one under a config dir', () => {
    // The asymmetry is the design, not an oversight: the unlisted-`.json` rule guards a shape
    // nobody has named yet, which is right for a program's private state and wrong for a
    // repository whose `.mcp.json` is the reason it was imported at all.
    expect(withProject().allows(`${PROJECT}\\.mcp.json`)).toBe(true);
    expect(withProject().allows(`${CFG}\\statsig\\x.json`)).toBe(false);
  });

  const refused: readonly [string, string][] = [
    ['secrets.key', 'a .key is never read, wherever it lives'],
    ['.credentials.json', 'nor are credentials'],
    ['deep\\nested\\id.key', 'and not by being buried'],
  ];

  for (const [relative, why] of refused) {
    it(`refuses ${relative} under a project — ${why}`, () => {
      expect(withProject().refusal(`${PROJECT}\\${relative}`)).toContain('SEC-FS-2');
    });
  }

  it('refuses the project directory itself, which is not a file', () => {
    expect(withProject().allows(PROJECT)).toBe(false);
  });

  it('refuses traversal out of a project root', () => {
    const escape = `${PROJECT}\\..\\..\\..\\.claude-365\\daemon\\control.key`;

    expect(withProject().refusal(escape)).toBe('contains .. after normalisation');
  });

  it('refuses a sibling directory that merely starts like the project', () => {
    expect(withProject().allows(`${PROJECT}-old\\CLAUDE.md`)).toBe(false);
  });

  it('screens a config directory by the config rules even when a project root contains it', () => {
    // The ordering that is doing security work. `ProjectImport` refuses this folder at import
    // time; this asserts the second lock, so swapping the two branches for readability fails here.
    const wide = new ReadPolicy([CFG, OTHER], ['C:\\Users\\x']);

    expect(wide.allows(`${CFG}\\daemon\\control.key`)).toBe(false);
    expect(wide.allows(`${CFG}\\statsig\\x.json`)).toBe(false);
    expect(wide.allows(`${CFG}\\.credentials.json`)).toBe(false);
    // Allowed under project rules (D36 deny-lists a root) and refused under config rules, which is
    // what makes it the example: the config branch runs first whatever else contains the path.
    expect(wide.allows(`${CFG}\\AGENTS.md`)).toBe(false);
    // And the rest of the wide root is still a project, which is the other half of the ordering.
    expect(wide.allows('C:\\Users\\x\\Documents\\notes.md')).toBe(true);
  });

  it('ignores an empty project root rather than opening the machine', () => {
    expect(new ReadPolicy([CFG], ['']).allows('C:\\anything\\at\\all.md')).toBe(false);
  });

  it('does not care about separators or case here either', () => {
    expect(withProject().allows('c:/USERS/x/Documents/development/APP-NEXT/CLAUDE.md')).toBe(true);
  });
});
