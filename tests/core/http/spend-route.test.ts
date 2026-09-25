// `GET /analytics/spend` — P7-T3.
import { describe, expect, it } from 'vitest';
import type { SpendSummary } from '../../../contracts/spend-summary.ts';
import { SpendRoute } from '../../../core/http/spend-route.ts';

const SUMMARY: SpendSummary = {
  at: 1,
  weeks: [],
  projects: [],
  otherProjects: 0,
  coverage: { transcripts: 0, behind: 0, passes: 0 },
};

describe('SpendRoute', () => {
  it('is a GET on its own path, behind the token and the control budget', () => {
    const route = new SpendRoute({ summary: () => SUMMARY });

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/analytics/spend');
    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  it('answers 200 with the summary, asked afresh each time', () => {
    let asked = 0;
    const route = new SpendRoute({
      summary: () => {
        asked += 1;
        return SUMMARY;
      },
    });

    const first = route.handle();
    route.handle();

    expect(first).toEqual({ status: 200, body: SUMMARY });
    expect(asked).toBe(2);
  });
});
