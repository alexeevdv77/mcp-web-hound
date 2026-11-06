/**
 * Shared endpoint resolution for API providers that can sit behind a proxy.
 *
 * The configured value is the origin of the API — or of a proxy in front of it —
 * and `/search` is appended unless it is already in the path, so both
 * `https://proxy.example.com` and `https://proxy.example.com/api/search` work.
 */
export const SEARCH_PATH = '/search';

/** Origin to fall back on when the configured base is empty or unset. */
export function searchEndpoint(base: string | undefined, defaultOrigin: string): string {
  const trimmed = (base?.trim() || defaultOrigin).replace(/\/+$/, '');
  return trimmed.endsWith(SEARCH_PATH) ? trimmed : `${trimmed}${SEARCH_PATH}`;
}
