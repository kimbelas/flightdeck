// P7-T5 — the switch, and the block the owner would add by hand.
import { describe, expect, it } from 'vitest';
import { CORE_ORIGIN } from '../../contracts/origins.ts';
import {
  claudeTelemetryEnv,
  otelHeaders,
  otlpReceiverEnabled,
  OTLP_RECEIVER_ENV_VAR,
} from '../../contracts/otlp-receiver.ts';

describe('otlpReceiverEnabled', () => {
  it('is off when the variable is absent — the default', () => {
    expect(otlpReceiverEnabled({})).toBe(false);
  });

  it.each(['0', 'true', 'yes', '', ' 1'])('is off for %j', (value) => {
    expect(otlpReceiverEnabled({ [OTLP_RECEIVER_ENV_VAR]: value })).toBe(false);
  });

  it('is on for exactly 1', () => {
    expect(otlpReceiverEnabled({ FLIGHTDECK_OTLP: '1' })).toBe(true);
  });
});

describe('claudeTelemetryEnv', () => {
  it('points http/json at core, on loopback, with deltas', () => {
    expect(claudeTelemetryEnv()).toEqual({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_METRICS_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: CORE_ORIGIN,
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
    });
    expect(CORE_ORIGIN).toBe('http://127.0.0.1:4950');
  });

  it('turns no content logging on', () => {
    expect(
      Object.keys(claudeTelemetryEnv()).filter((name) => name.startsWith('OTEL_LOG_')),
    ).toEqual([]);
  });
});

describe('otelHeaders', () => {
  it('is the ingest key as a bearer', () => {
    expect(otelHeaders('k'.repeat(64))).toEqual({ Authorization: `Bearer ${'k'.repeat(64)}` });
  });

  it('is empty rather than an error when there is no key', () => {
    expect(otelHeaders(undefined)).toEqual({});
  });
});
