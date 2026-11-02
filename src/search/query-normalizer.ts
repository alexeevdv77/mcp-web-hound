import { createHash } from 'node:crypto';

export interface NormalizedQuery {
  normalized: string;
  cacheKey: string;
}

export function normalizeQuery(raw: string): string {
  if (typeof raw !== 'string') {
    return '';
  }

  const normalized = raw
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\p{M}_\s\-./:?=&]/gu, '')
    .trim();

  return normalized;
}

export function generateCacheKey(normalized: string, intent: string): string {
  const hash = createHash('sha256')
    .update(`${normalized}|${intent}`)
    .digest('hex');
  return hash;
}

export function processQuery(raw: string, intent: string): NormalizedQuery {
  const normalized = normalizeQuery(raw);
  const cacheKey = generateCacheKey(normalized, intent);
  return { normalized, cacheKey };
}
