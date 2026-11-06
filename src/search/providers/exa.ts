import { BaseProvider } from './base-provider.js';
import { ProviderOptions, ProviderResult } from '../../utils/types.js';
import { config } from '../../utils/config.js';
import { logger } from '../../utils/logger.js';
import { searchEndpoint } from '../../utils/endpoint-url.js';

interface ExaResult {
  title: string;
  url: string;
  text?: string;
  publishedDate?: string;
  published_date?: string;
  score?: number;
}

interface ExaResponse {
  results: ExaResult[];
  autoprompt_string?: string;
}

/** Stock Exa origin, used when EXA_BASE_URL is empty or unset. */
export const EXA_DEFAULT_BASE_URL = 'https://api.exa.ai';

/**
 * Resolve the search endpoint from EXA_BASE_URL.
 *
 * The base is the origin of the API — or of a proxy in front of it. `/search` is
 * appended, so both `https://proxy.example.com/functions/v1/exa-api` and
 * `https://proxy.example.com/functions/v1/exa-api/search` are accepted and resolve
 * to the same call. A trailing slash is ignored, an empty value falls back to the
 * stock origin. The `x-api-key` header is sent exactly as before, so a proxy only
 * has to forward it.
 */
export function exaSearchUrl(base: string | undefined): string {
  return searchEndpoint(base, EXA_DEFAULT_BASE_URL);
}

export class ExaProvider extends BaseProvider {
  readonly name = 'Exa';
  readonly tier = 3 as const;

  /** Fully resolved search endpoint, exposed so diagnostics can show where traffic goes. */
  readonly searchUrl: string;

  private apiKey: string;

  constructor() {
    super();
    this.apiKey = config.EXA_API_KEY ?? '';
    this.searchUrl = exaSearchUrl(config.EXA_BASE_URL);
  }

  async doSearch(query: string, options: ProviderOptions): Promise<ProviderResult[]> {
    if (!this.apiKey) {
      throw new Error('Exa API key not configured');
    }

    logger.debug({ query }, 'Exa request');

    const response = await fetch(this.searchUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        query,
        type: 'keyword',
        num_results: options.max_results,
        include_domains: undefined,
        start_published_date: undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Exa returned ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as ExaResponse;

    if (!data.results) {
      return [];
    }

    return data.results.slice(0, options.max_results).map((r, i) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.text ?? '',
      published_date: r.publishedDate ?? r.published_date,
      raw_position: i + 1,
      provider: 'exa',
    }));
  }
}
