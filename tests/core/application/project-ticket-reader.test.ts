// The ticket ids on disk in one project — P9-T3, SEC-FS-1, SEC-UI-2.
//
// The fixture is xpert-new's shape as measured on 2026-09-25, trimmed: `specs/` holds three ticket
// folders and `completed/`, `state/` holds ticket notes beside the names that must NOT come
// through — a resume prompt, a patch, a findings note, a folder of files, an archive and a commit
// message. `FakeProjectPaths` screens the canonical path, so the junction case is real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTicketReader } from '../../../core/application/project-ticket-reader.ts';
import { MAX_TICKETS } from '../../../contracts/project-tickets.ts';
import { childPath } from '../../../contracts/windows-path.ts';
import { FakeProjectFiles } from '../../fakes/fake-project-files.ts';
import { FakeProjectPaths } from '../../fakes/fake-project-paths.ts';

const ROOT = 'C:\\Users\\belas\\Documents\\development\\xpert-new';
const CLAUDE = childPath(ROOT, '.claude');
const SPECS = childPath(CLAUDE, 'specs');
const STATE = childPath(CLAUDE, 'state');

let files: FakeProjectFiles;
let paths: FakeProjectPaths;
let reader: ProjectTicketReader;

beforeEach(() => {
  files = new FakeProjectFiles();
  paths = new FakeProjectPaths().root(ROOT);
  reader = new ProjectTicketReader({ paths, files });
});

function populate(): void {
  files.directory(SPECS, ['XWEB-2113', 'XWEB-2114', 'XWEB-2126', 'completed']);
  files.directory(childPath(SPECS, 'XWEB-2113'), [], 300);
  files.directory(childPath(SPECS, 'XWEB-2114'), [], 200);
  files.directory(childPath(SPECS, 'XWEB-2126'), [], 400);
  files.directory(childPath(SPECS, 'completed'), ['XWEB-1001'], 999);
  const noise = [
    'RESUME-PROMPT.md',
    'XWEB-1871-r2.patch',
    'XWEB-1871-r2-files',
    'XWEB-1881-findings.md',
    'archive',
    'commit-msg-1339-app.txt',
  ];
  files.directory(STATE, ['XWEB-1830.md', 'XWEB-1871.md', 'XWEB-2113.md', ...noise]);
  files.file(childPath(STATE, 'XWEB-1830.md'), 'secret contents', 100);
  files.file(childPath(STATE, 'XWEB-1871.md'), '', 150);
  files.file(childPath(STATE, 'XWEB-2113.md'), '', 500);
  for (const name of noise) files.file(childPath(STATE, name), '', 999);
}

describe('tickets', () => {
  it('lists every ticket id in both folders, newest first', async () => {
    populate();
    expect(await reader.tickets(CLAUDE)).toEqual([
      'XWEB-2113',
      'XWEB-2126',
      'XWEB-2114',
      'XWEB-1871',
      'XWEB-1830',
    ]);
  });

  it('lists an id in both folders once, at the later of its two mtimes', async () => {
    populate();
    const tickets = await reader.tickets(CLAUDE);
    expect(tickets.filter((id) => id === 'XWEB-2113')).toHaveLength(1);
    expect(tickets[0]).toBe('XWEB-2113');
  });

  it('keeps out every name that is not an id — and does not descend into completed/', async () => {
    populate();
    const tickets = await reader.tickets(CLAUDE);
    for (const bad of ['RESUME-PROMPT', 'XWEB-1871-R2', 'XWEB-1881-FINDINGS', 'XWEB-1001']) {
      expect(tickets).not.toContain(bad);
    }
    expect(files.listed.some((path) => path.endsWith('completed'))).toBe(false);
  });

  it('stats only ticket-shaped names and never opens a file', async () => {
    populate();
    const read = vi.spyOn(files, 'read');
    await reader.tickets(CLAUDE);
    expect(read).not.toHaveBeenCalled();
  });

  it('takes a spec only as a folder and a state note only as a file', async () => {
    files.directory(SPECS, ['XWEB-1.md', 'XWEB-2']);
    files.file(childPath(SPECS, 'XWEB-1.md'), '');
    files.file(childPath(SPECS, 'XWEB-2'), '');
    files.directory(STATE, ['XWEB-3.md']);
    files.directory(childPath(STATE, 'XWEB-3.md'), []);
    expect(await reader.tickets(CLAUDE)).toEqual([]);
  });

  it('upper-cases an id the way a typed one is', async () => {
    files.directory(STATE, ['xweb-7.md']);
    files.file(childPath(STATE, 'xweb-7.md'), '');
    expect(await reader.tickets(CLAUDE)).toEqual(['XWEB-7']);
  });

  it('answers nothing for a project with neither folder — claude-kit and pdf-editor', async () => {
    expect(await reader.tickets(CLAUDE)).toEqual([]);
  });

  it('answers nothing through a junction that points out of the root', async () => {
    populate();
    paths.junction(STATE, 'C:\\Users\\belas\\.claude-365\\projects');
    paths.junction(SPECS, 'C:\\Users\\belas\\.claude-365\\projects');
    expect(await reader.tickets(CLAUDE)).toEqual([]);
  });

  it('caps the list at the newest MAX_TICKETS', async () => {
    const names = [...Array(MAX_TICKETS + 5).keys()].map((n) => `TK-${String(n)}`);
    files.directory(SPECS, names);
    names.forEach((name, n) => {
      files.directory(childPath(SPECS, name), [], n);
    });
    const tickets = await reader.tickets(CLAUDE);
    expect(tickets).toHaveLength(MAX_TICKETS);
    expect(tickets[0]).toBe(`TK-${String(MAX_TICKETS + 4)}`);
  });
});
