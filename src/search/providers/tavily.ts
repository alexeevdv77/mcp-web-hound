import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { searchEndpoint } from '../../utils/endpoint-url.js';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
  query: string;
}

/** Stock Tavily origin, used when TAVILY_BASE_URL is empty or unset. */
export const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com';

/**
 * Resolve the search endpoint from TAVILY_BASE_URL.
 *
 * The base is the origin of the API — or of a proxy in front of it. `/search` is
 * appended, so both `https://worker.example.com` and
 * `https://worker.example.com/search` are accepted and resolve to the same call.
 * A trailing slash is ignored, an empty value falls back to the stock origin.
 */
export function tavilySearchUrl(base: string | undefined): string {
  return searchEndpoint(base, TAVILY_DEFAULT_BASE_URL);
}

export class TavilyProvider extends BaseProvider {
  readonly name = 'Tavily';
  readonly tier = 2 as const;

  /** Fully resolved search endpoint, exposed so diagnostics can show where traffic goes. */
  readonly searchUrl: string;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.TAVILY_API_KEY ?? '';
    this.searchUrl = tavilySearchUrl(config.TAVILY_BASE_URL);
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.apiKey) {
      throw new Error('Tavily API key not configured');
    }

    logger.debug({ query, endpoint: this.searchUrl }, 'Tavily request');

    const response = await fetch(this.searchUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        search_depth: 'basic',
        max_results: options.max_results,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Tavily rate limit exceeded');
      }
      throw new Error(`Tavily returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as TavilyResponse;

    if (!data.results) {
      return [];
    }

    return data.results.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
      published_date: r.published_date,
      raw_position: i + 1,
      provider: 'tavily',
    }));
  }
}
