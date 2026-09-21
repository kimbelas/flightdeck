// `SpawnProcessStream` — chunks in, whole lines out, against a real child process (P4-T4).
//
// The reassembly is the thing worth testing and the thing a fake cannot establish. `stream-json`
// puts one JSON document per line, and a chunk boundary falls wherever the pipe buffer happened to
// fill — halfway through a UUID as readily as between records. A caller that split each chunk on
// `\n` would produce two broken documents about once a run, which presents as "a record went
// missing" rather than as a parsing bug.
//
// It spawns `node` rather than `claude.exe`: what is under test is the port, not the CLI, and a
// child whose output this file controls is the only way to force a split mid-line.
import { describe, expect, it } from 'vitest';
import { SpawnProcessStream } from '../../../core/adapters/claude-cli/spawn-process-stream.ts';

const NODE = process.execPath;

interface Run {
  readonly lines: readonly string[];
  readonly code: number;
  readonly timedOut: boolean;
  readonly stderr: string;
}

async function run(script: string, timeoutMs = 20_000): Promise<Run> {
  const lines: string[] = [];
  const result = await new SpawnProcessStream().run(
    { command: NODE, args: ['-e', script], env: { ...process.env }, timeoutMs },
    { onLine: (line) => lines.push(line) },
  );
  return { lines, ...result };
}

describe('SpawnProcessStream — whole lines', () => {
  it('delivers one line per newline, in order', async () => {
    const result = await run('process.stdout.write("a\\nb\\nc\\n")');

    expect(result.lines).toEqual(['a', 'b', 'c']);
    expect(result.code).toBe(0);
  });

  it('rejoins a line split across two writes', async () => {
    // The case the port exists for. Two writes, one newline, one line out — not two.
    const script =
      'process.stdout.write(\'{"type":"sys\'); setTimeout(() => process.stdout.write(\'tem"}\\n\'), 30);';
    const result = await run(script);

    expect(result.lines).toEqual(['{"type":"system"}']);
  });

  it('drops a trailing partial line rather than delivering half a record', async () => {
    // Half a JSON document is not a record. Delivering it would only move the discard one layer up
    // into the parser, where it would look like a malformed line from the CLI.
    const result = await run('process.stdout.write("whole\\nhalf")');

    expect(result.lines).toEqual(['whole']);
  });

  it('strips a carriage return, so a CRLF child does not leave one on every record', async () => {
    const result = await run('process.stdout.write("a\\r\\nb\\r\\n")');

    expect(result.lines).toEqual(['a', 'b']);
  });

  it('decodes a multi-byte character split across two chunks', async () => {
    // `chunk.toString()` per chunk turns a split em dash into two replacement characters, and an
    // answer with one in it is the ordinary case here rather than the exotic one.
    const script = [
      'const b = Buffer.from("x—y\\n", "utf8");',
      'process.stdout.write(b.subarray(0, 2));',
      'setTimeout(() => process.stdout.write(b.subarray(2)), 30);',
    ].join('');
    const result = await run(script);

    expect(result.lines).toEqual(['x—y']);
  });
});

describe('SpawnProcessStream — how a run ends', () => {
  it('reports a non-zero exit as a value, never a throw', async () => {
    const result = await run('process.stdout.write("one\\n"); process.exit(3);');

    expect(result.code).toBe(3);
    expect(result.lines).toEqual(['one']);
  });

  it('collects stderr without mixing it into the lines', async () => {
    const result = await run(
      'process.stderr.write("trouble\\n"); process.stdout.write("fine\\n");',
    );

    expect(result.lines).toEqual(['fine']);
    expect(result.stderr).toContain('trouble');
  });

  it('kills a child that outstays the timeout, and says so', async () => {
    // What is asserted is the TIMEOUT, not what the child managed to say first. An earlier
    // version also expected the line written before the kill to arrive, and it failed about one
    // run in three under the full suite: on Windows `kill()` is TerminateProcess, so whatever is
    // still in the pipe when it fires is simply gone. That is a real property of the platform,
    // not a flake to paper over with a longer budget — so the test no longer claims otherwise.
    const result = await run('setInterval(() => {}, 1000);', 1000);

    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it('answers -1 for a binary that does not exist, rather than rejecting', async () => {
    // G.10: `spawn UNKNOWN` threw on the calling stack, became an unhandled rejection, and took
    // core down with hooks installed — an error banner in every live session.
    const result = await new SpawnProcessStream().run(
      { command: 'C:\\nope\\nothing.exe', args: [], env: {}, timeoutMs: 5000 },
      { onLine: () => undefined },
    );

    expect(result.code).toBe(-1);
  });

  it('waits for stdout to drain before it answers', async () => {
    // `close` rather than `exit`: a run whose last record arrived after we stopped listening is a
    // run with no `done`.
    const result = await run('process.stdout.write("a\\nb\\nc\\nd\\ne\\n"); process.exit(0);');

    expect(result.lines).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
