import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExaProvider, exaSearchUrl, EXA_DEFAULT_BASE_URL } from '../../../src/search/providers/exa.js';
import { config } from '../../../src/utils/config.js';
import { ProviderOptions } from '../../../src/utils/types.js';

vi.mock('../../../src/utils/config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    EXA_API_KEY: 'test-key',
    EXA_BASE_URL: 'https://api.exa.ai',
    DB_FILENAME: 'search.db',
    DDG_ENABLED: false,
    DDG_DELAY_MS: 100,
    DDG_MAX_PER_MINUTE: 10,
    BRAVE_API_KEY: undefined,
    BRAVE_DAILY_LIMIT: 60,
    TAVILY_API_KEY: undefined,
    TAVILY_DAILY_LIMIT: 30,
    FIRECRAWL_API_KEY: undefined,
    BUDGET_MAX_SEARCHES: 15,
    BUDGET_MAX_FETCHES: 30,
    BUDGET_WINDOW_MINUTES: 30,
    CACHE_MAX_SIZE_MB: 500,
    CACHE_EVICTION_INTERVAL_MIN: 30,
    SEMANTIC_ENABLED: false,
    EMBEDDING_MODEL: 'multilingual-e5-small',
    EMBEDDING_DIMENSION: 384,
    SEMANTIC_THRESHOLD: 0.92,
    FETCH_TIMEOUT_MS: 10000,
    FETCH_MAX_RETRIES: 2,
    FETCH_MAX_BODY_SIZE: 5242880,
    FETCH_CONCURRENT_LIMIT: 3,
    FETCH_USER_AGENT: 'SearchMCP/1.0',
    CONTENT_MAX_LENGTH: 8000,
    RERANK_ENABLED: true,
    RERANK_WEIGHT_SEMANTIC: 0.35,
    RERANK_WEIGHT_DOMAIN: 0.30,
    RERANK_WEIGHT_FRESHNESS: 0.15,
    RERANK_WEIGHT_POSITION: 0.20,
  },
}));

describe('ExaProvider', () => {
  let provider: ExaProvider;
  const dummyOptions: ProviderOptions = { intent: 'web', freshness: 'any', max_results: 10 };

  beforeEach(() => {
    provider = new ExaProvider();
  });

  it('should start healthy', async () => {
    expect(await provider.healthCheck()).toBe(true);
  });

  it('should throw if no API key', async () => {
    vi.mocked(await import('../../../src/utils/config.js')).config.EXA_API_KEY = '';
    const p = new ExaProvider();
    await expect(p.search('test', dummyOptions)).rejects.toThrow('Exa API key not configured');
  });

  it('should return correct stats', () => {
    const stats = provider.getStats();
    expect(stats.healthy).toBe(true);
    expect(stats.requests_today).toBe(0);
  });
});

describe('Exa endpoint override (EXA_BASE_URL)', () => {
  const okResponse = {
    ok: true,
    json: () => Promise.resolve({ results: [{ title: 'E', url: 'https://example.com/', text: 'c' }] }),
  } as Response;

  const requestedUrl = async (baseUrl: string | undefined) => {
    (config as { EXA_BASE_URL?: string }).EXA_BASE_URL = baseUrl;
    try {
      const provider = new ExaProvider();
      global.fetch = vi.fn().mockResolvedValueOnce(okResponse);
      await provider.doSearch('sqlite vacuum', { intent: 'web', freshness: 'any', max_results: 5 });
      return { url: String(vi.mocked(fetch).mock.calls[0][0]), searchUrl: provider.searchUrl };
    } finally {
      (config as { EXA_BASE_URL?: string }).EXA_BASE_URL = EXA_DEFAULT_BASE_URL;
    }
  };

  it('throws on a missing API key before any request is made', async () => {
    (config as { EXA_API_KEY?: string }).EXA_API_KEY = undefined;
    global.fetch = vi.fn();
    const keyless = new ExaProvider();
    await expect(keyless.doSearch('test', { intent: 'web', freshness: 'any', max_results: 5 })).rejects.toThrow(
      /API key not configured/i,
    );
    expect(fetch).not.toHaveBeenCalled();
    (config as { EXA_API_KEY?: string }).EXA_API_KEY = 'test-key';
  });

  it('resolves the helper against the stock origin when unset or empty', () => {
    expect(exaSearchUrl(undefined)).toBe('https://api.exa.ai/search');
    expect(exaSearchUrl('   ')).toBe(`${EXA_DEFAULT_BASE_URL}/search`);
  });

  it('appends /search to a proxy origin that carries a path', async () => {
    const { url, searchUrl } = await requestedUrl('https://proxy.example.com/functions/v1/exa-api');
    expect(url).toBe('https://proxy.example.com/functions/v1/exa-api/search');
    expect(searchUrl).toBe('https://proxy.example.com/functions/v1/exa-api/search');
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
    expect(await requestedUrl('https://api.exa.ai')).toEqual({
      url: 'https://api.exa.ai/search',
      searchUrl: 'https://api.exa.ai/search',
    });
  });

  it('returns no results when a proxy answers 200 without a results array', async () => {
    (config as { EXA_BASE_URL?: string }).EXA_BASE_URL = 'https://proxy.example.com';
    try {
      const provider = new ExaProvider();
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ error: { status_code: 401 } }) } as Response);
      const results = await provider.doSearch('test', { intent: 'web', freshness: 'any', max_results: 5 });
      expect(results).toEqual([]);
      expect(provider.searchUrl).toBe('https://proxy.example.com/search');
    } finally {
      (config as { EXA_BASE_URL?: string }).EXA_BASE_URL = EXA_DEFAULT_BASE_URL;
    }
  });

  it('sends the API key in the x-api-key header, which a pass-through proxy forwards', async () => {
    (config as { EXA_BASE_URL?: string }).EXA_BASE_URL = 'https://proxy.example.com';
    try {
      const provider = new ExaProvider();
      global.fetch = vi.fn().mockResolvedValueOnce(okResponse);
      await provider.doSearch('sqlite vacuum', { intent: 'web', freshness: 'any', max_results: 5 });
      const init = vi.mocked(fetch).mock.calls[0][1];
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('test-key');
      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe('sqlite vacuum');
    } finally {
      (config as { EXA_BASE_URL?: string }).EXA_BASE_URL = EXA_DEFAULT_BASE_URL;
    }
  });
});
