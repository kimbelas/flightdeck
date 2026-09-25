// P7-T5 — an event is a name and a session, and nothing a record carries besides.
import { describe, expect, it } from 'vitest';
import { parseOtlpLogs } from '../../contracts/otlp-logs.ts';
import { attr, EMAIL, logRecord, logsBody, OTHER, PROMPT, SESSION } from './otlp-payloads.ts';

describe('parseOtlpLogs', () => {
  it('reads each counted event with its session', () => {
    const body = logsBody([
      logRecord('user_prompt', SESSION),
      logRecord('tool_result', OTHER, [attr('tool_name', 'Bash')]),
      logRecord('api_request', SESSION, [attr('cost_usd', '0.01')]),
    ]);

    expect(parseOtlpLogs(body)).toEqual({
      events: [
        { sessionId: SESSION, name: 'user_prompt' },
        { sessionId: OTHER, name: 'tool_result' },
        { sessionId: SESSION, name: 'api_request' },
      ],
      skipped: 0,
    });
  });

  // The whole reason the parser is an allowlist: a prompt the owner opted into logging.
  it('never reads the prompt, the email or any other attribute', () => {
    const body = logsBody([logRecord('user_prompt', SESSION, [attr('prompt', PROMPT)])]);

    const text = JSON.stringify(parseOtlpLogs(body));

    expect(text).not.toContain(PROMPT);
    expect(text).not.toContain(EMAIL);
  });

  it('falls back to the body for the name when event.name is absent', () => {
    const body = logsBody([
      {
        body: { stringValue: 'claude_code.api_error' },
        attributes: [attr('session.id', SESSION)],
      },
    ]);

    expect(parseOtlpLogs(body)?.events).toEqual([{ sessionId: SESSION, name: 'api_error' }]);
  });

  it('attributes a record with no session id to the resource session', () => {
    const body = logsBody([{ attributes: [attr('event.name', 'tool_decision')] }]);

    expect(parseOtlpLogs(body)?.events).toEqual([{ sessionId: SESSION, name: 'tool_decision' }]);
  });

  it.each([
    { record: logRecord('api_response_body', SESSION), label: 'an uncounted event' },
    { record: logRecord('managed_settings_resolved', SESSION), label: 'a configuration event' },
    { record: { body: { stringValue: 'something else' } }, label: 'a record with no name' },
    { record: { body: { kvlistValue: {} } }, label: 'a record whose body is not a string' },
  ])('skips $label', ({ record }) => {
    expect(parseOtlpLogs(logsBody([record]))).toEqual({ events: [], skipped: 1 });
  });

  it('skips a record whose session cannot be known', () => {
    const body = {
      resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [attr('event.name', 'x')] }] }] }],
    };

    expect(parseOtlpLogs(body)).toEqual({ events: [], skipped: 1 });
  });

  it.each([undefined, null, [], 'text', {}, { resourceLogs: {} }])(
    'answers undefined for %j, which is not an export',
    (value) => {
      expect(parseOtlpLogs(value)).toBeUndefined();
    },
  );
});
