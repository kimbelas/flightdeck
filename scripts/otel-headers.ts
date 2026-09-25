// `node scripts/otel-headers.ts` — Claude Code's `otelHeadersHelper` for the OTLP receiver (P7-T5).
//
// Claude Code runs the helper at session start and every 29 minutes and uses the JSON object it
// prints as the exporter's headers (code.claude.com/docs/en/monitoring-usage, "Dynamic headers").
// This one prints the ingest key as a bearer, read from its ACL'd file at the moment it is asked,
// so the key is never copied into a settings file (SEC-HTTP-7, SEC-DATA-4).
//
// **Stdout is the interface and it carries the key**, which is the one exception to "never print
// the ingest key": the reader is Claude Code, not a terminal. Nothing else is ever printed — a
// stray line would be invalid JSON, and an invalid helper stops every export until it is fixed.
import { readIngestKey } from '../contracts/ingest-key.ts';
import { otelHeaders } from '../contracts/otlp-receiver.ts';

process.stdout.write(JSON.stringify(otelHeaders(readIngestKey())));
