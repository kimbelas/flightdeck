// Locks in the four hook payload shapes measured in P0-T3 (RESEARCH.md F.1.2).
//
// P1-T5 parses these for real. The shapes differ by event and by session kind, and the differences
// are the kind that produce a receiver that works on the machine it was written on: a `--bg`
// `SessionStart` carries the session's name and a headless one does not, `Stop` carries model text
// and `SessionStart` does not, and `scratchpad_dir` exists only on background sessions.
//
// The transport line in each fixture is load-bearing too. `SessionStart` was captured from a
// **command** handler because the `http` transport never delivers it at all (F.1.1) — so a
// receiver that waited for one over HTTP would wait forever, and this file is where that is
// written down next to the evidence.
import { describe, expect, it } from 'vitest';
import { parseHookPayload } from '../../contracts/hook-event.ts';
import sessionStartBackground from '../../fixtures/hooks/session-start-background.json' with { type: 'json' };
import sessionStartHeadless from '../../fixtures/hooks/session-start-headless.json' with { type: 'json' };
import stopBackground from '../../fixtures/hooks/stop-background.json' with { type: 'json' };
import stopHeadless from '../../fixtures/hooks/stop-headless.json' with { type: 'json' };

describe('the captured payloads still parse', () => {
  it('accepts every shape P0-T3 observed', () => {
    for (const capture of [
      sessionStartBackground,
      sessionStartHeadless,
      stopBackground,
      stopHeadless,
    ]) {
      expect(parseHookPayload(capture.payload)).toBeDefined();
    }
  });

  it('keeps the four fields every payload carries', () => {
    const parsed = parseHookPayload(stopHeadless.payload);

    expect(parsed).toMatchObject({
      session_id: stopHeadless.payload.session_id,
      hook_event_name: 'Stop',
      transcript_path: stopHeadless.payload.transcript_path,
      cwd: stopHeadless.payload.cwd,
    });
  });
});

describe('what differs by session kind', () => {
  it('gives a background session a scratchpad dir and a headless one none', () => {
    expect(parseHookPayload(stopBackground.payload)?.scratchpad_dir).toBeDefined();
    expect(parseHookPayload(stopHeadless.payload)?.scratchpad_dir).toBeUndefined();
  });

  it('names a --bg session on SessionStart, which is the only place the name appears', () => {
    // `session_title` is the `-n` name. `Stop` does not carry it, so a receiver that wanted the
    // name from a Stop would never get one (F.1.2).
    expect(parseHookPayload(sessionStartBackground.payload)?.session_title).toBeDefined();
    expect(parseHookPayload(sessionStartHeadless.payload)?.session_title).toBeUndefined();
    expect(parseHookPayload(stopBackground.payload)?.session_title).toBeUndefined();
  });
});

describe('what differs by event', () => {
  it('carries model text on Stop, and nowhere else', () => {
    // The reason SEC-UI-2 reaches into the receiver at all: this is model-generated text arriving
    // over HTTP on the one route with no Origin to check.
    expect(parseHookPayload(stopBackground.payload)?.last_assistant_message).toBeDefined();
    expect(parseHookPayload(sessionStartBackground.payload)?.last_assistant_message).toBeUndefined();
  });

  it('carries the prompt id on Stop and the source on SessionStart', () => {
    expect(parseHookPayload(stopBackground.payload)?.prompt_id).toBeDefined();
    expect(parseHookPayload(sessionStartBackground.payload)?.source).toBe('startup');
  });
});

describe('the transport each shape came from', () => {
  it('records that SessionStart came from a command handler, not from http', () => {
    // Not a detail: P0-T3 instrumented the receiver to log rejections as well as successes and saw
    // zero requests for SessionStart, while a command handler on the same entry fired normally.
    for (const capture of [sessionStartBackground, sessionStartHeadless]) {
      expect(capture.transport).toContain('command hook handler');
      expect(capture.transport).toContain('http handlers are never invoked');
    }
  });

  it('records that Stop arrived over POST /hooks', () => {
    for (const capture of [stopBackground, stopHeadless]) {
      expect(capture.transport).toContain('POST /hooks');
      expect(capture.request_headers['content-type']).toBe('application/json');
      // No Origin at all — the SEC-HTTP-2 carve-out, and why the token is what authenticates here.
      expect('origin' in capture.request_headers).toBe(false);
    }
  });
});
