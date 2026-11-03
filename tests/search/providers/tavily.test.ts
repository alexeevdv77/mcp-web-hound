import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TavilyProvider, tavilySearchUrl, TAVILY_DEFAULT_BASE_URL } from '../../../src/search/providers/tavily.js';
import { config } from '../../../src/utils/config.js';

vi.mock('../../../src/utils/config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    TAVILY_API_KEY: 'tvly-test-key',
    TAVILY_DAILY_LIMIT: 30,
    TAVILY_BASE_URL: 'https://api.tavily.com',
    DB_FILENAME: 'search.db',
    DDG_ENABLED: false,
    DDG_DELAY_MS: 100,
    DDG_MAX_PER_MINUTE: 10,
    BING_ENABLED: false,
    BRAVE_API_KEY: undefined,
    BRAVE_DAILY_LIMIT: 60,
    EXA_API_KEY: undefined,
    FIRECRAWL_API_KEY: undefined,
    BUDGET_MAX_SEARCHES: 15,
    BUDGET_MAX_FETCHES: 30,
    BUDGET_WINDOW_MINUTES: 30,
    CACHE_MAX_SIZE_MB: 500,
    CACHE_EVICTION_INTERVAL_MIN: 30,
    FETCH_USER_AGENT: 'test',
    FETCH_TIMEOUT_MS: 5000,
    FETCH_MAX_RETRIES: 1,
    FETCH_MAX_BODY_SIZE: 1000,
    FETCH_CONCURRENT_LIMIT: 3,
    CONTENT_MAX_LENGTH: 8000,
    RERANK_ENABLED: false,
    RERANK_WEIGHT_SEMANTIC: 0.35,
    RERANK_WEIGHT_DOMAIN: 0.25,
    RERANK_WEIGHT_FRESHNESS: 0.15,
    RERANK_WEIGHT_POSITION: 0.25,
    SEMANTIC_ENABLED: false,
    EMBEDDING_MODEL: 'test',
    EMBEDDING_DIMENSION: 384,
    SEMANTIC_THRESHOLD: 0.92,
    GITHUB_TOKEN: undefined,
    GITLAB_TOKEN: undefined,
  },
}));

// Two tests below change the mocked config, so every test starts from the values above.
afterEach(() => {
  const mutable = config as { TAVILY_API_KEY?: string; TAVILY_BASE_URL?: string };
  mutable.TAVILY_API_KEY = 'tvly-test-key';
  mutable.TAVILY_BASE_URL = 'https://api.tavily.com';
});

describe('TavilyProvider', () => {
  let provider: TavilyProvider;
  const sampleResponse = {
    results: [
      {
        title: 'Rust Programming Language',
        url: 'https://www.rust-lang.org/',
        content: 'Learn Rust programming language.',
      },
      {
        title: 'Rust by Example',
        url: 'https://doc.rust-lang.org/stable/rust-by-example/',
        content: 'Collection of runnable examples.',
      },
    ],
  };

  beforeEach(() => {
    provider = new TavilyProvider();
    global.fetch = vi.fn();
  });

  it('should return results on successful API call', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(sampleResponse),
    } as Response);

    const results = await provider.search('rust programming', {
      intent: 'web',
      freshness: 'any',
      max_results: 5,
    });

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Rust Programming Language');
    expect(results[0].url).toBe('https://www.rust-lang.org/');
    expect(results[0].provider).toBe('tavily');
  });

  it('should throw on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    await expect(
      provider.search('test', { intent: 'web', freshness: 'any', max_results: 5 }),
    ).rejects.toThrow(/Tavily.*401/i);
  });

  it('should return empty when no results', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    } as Response);

    const results = await provider.search('test', {
      intent: 'web',
      freshness: 'any',
      max_results: 5,
    });

    expect(results).toEqual([]);
  });

  it('should enforce max_results limit', async () => {
    const manyResults = {
      results: Array.from({ length: 10 }, (_, i) => ({
        title: `Result ${i + 1}`,
        url: `https://example.com/${i}`,
        content: `Content ${i + 1}`,
      })),
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(manyResults),
    } as Response);

    const results = await provider.search('test', {
      intent: 'web',
      freshness: 'any',
      max_results: 3,
    });

    expect(results).toHaveLength(3);
  });

  it('should handle rate limit error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    } as Response);

    await expect(
      provider.search('test', { intent: 'web', freshness: 'any', max_results: 5 }),
    ).rejects.toThrow(/Tavily/i);
  });

  it('should track provider stats', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(sampleResponse),
    } as Response);

    await provider.search('test', { intent: 'web', freshness: 'any', max_results: 5 });

    const stats = provider.getStats();
    expect(stats.requests_today).toBe(1);
    expect(stats.healthy).toBe(true);
    expect(stats.avg_latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('Tavily endpoint override (TAVILY_BASE_URL)', () => {
  const okResponse = {
    ok: true,
    json: () => Promise.resolve({ results: [{ title: 'T', url: 'https://example.com/', content: 'c' }] }),
  } as Response;

  const requestedUrl = async (baseUrl: string | undefined) => {
    (config as { TAVILY_BASE_URL?: string }).TAVILY_BASE_URL = baseUrl;
    try {
      const provider = new TavilyProvider();
      global.fetch = vi.fn().mockResolvedValueOnce(okResponse);
      await provider.doSearch('sqlite vacuum', { intent: 'web', freshness: 'any', max_results: 5 });
      return { url: String(vi.mocked(fetch).mock.calls[0][0]), searchUrl: provider.searchUrl };
    } finally {
      (config as { TAVILY_BASE_URL?: string }).TAVILY_BASE_URL = 'https://api.tavily.com';
    }
  };

  it('throws on a missing API key before any request is made', async () => {
    (config as { TAVILY_API_KEY?: string }).TAVILY_API_KEY = undefined;
    global.fetch = vi.fn();
    const keyless = new TavilyProvider();
    await expect(keyless.doSearch('test', { intent: 'web', freshness: 'any', max_results: 5 })).rejects.toThrow(
      /API key not configured/i,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves the helper against the stock origin when unset or empty', () => {
    expect(tavilySearchUrl(undefined)).toBe('https://api.tavily.com/search');
    expect(tavilySearchUrl('   ')).toBe(`${TAVILY_DEFAULT_BASE_URL}/search`);
  });

  it('appends /search to a proxy origin', async () => {
    const { url, searchUrl } = await requestedUrl('https://proxy.example.com');
    expect(url).toBe('https://proxy.example.com/search');
    expect(searchUrl).toBe('https://proxy.example.com/search');
  });

  it('accepts an endpoint that already ends with /search', async () => {
    expect(await requestedUrl('https://proxy.example.com/search')).toEqual({
      url: 'https://proxy.example.com/search',
      searchUrl: 'https://proxy.example.com/search',
    });
  });

  it('ignores a trailing slash in the configured base', async () => {
    expect(await requestedUrl('https://proxy.example.com/')).toEqual({
      url: 'https://proxy.example.com/search',
      searchUrl: 'https://proxy.example.com/search',
    });
  });

  it('keeps the stock endpoint when the default value is configured', async () => {
    expect(await requestedUrl('https://api.tavily.com')).toEqual({
      url: 'https://api.tavily.com/search',
      searchUrl: 'https://api.tavily.com/search',
    });
  });

  it('returns no results when a proxy answers 200 without a results array', async () => {
    (config as { TAVILY_BASE_URL?: string }).TAVILY_BASE_URL = 'https://proxy.example.com';
    const provider = new TavilyProvider();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ detail: 'proxy answered, no search here' }) } as Response);
    const results = await provider.doSearch('test', { intent: 'web', freshness: 'any', max_results: 5 });
    expect(results).toEqual([]);
    expect(provider.searchUrl).toBe('https://proxy.example.com/search');
  });

  it('sends the API key in the JSON body, which a pass-through proxy forwards', async () => {
    (config as { TAVILY_BASE_URL?: string }).TAVILY_BASE_URL = 'https://proxy.example.com';
    try {
      const provider = new TavilyProvider();
      global.fetch = vi.fn().mockResolvedValueOnce(okResponse);
      await provider.doSearch('sqlite vacuum', { intent: 'web', freshness: 'any', max_results: 5 });
      const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
      expect(body.api_key).toBe('tvly-test-key');
      expect(body.query).toBe('sqlite vacuum');
    } finally {
      (config as { TAVILY_BASE_URL?: string }).TAVILY_BASE_URL = 'https://api.tavily.com';
    }
  });
});
