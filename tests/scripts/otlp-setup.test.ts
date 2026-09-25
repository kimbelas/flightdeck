// P7-T5 — `npm run otlp` prints the switch and writes nothing; the helper prints only JSON.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { err, ok } from '../../core/shared/result.ts';
import { renderOtlpSetup } from '../../scripts/otlp-setup.ts';

const ROOT = 'C:\\work\\flightdeck';

describe('renderOtlpSetup', () => {
  it('names the helper with forward slashes, so any shell can run it', () => {
    const text = renderOtlpSetup(ROOT, err('no token file')).join('\n');

    expect(text).toContain(
      '"otelHeadersHelper": "node \\"C:/work/flightdeck/scripts/otel-headers.ts\\""',
    );
  });

  it('prints the env block and the core switch', () => {
    const text = renderOtlpSetup(ROOT, err('down')).join('\n');

    expect(text).toContain('"OTEL_EXPORTER_OTLP_PROTOCOL": "http/json"');
    expect(text).toContain('"OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:4950"');
    expect(text).toContain("SetEnvironmentVariable('FLIGHTDECK_OTLP', '1', 'User')");
    expect(text).toContain('Flightdeck writes none of this');
  });

  it.each([
    { live: err('no token file'), says: 'unknown (no token file)' },
    { live: ok({ enabled: false, sessions: 0, skipped: 0 }), says: 'off (core was started' },
    { live: ok({ enabled: true, sessions: 3, skipped: 1 }), says: 'on — 3 sessions heard' },
  ])('says the receiver is $says', ({ live, says }) => {
    expect(renderOtlpSetup(ROOT, live)[0]).toContain(says);
  });
});

describe('otel-headers', () => {
  const script = join(import.meta.dirname, '..', '..', 'scripts', 'otel-headers.ts');

  function run(keyFile: string): string {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, FD_INGEST_KEY_FILE: keyFile },
      encoding: 'utf8',
    });
    return result.stdout;
  }

  it('prints the ingest key as a bearer, and nothing else', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fd-otel-')), 'ingest-key');
    writeFileSync(file, `${'f'.repeat(64)}\n`, 'utf8');

    expect(JSON.parse(run(file))).toEqual({ Authorization: `Bearer ${'f'.repeat(64)}` });
  });

  it('prints an empty object when there is no key', () => {
    expect(run(join(tmpdir(), 'fd-otel-missing', 'ingest-key'))).toBe('{}');
  });
});
