// `GET /search/tools` — the tool filter's list, P7-T2.
import { describe, expect, it } from 'vitest';
import { MAX_TOOL_NAMES } from '../../../contracts/transcript-tools.ts';
import { SearchToolsRoute } from '../../../core/http/search-tools-route.ts';

class StubTools {
  public readonly limits: number[] = [];

  public transcriptTools(limit: number): readonly string[] {
    this.limits.push(limit);
    return ['Bash', 'Read'];
  }
}

describe('SearchToolsRoute', () => {
  it('is a GET beside /search, behind the token and the control budget', () => {
    const route = new SearchToolsRoute(new StubTools());

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/search/tools');
    expect(route.credential).toBe('token');
    expect(route.limit).toBe('control');
  });

  it('answers the index’s tools, asking for no more than the picker draws', async () => {
    const tools = new StubTools();

    const reply = await new SearchToolsRoute(tools).handle();

    expect(reply).toMatchObject({ status: 200, body: { tools: ['Bash', 'Read'] } });
    expect(tools.limits).toEqual([MAX_TOOL_NAMES]);
  });
});
