// `npm run otlp` — prints the OTLP receiver's state and how to turn it on (P7-T5). Writes nothing.
import { join } from 'node:path';
import { readTelemetry, renderOtlpSetup } from './otlp-setup.ts';

const lines = renderOtlpSetup(join(import.meta.dirname, '..'), await readTelemetry());
for (const line of lines) console.log(line);
