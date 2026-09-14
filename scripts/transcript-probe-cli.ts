// P1-T7 — prints what feed 4 makes of the real corpus. `node scripts/transcript-probe-cli.ts [n]`
//
// Separated from `transcript-probe.ts` the way every other probe here is: the measurement is
// unit-testable and this is the printing.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { findTranscripts, readWhole, type TranscriptReading } from './transcript-probe.ts';

const ROOTS = [
  join(homedir(), '.claude-365', 'projects'),
  join(homedir(), '.claude-isg', 'projects'),
];

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function line(path: string, reading: TranscriptReading): string {
  const rate =
    reading.ms === 0 ? '—' : `${(reading.bytes / 1_048_576 / (reading.ms / 1000)).toFixed(0)} MB/s`;
  return [
    megabytes(reading.bytes).padStart(8),
    `${String(reading.ms)} ms`.padStart(8),
    rate.padStart(9),
    String(reading.records).padStart(7),
    String(reading.ignored).padStart(8),
    String(reading.unknown).padStart(8),
    String(reading.oversize).padStart(6),
    path.slice(-28),
  ].join(' ');
}

async function main(): Promise<number> {
  const limit = Number(process.argv[2] ?? '12');
  const transcripts = findTranscripts(ROOTS);
  console.log(`${String(transcripts.length)} transcripts; reading the largest ${String(limit)}\n`);
  console.log(
    ['   bytes', '    read', '     rate', 'records', ' ignored', ' unknown', ' over', ' file'].join(
      ' ',
    ),
  );

  let unknown = 0;
  let oversize = 0;
  let bytes = 0;
  let ms = 0;
  const digests: TranscriptReading[] = [];
  for (const path of transcripts.slice(0, limit)) {
    const reading = await readWhole(path);
    console.log(line(path, reading));
    unknown += reading.unknown;
    oversize += reading.oversize;
    bytes += reading.bytes;
    ms += reading.ms;
    digests.push(reading);
  }

  console.log(
    `\ntotal ${megabytes(bytes)} in ${String(ms)} ms — ${String(unknown)} unknown record type(s), ` +
      `${String(oversize)} line(s) over the cap`,
  );
  const withAway = digests.filter((reading) => reading.digest.away !== undefined).length;
  const withCost = digests.filter((reading) => reading.digest.costUsd !== undefined).length;
  const withTitle = digests.filter((reading) => reading.digest.title !== undefined).length;
  console.log(
    `enrichment: ${String(withTitle)} titled, ${String(withAway)} with an away summary, ` +
      `${String(withCost)} with cost`,
  );
  // The one number that decides whether this build is behind Claude Code.
  return unknown === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && statSync(process.argv[1]).isFile()) {
  process.exitCode = await main();
}
