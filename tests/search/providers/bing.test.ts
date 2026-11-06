import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { BingProvider } from '../../../src/search/providers/bing.js';
import { ProviderOptions } from '../../../src/utils/types.js';

beforeAll(() => {
  process.env.TZ = 'UTC';
});

vi.mock('../../../src/utils/config.js', () => ({
  config: {
    LOG_LEVEL: 'silent',
    BING_ENABLED: true,
    DB_FILENAME: 'search.db',
    DDG_ENABLED: false,
    DDG_DELAY_MS: 100,
    DDG_MAX_PER_MINUTE: 10,
    BRAVE_API_KEY: undefined,
    BRAVE_DAILY_LIMIT: 60,
    TAVILY_API_KEY: undefined,
    TAVILY_DAILY_LIMIT: 30,
    EXA_API_KEY: undefined,
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
    BING_FETCH_MODE: 'html',
    BING_RESULTS_PER_PAGE: 10,
    BING_MAX_PAGES: 1,
  },
}));

const dummyOptions: ProviderOptions = { intent: 'web', freshness: 'any', max_results: 10 };

/** Fixture for Cyrillic / Japanese queries about npm */
const npmRuHtml = `<ol id="b_results">
  <li class="b_algo"><h2><a href="https://bing.com/ck/a">npm - npm</a></h2><cite>https://www.npmjs.com</cite><div class="b_caption"><p>Последняя версия 12.2.1, опубликовано 17 дней назад</p></div></li>
  <li class="b_algo"><h2><a href="https://bing.com/ck/a">npm versions</a></h2><cite>https://www.npmjs.com › package › npm</cite><div class="b_caption"><p>Версии npm в реестре</p></div></li>
  <li class="b_algo"><h2><a href="https://bing.com/ck/a">Releases · npm/cli</a></h2><cite>https://github.com › npm › cli › releases</cite><div class="b_caption"><p>Релизы npm CLI, последняя версия</p></div></li>
</ol>`;

/** Fixture for Latin queries about React hooks */
const sampleHtml = `<ol id="b_results">
  <li class="b_algo"><h2><a href="https://bing.com/redir">React Hooks</a></h2><cite>https://react.dev</cite><div class="b_caption"><p>Hooks let you use React features</p></div></li>
  <li class="b_algo"><h2><a href="https://bing.com/redir">GeeksforGeeks</a></h2><cite>https://geeksforgeeks.org</cite><div class="b_caption"><p><span>May 2, 2026</span>&nbsp;&#0183;&#32;Performance Hooks in React</p></div></li>
  <li class="b_algo"><h2><a href="https://bing.com/redir">Old Article</a></h2><cite>https://example.com</cite><div class="b_caption"><p><span>Jan 15, 2024</span>&nbsp;&#0183;&#32;Legacy React patterns</p></div></li>
</ol>`;

/**
 * Well-formed SERP whose content has nothing to do with the query. Kept as a
 * fixture for the "we do not judge relevance" decision: these results are
 * returned as they are, and the other providers in the merge compensate.
 */
const junkRuHtml = `<ol id="b_results">
  <li class="b_algo"><h2><a href="https://bing.com/ck/a">Министерство государственного имущества Республики Марий Эл</a></h2><cite>https://mari-el.gov.ru › ministries › mingosim</cite><div class="b_caption"><p>Интернет-приемная для подачи обращений</p></div></li>
  <li class="b_algo"><h2><a href="https://bing.com/ck/a">Контактные данные и обратная связь</a></h2><cite>https://mari-el.gov.ru › kontaktnye-dannye</cite><div class="b_caption"><p>Адрес министерства государственного имущества</p></div></li>
  <li class="b_algo"><h2><a href="https://bing.com/ck/a">Министерства Республики Марий Эл</a></h2><cite>https://mari-el.gov.ru › ministries</cite><div class="b_caption"><p>Приемная, структура, контакты</p></div></li>
</ol>`;

/** 200 + result container but no organic blocks and no notice — a bot-facing page */
const degradedHtml = '<ol id="b_results"><li class="b_pag"><a href="/search?first=11">Next</a></li></ol>';

/** Bing's own "no results" page (seen with mkt=de-DE in live tests) */
const noResultsHtml = '<ol id="b_results"><li class="b_no">Es gibt keine Ergebnisse für neueste version npm</li></ol>';

const captchaHtml = '<html><body><div class="g-captcha">Please verify that you are not a robot</div></body></html>';

/** Bing's RSS channel: real links, CDATA, entities, an optional pubDate. */
const rssFeed = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing: react hooks</title>
<item><title>React Hooks &amp; Rules</title><link>https://react.dev/reference/react/hooks</link><description>&lt;b&gt;Hooks&lt;/b&gt; let you use state &#39;and&#39; more</description><pubDate>Thu, 05 Nov 2026 16:02:00 GMT</pubDate></item>
<item><title><![CDATA[Hooks at a Glance]]></title><link><![CDATA[https://react.dev/learn]]></link><description><![CDATA[An overview of <i>Hooks</i>]]></description></item>
<item><title>Third result</title><link>https://example.com/third</link><description></description><pubDate>not a date</pubDate></item>
</channel></rss>`;

const emptyRssFeed = '<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>Bing: nothing</title></channel></rss>';

function responseOf(body: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: async () => body,
  } as unknown as Response;
}

describe('BingProvider', () => {
  let provider: BingProvider;

  beforeEach(() => {
    provider = new BingProvider();
  });

  it('should start healthy', async () => {
    expect(await provider.healthCheck()).toBe(true);
  });

  it('should return correct initial stats', () => {
    const stats = provider.getStats();
    expect(stats.healthy).toBe(true);
    expect(stats.requests_today).toBe(0);
  });

  describe('parseResults (private, tested via HTML fixture)', () => {
    it('should extract published_date from date spans', () => {
      const results = (provider as any).parseResults(sampleHtml, 10);
      expect(results).toHaveLength(3);

      // No date → undefined
      expect(results[0].published_date).toBeUndefined();

      // Has date → ISO string
      expect(results[1].published_date).toBe('2026-05-02T00:00:00.000Z');
      expect(results[2].published_date).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should strip date prefix from snippet', () => {
      const results = (provider as any).parseResults(sampleHtml, 10);
      // Date should be removed from snippet
      expect(results[1].snippet).not.toContain('May 2, 2026');
      expect(results[1].snippet).toBe('Performance Hooks in React');
    });

    it('should keep snippet intact when no date present', () => {
      const results = (provider as any).parseResults(sampleHtml, 10);
      expect(results[0].snippet).toBe('Hooks let you use React features');
    });

    it('should return empty array (not throw) when Bing reports no results', () => {
      expect((provider as any).parseResults(noResultsHtml, 10)).toEqual([]);
    });

    it('should throw when Bing serves a captcha/blocking page', () => {
      expect(() => (provider as any).parseResults(captchaHtml, 10)).toThrow('captcha');
    });
  });
});

describe('BingProvider fetch channels (mocked fetch)', () => {
  let provider: any;
  let configMock: any;
  let configSnapshot: Record<string, unknown>;
  let calls: Array<{ url: string; headers: Record<string, string> }>;

  async function setup(searchResponder: (url: string, index: number) => Response, tuneConfig?: (c: any) => void) {
    vi.resetModules();
    calls = [];
    let searchIndex = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return searchResponder(url, searchIndex++);
    }));

    ({ config: configMock } = await import('../../../src/utils/config.js'));
    configSnapshot = { ...configMock };
    tuneConfig?.(configMock);

    const mod = await import('../../../src/search/providers/bing.js');
    provider = new mod.BingProvider();
    return configMock;
  }

  function searchCalls() {
    return calls.filter((c) => c.url.includes('/search'));
  }

  function searchCall() {
    return searchCalls()[0];
  }

  afterEach(() => {
    if (configMock) {
      for (const [key, value] of Object.entries(configSnapshot)) {
        configMock[key] = value;
      }
    }
    vi.unstubAllGlobals();
  });

  it('makes a single HTTP search request per page — no cookie warm-up, no retries', async () => {
    await setup(() => responseOf(npmRuHtml));

    await provider.doSearch('последняя версия npm', dummyOptions);
    expect(calls).toHaveLength(1);
    expect(searchCalls()).toHaveLength(1);
    expect(provider.attempts[0]).toMatchObject({ mode: 'http', page: 1, verdict: 'usable' });
  });

  it('sends the query verbatim with no forced market params', async () => {
    await setup(() => responseOf(npmRuHtml));
    await provider.doSearch('последняя версия npm', dummyOptions);

    const params = new URL(searchCall().url).searchParams;
    expect(params.get('q')).toBe('последняя версия npm');
    expect(params.get('count')).toBe('10');
    expect(params.has('mkt')).toBe(false);
    expect(params.has('setlang')).toBe(false);
    expect(params.has('cc')).toBe(false);
    expect(params.has('hl')).toBe(false);
    expect(params.has('format')).toBe(false);
  });

  it('sends the same browser-like headers for any query language', async () => {
    await setup(() => responseOf(npmRuHtml));
    await provider.doSearch('последняя версия npm', dummyOptions);
    await provider.doSearch('npm 最新バージョン', dummyOptions);

    for (const call of searchCalls()) {
      expect(call.headers['Accept-Language']).toBe('en-US,en;q=0.9');
      expect(call.headers.Cookie).toBeUndefined();
      expect(call.headers['User-Agent']).toContain('Chrome/131');
    }
  });

  it('makes exactly one request per page — no retries, no reformulations', async () => {
    await setup(() => responseOf(noResultsHtml));
    const results = await provider.doSearch('neueste version npm', dummyOptions);

    expect(results).toEqual([]);
    expect(searchCalls()).toHaveLength(1);
    expect(provider.attempts).toHaveLength(1);
    expect(provider.attempts[0]).toMatchObject({ mode: 'http', page: 1, verdict: 'empty' });
    expect(provider.attempts[0].reason).toContain('no results reported by Bing');
  });

  it('reports a degraded (contentless) SERP as empty', async () => {
    await setup(() => responseOf(degradedHtml));
    const results = await provider.doSearch('react hooks version', dummyOptions);

    expect(results).toEqual([]);
    expect(searchCalls()).toHaveLength(1);
    expect(provider.attempts[0].reason).toContain('degraded SERP');
  });

  it('returns whatever the SERP contains — relevance is not judged here', async () => {
    await setup(() => responseOf(junkRuHtml));
    const results = await provider.doSearch('Сколько стоит солярка', dummyOptions);

    expect(results).toHaveLength(3);
    expect(results[0].url).toContain('mari-el.gov.ru');
  });

  it('walks pagination while pages still carry results', async () => {
    await setup(() => responseOf(sampleHtml), (c) => {
      c.BING_RESULTS_PER_PAGE = 2;
      c.BING_MAX_PAGES = 3;
    });

    const results = await provider.doSearch('react hooks version', dummyOptions);

    expect(searchCalls()).toHaveLength(3);
    const pages = searchCalls().map((c) => new URL(c.url).searchParams.get('first'));
    expect(pages).toEqual([null, '3', '5']);
    expect(results).toHaveLength(9);
  });

  it('stops pagination at the first contentless page and keeps earlier results', async () => {
    await setup((_url, index) => responseOf(index === 0 ? sampleHtml : degradedHtml), (c) => {
      c.BING_RESULTS_PER_PAGE = 2;
      c.BING_MAX_PAGES = 3;
    });

    const results = await provider.doSearch('react hooks version', dummyOptions);

    expect(searchCalls()).toHaveLength(2);
    expect(results).toHaveLength(3);
    expect(provider.attempts.map((a: { verdict: string }) => a.verdict)).toEqual(['usable', 'empty']);
  });

  it('surfaces captcha pages as provider errors so the router can fall back', async () => {
    await setup(() => responseOf(captchaHtml));
    await expect(provider.doSearch('последняя версия npm', dummyOptions)).rejects.toThrow('captcha');
  });

  it('surfaces HTTP failures as provider errors', async () => {
    vi.resetModules();
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, statusText: 'Too Many Requests' }) as unknown as Response));
    const mod = await import('../../../src/search/providers/bing.js');
    await expect(new mod.BingProvider().doSearch('anything', dummyOptions)).rejects.toThrow('Bing returned 429');
  });

  it('uses the RSS channel when BING_FETCH_MODE=rss — one request, q + format only', async () => {
    await setup(() => responseOf(rssFeed), (c) => {
      c.BING_FETCH_MODE = 'rss';
    });

    const results = await provider.doSearch('react hooks', dummyOptions);

    expect(calls).toHaveLength(1);
    const params = new URL(searchCall().url).searchParams;
    expect(params.get('q')).toBe('react hooks');
    expect(params.get('format')).toBe('rss');
    // Bing ignores count/first on format=rss — they are not sent at all.
    expect(params.has('count')).toBe(false);
    expect(params.has('first')).toBe(false);

    expect(results).toHaveLength(3);
    expect(provider.attempts[0]).toMatchObject({ mode: 'rss', page: 1, verdict: 'usable', results: 3 });
  });

  it('parses RSS items: CDATA, entities, destination links and pubDate', async () => {
    await setup(() => responseOf(rssFeed), (c) => {
      c.BING_FETCH_MODE = 'rss';
    });

    const results = await provider.doSearch('react hooks', dummyOptions);

    expect(results[0]).toMatchObject({
      title: 'React Hooks & Rules',
      url: 'https://react.dev/reference/react/hooks',
      snippet: "Hooks let you use state 'and' more",
      published_date: '2026-11-05T16:02:00.000Z',
      raw_position: 1,
      provider: 'bing',
    });

    // CDATA wrapper is unwrapped, HTML in the description is stripped.
    expect(results[1].title).toBe('Hooks at a Glance');
    expect(results[1].url).toBe('https://react.dev/learn');
    expect(results[1].snippet).toBe('An overview of Hooks');
    expect(results[1].published_date).toBeUndefined();

    // Unparseable pubDate is dropped, not fatal.
    expect(results[2].published_date).toBeUndefined();
  });

  it('keeps the real destination URL instead of a bing.com tracking link', async () => {
    await setup(() => responseOf(rssFeed), (c) => {
      c.BING_FETCH_MODE = 'rss';
    });

    const results = await provider.doSearch('react hooks', dummyOptions);
    for (const r of results) {
      expect(r.url).not.toContain('bing.com/ck');
      expect(r.url).toMatch(/^https:\/\//);
    }
  });

  it('slices RSS results to max_results', async () => {
    await setup(() => responseOf(rssFeed), (c) => {
      c.BING_FETCH_MODE = 'rss';
    });

    const results = await provider.doSearch('react hooks', { ...dummyOptions, max_results: 2 });
    expect(results).toHaveLength(2);
    expect(results.map((r: { raw_position: number }) => r.raw_position)).toEqual([1, 2]);
  });

  it('reports an empty RSS feed as empty, not as an error', async () => {
    await setup(() => responseOf(emptyRssFeed), (c) => {
      c.BING_FETCH_MODE = 'rss';
    });

    const results = await provider.doSearch('zzzqqqxxy', dummyOptions);

    expect(results).toEqual([]);
    expect(provider.attempts[0]).toMatchObject({ mode: 'rss', verdict: 'empty' });
    expect(provider.attempts[0].reason).toContain('no items');
  });

  it('surfaces a non-XML (block/captcha) RSS response as a provider error', async () => {
    await setup(() => responseOf(captchaHtml), (c) => {
      c.BING_FETCH_MODE = 'rss';
    });

    await expect(provider.doSearch('react hooks', dummyOptions)).rejects.toThrow('no XML');
  });
});
