// P7-T5 — what the receiver reads out of an OTLP metrics export, and what it refuses to.
import { describe, expect, it } from 'vitest';
import { parseOtlpMetrics } from '../../contracts/otlp-metrics.ts';
import { attr, EMAIL, metricsBody, OTHER, SESSION, standard, sumMetric } from './otlp-payloads.ts';

describe('parseOtlpMetrics', () => {
  it('reads cost, split by model, from a delta sum', () => {
    const body = metricsBody([
      sumMetric('claude_code.cost.usage', [
        { value: 0.25, attributes: [...standard(SESSION), attr('model', 'claude-opus-5')] },
      ]),
    ]);

    expect(parseOtlpMetrics(body)).toEqual({
      points: [
        {
          sessionId: SESSION,
          metric: 'cost',
          kind: undefined,
          model: 'claude-opus-5',
          value: 0.25,
        },
      ],
      skipped: 0,
    });
  });

  it('maps every documented metric name, and keeps `type` as the kind', () => {
    const typed = (type: string): readonly ReturnType<typeof attr>[] => [
      ...standard(SESSION),
      attr('type', type),
    ];
    const body = metricsBody([
      sumMetric('claude_code.token.usage', [{ value: 1200, attributes: typed('cacheRead') }]),
      sumMetric('claude_code.active_time.total', [{ value: 4.5, attributes: typed('cli') }]),
      sumMetric('claude_code.lines_of_code.count', [{ value: 12, attributes: typed('added') }]),
      sumMetric('claude_code.commit.count', [{ value: 1, attributes: standard(SESSION) }]),
      sumMetric('claude_code.pull_request.count', [{ value: 1, attributes: standard(SESSION) }]),
    ]);

    const points = parseOtlpMetrics(body)?.points ?? [];

    expect(points.map((point) => [point.metric, point.kind, point.value])).toEqual([
      ['tokens', 'cacheRead', 1200],
      ['activeTime', 'cli', 4.5],
      ['lines', 'added', 12],
      ['commits', undefined, 1],
      ['pullRequests', undefined, 1],
    ]);
  });

  // protobuf's JSON mapping lets an int64 be a string, and the OTel JS serialiser uses both.
  it.each([
    { value: '42', label: 'a string int64' },
    { value: 42, label: 'a number int64' },
  ])('reads asInt as $label', ({ value }) => {
    const body = metricsBody([
      sumMetric('claude_code.commit.count', [
        { value, attributes: standard(SESSION), double: false },
      ]),
    ]);

    expect(parseOtlpMetrics(body)?.points[0]?.value).toBe(42);
  });

  it('attributes a point with no session id to the resource session', () => {
    const body = metricsBody([sumMetric('claude_code.commit.count', [{ value: 1 }])]);

    expect(parseOtlpMetrics(body)?.points[0]?.sessionId).toBe(SESSION);
  });

  it('lets a point name its own session over the resource', () => {
    const body = metricsBody([
      sumMetric('claude_code.commit.count', [{ value: 1, attributes: standard(OTHER) }]),
    ]);

    expect(parseOtlpMetrics(body)?.points[0]?.sessionId).toBe(OTHER);
  });

  it('never reads an attribute outside the allowlist', () => {
    const body = metricsBody([
      sumMetric('claude_code.cost.usage', [{ value: 1, attributes: standard(SESSION) }]),
    ]);

    expect(JSON.stringify(parseOtlpMetrics(body))).not.toContain(EMAIL);
  });

  // Summing a running total as if it were a delta doubles every figure on the next export.
  it.each([2, 'AGGREGATION_TEMPORALITY_CUMULATIVE', 0])(
    'skips temporality %s rather than summing it',
    (temporality) => {
      const body = metricsBody([
        sumMetric('claude_code.cost.usage', [{ value: 3 }, { value: 4 }], temporality),
      ]);

      expect(parseOtlpMetrics(body)).toEqual({ points: [], skipped: 2 });
    },
  );

  it('accepts the delta enum by name', () => {
    const body = metricsBody([
      sumMetric('claude_code.commit.count', [{ value: 1 }], 'AGGREGATION_TEMPORALITY_DELTA'),
    ]);

    expect(parseOtlpMetrics(body)?.points).toHaveLength(1);
  });

  it.each([
    { value: -1, label: 'a negative delta' },
    { value: 'lots', label: 'a word' },
    { value: Number.POSITIVE_INFINITY, label: 'infinity' },
  ])('skips a point whose value is $label', ({ value }) => {
    const body = metricsBody([sumMetric('claude_code.cost.usage', [{ value }])]);

    expect(parseOtlpMetrics(body)).toEqual({ points: [], skipped: 1 });
  });

  it('skips a point that cannot be attributed to any session', () => {
    const body = metricsBody(
      [sumMetric('claude_code.cost.usage', [{ value: 1 }])],
      [attr('session.id', 'not-a-session')],
    );

    expect(parseOtlpMetrics(body)).toEqual({ points: [], skipped: 1 });
  });

  it('drops a label that is not a short plain word, keeping the point', () => {
    const body = metricsBody([
      sumMetric('claude_code.cost.usage', [{ value: 1, attributes: [attr('model', 'a b<c>')] }]),
    ]);

    expect(parseOtlpMetrics(body)?.points[0]?.model).toBeUndefined();
  });

  it('ignores metrics it does not know without counting them', () => {
    const body = metricsBody([
      sumMetric('claude_code.session.count', [{ value: 1 }]),
      sumMetric('claude_code.code_edit_tool.decision', [{ value: 1 }]),
      { name: 'claude_code.cost.usage', gauge: { dataPoints: [{ asDouble: 1 }] } },
    ]);

    expect(parseOtlpMetrics(body)).toEqual({ points: [], skipped: 0 });
  });

  it.each([undefined, null, [], 'text', {}, { resourceMetrics: 'nope' }])(
    'answers undefined for %j, which is not an export',
    (value) => {
      expect(parseOtlpMetrics(value)).toBeUndefined();
    },
  );

  it('answers an empty batch for an envelope with nothing in it', () => {
    expect(parseOtlpMetrics({ resourceMetrics: [{}, 3, { scopeMetrics: 'x' }] })).toEqual({
      points: [],
      skipped: 0,
    });
  });
});
