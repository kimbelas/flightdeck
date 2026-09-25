// Scaffolding for the two `transcript-indexer` files — `reconciler-harness.ts`'s split.
//
// The indexer takes seven collaborators, and the interesting one is the file: a test writes what a
// transcript holds and the fake slices it from whatever cursor it is handed, which is what makes
// "the slice ended mid-record" three lines instead of a fixture of a half-written file. Everything
// here is fakes — no timers, no filesystem, no database.
import { setImmediate } from 'node:timers';
import { TranscriptIndexer } from '../../../core/application/transcript-indexer.ts';
import { ReadPolicy } from '../../../core/domain/read-policy.ts';
import type { CatalogueEntry } from '../../../core/ports/transcript-catalogue.ts';
import type {
  TranscriptCursor,
  TranscriptEnd,
  TranscriptFile,
  TranscriptSlice,
} from '../../../core/ports/transcript-file.ts';
import { FakeClock } from '../../fakes/fake-clock.ts';
import { FakeLogger } from '../../fakes/fake-logger.ts';
import { FakeScheduler } from '../../fakes/fake-scheduler.ts';
import { FakeStore } from '../../fakes/fake-store.ts';

const HOME = 'C:\\home';
export const CONFIG = `${HOME}\\.claude-365`;
export const SESSION = 'aaaaaaaa-0000-0000-0000-000000000000';
export const PATH = `${CONFIG}\\projects\\C--work\\${SESSION}.jsonl`;

export function line(text: string, kind: 'user' | 'assistant' = 'user'): string {
  if (kind === 'user') {
    return JSON.stringify({
      type: 'user',
      timestamp: '2026-09-21T10:00:00.000Z',
      message: { content: text },
    });
  }
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-21T10:00:01.000Z',
    message: { content: [{ type: 'text', text }] },
  });
}

export const ENTRY: CatalogueEntry = {
  path: PATH,
  subscription: '365',
  sessionId: SESSION,
  projectKey: 'C--work',
  bytes: 1_000_000,
};

/** A file whose content the test writes, sliced from whatever cursor it is handed. */
class FakeTranscriptFile implements TranscriptFile {
  public readonly reads: TranscriptCursor[] = [];
  private content = '';
  private identity = 'dev:1:2026';
  private unreadable = false;

  public holds(content: string): void {
    this.content = content;
  }

  /** A fresh file at the same path — what `--resume` produces (`transcript-file.ts`). */
  public replacedWith(content: string, identity: string): void {
    this.content = content;
    this.identity = identity;
  }

  public willNotRead(): void {
    this.unreadable = true;
  }

  public read(path: string, cursor: TranscriptCursor): Promise<TranscriptSlice> {
    this.reads.push(cursor);
    if (this.unreadable) {
      return Promise.resolve({
        text: '',
        from: cursor.offset,
        to: cursor.offset,
        identity: cursor.identity,
        restarted: false,
        unreadable: true,
      });
    }
    const restarted = cursor.identity !== '' && cursor.identity !== this.identity;
    const from = restarted ? 0 : cursor.offset;
    const text = this.content.slice(from);
    return Promise.resolve({
      text,
      from,
      to: from + Buffer.byteLength(text, 'utf8'),
      identity: this.identity,
      restarted,
      unreadable: false,
    });
  }

  public tail(): Promise<TranscriptEnd> {
    return Promise.resolve({ text: '', unreadable: true });
  }
}

export interface Built {
  readonly indexer: TranscriptIndexer;
  readonly store: FakeStore;
  readonly files: FakeTranscriptFile;
  readonly scheduler: FakeScheduler;
}

/** Lets the pass `start()` fires without returning a promise run to completion. */
export async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export function build(entries: readonly CatalogueEntry[] = [ENTRY]): Built {
  const store = new FakeStore();
  const files = new FakeTranscriptFile();
  const scheduler = new FakeScheduler();
  const indexer = new TranscriptIndexer({
    catalogue: { list: () => Promise.resolve(entries) },
    files,
    store,
    policy: new ReadPolicy([CONFIG]),
    scheduler,
    clock: new FakeClock(),
    logger: new FakeLogger(),
  });
  return { indexer, store, files, scheduler };
}
