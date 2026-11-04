import { describe, it, expect, vi } from 'vitest';
import { config } from '../../src/utils/config.js';
import { DuckDuckGoProvider } from '../../src/search/providers/duckduckgo.js';
import { BingProvider } from '../../src/search/providers/bing.js';
import { BraveProvider } from '../../src/search/providers/brave.js';
import { BraveWebProvider } from '../../src/search/providers/brave-web.js';
import { TavilyProvider } from '../../src/search/providers/tavily.js';
import { ExaProvider } from '../../src/search/providers/exa.js';
import { FirecrawlProvider } from '../../src/search/providers/firecrawl.js';
import { StartpageProvider } from '../../src/search/providers/startpage.js';
import type { ProviderResult } from '../../src/utils/types.js';

const integration = process.env.RUN_INTEGRATION_TESTS ? describe : describe.skip;
const DATE_QUERY = '2026 web development trends';
const OPTIONS = { intent: 'web' as const, freshness: 'any' as const, max_results: 10 };
const TIMEOUT = 30000;

function validateResultShape(r: ProviderResult): void {
  expect(typeof r.title).toBe('string');
  expect(typeof r.url).toBe('string');
  expect(typeof r.snippet).toBe('string');
  expect(typeof r.raw_position).toBe('number');
  expect(typeof r.provider).toBe('string');
  expect(r.raw_position).toBeGreaterThanOrEqual(1);
}

function validateDateIfPresent(r: ProviderResult): boolean {
  if (!r.published_date) return false;
  const d = r.published_date;
  if (typeof d !== 'string') return false;
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return false;
  if (parsed.getFullYear() < 2020) return false;
  return true;
}

function testProvider(name: string, factory: () => DuckDuckGoProvider | BingProvider | BraveProvider | BraveWebProvider | StartpageProvider | TavilyProvider | ExaProvider | FirecrawlProvider): void {
  describe(name, () => {
    it('should return results with valid shape and log dates', { timeout: TIMEOUT }, async () => {
      const p = factory();
      const healthy = await p.healthCheck();
      expect(healthy).toBe(true);

      let results: ProviderResult[];
      try {
        results = await p.search(DATE_QUERY, OPTIONS);
      } catch (err) {
        throw new Error(`${p.name} threw during search: ${err instanceof Error ? err.message : String(err)}`);
      }

      expect(results.length).toBeGreaterThan(0);
      const datedCount = results.filter((r) => r.published_date).length;
      console.log(`  ${p.name}: ${datedCount}/${results.length} results with dates`);
      for (const r of results) {
        validateResultShape(r);
        validateDateIfPresent(r);
      }
    });
  });
}

describe.concurrent('Provider Integration Tests', () => {
  integration('DuckDuckGo (live)', () => {
    (config.DDG_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new DuckDuckGoProvider());
    });
  });
  integration('Bing (live)', () => {
    (config.BING_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new BingProvider());
    });
  });
  integration('Bing (live, multilingual)', () => {
    // These queries used to come back as junk because the provider forced
    // mkt=en-US&setlang=en-US&cc=US. What is asserted here is the request
    // contract, not the quality of the answer: the query leaves verbatim, the
    // locale travels only in Accept-Language, and Bing either answers or steps
    // aside with an empty page. Whether the SERP is actually about the queried
    // subject is deliberately not judged — Startpage/DDG/Brave compensate in the
    // same merge.
    describe('request shape', () => {
      const localeCases = [
        { label: 'russian', query: 'последняя версия npm', accept: /^ru/ },
        { label: 'russian commercial', query: 'Сколько стоит солярка', accept: /^ru/ },
        { label: 'japanese', query: 'npm 最新バージョン', accept: /^ja/ },
      ];
      for (const localeCase of localeCases) {
        it(`sends a ${localeCase.label} query verbatim with a matching Accept-Language`, { timeout: TIMEOUT }, async () => {
          const requests: Array<{ url: string; headers: Record<string, string> }> = [];
          const realFetch = globalThis.fetch;
          vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
            return realFetch(input as RequestInfo, init);
          });

          try {
            const p = new BingProvider();
            const results = await p.search(localeCase.query, OPTIONS);

            const search = requests.find((r) => r.url.includes('/search'));
            expect(search).toBeDefined();
            expect(new URL(search!.url).searchParams.get('q')).toBe(localeCase.query);
            expect(search!.headers['Accept-Language']).toMatch(localeCase.accept);
            console.log(`  Bing ${localeCase.label}: ${results.length} results`);
          } finally {
            vi.unstubAllGlobals();
          }
        });
      }
    });
  });
  integration('Brave Web (live)', () => {
    (config.BRAVE_WEB_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new BraveWebProvider());
    });
  });
  integration('Brave API (live)', () => {
    (config.BRAVE_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new BraveProvider());
    });
  });
  integration('Tavily (live)', () => {
    (config.TAVILY_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new TavilyProvider());
    });
  });
  integration('Exa (live)', () => {
    (config.EXA_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new ExaProvider());
    });
  });
  integration('Firecrawl (live)', () => {
    (config.FIRECRAWL_API_KEY ? describe : describe.skip)('results', () => {
      testProvider('results', () => new FirecrawlProvider());
    });
  });
  integration('Startpage (live)', () => {
    (config.STARTPAGE_ENABLED ? describe : describe.skip)('results', () => {
      testProvider('results', () => new StartpageProvider());
    });
  });
});
