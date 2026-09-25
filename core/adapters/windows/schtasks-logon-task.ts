// `schtasks.exe`, behind the `LogonTask` port — P1-T12, D21, SEC-OPS-3.
//
// **The XML file is written UTF-16LE with a BOM, and that is not a preference.** `schtasks /create
// /xml` reads the file as Unicode; handed UTF-8 it fails with "The task XML is malformed" and
// names no line, which is an hour of looking at correct XML. The declaration this project writes
// says `encoding="UTF-16"` for the same reason.
//
// It goes to the scratch directory rather than the repo: it is a temporary, and one carrying the
// machine's account name (SEC-DATA-1) does not belong in a public working tree even briefly.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogonTask, LogonTaskState } from '../../ports/logon-task.ts';
import { logonTaskDefinition, type LogonTaskDefinitionParts } from './logon-task-definition.ts';

const SCHTASKS = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'schtasks.exe');

export class SchtasksLogonTask implements LogonTask {
  private readonly parts: LogonTaskDefinitionParts;
  private readonly name: string;

  /** `name` overrides the definition's own only for a probe registration (RESEARCH.md G.17). */
  constructor(parts: LogonTaskDefinitionParts, name: string = parts.name) {
    this.parts = parts;
    this.name = name;
  }

  /** @throws never — see the port. A machine with no such task is the ordinary first answer. */
  public describe(): LogonTaskState {
    try {
      const definition = execFileSync(SCHTASKS, ['/query', '/tn', this.name, '/xml', 'ONE'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { name: this.name, installed: true, definition };
    } catch {
      return { name: this.name, installed: false, definition: undefined };
    }
  }

  public plan(): string {
    return logonTaskDefinition(this.parts);
  }

  /** @throws if schtasks refuses the definition. `/f` replaces an existing task of this name. */
  public install(): void {
    const directory = mkdtempSync(join(tmpdir(), 'flightdeck-task-'));
    const file = join(directory, 'logon-task.xml');
    try {
      // The BOM is written explicitly: Node's 'utf16le' encoding does not add one, and schtasks
      // uses it to decide the file is Unicode at all.
      writeFileSync(file, `\uFEFF${this.plan()}`, { encoding: 'utf16le' });
      execFileSync(SCHTASKS, ['/create', '/tn', this.name, '/xml', file, '/f'], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  /** @throws if schtasks refuses. A task that was not there exits non-zero and is not an error. */
  public remove(): void {
    if (!this.describe().installed) return;
    execFileSync(SCHTASKS, ['/delete', '/tn', this.name, '/f'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  }
}
