import { describe, it, expect } from 'vitest';
import { normalizeQuery, generateCacheKey, processQuery } from '../../src/search/query-normalizer.js';

describe('normalizeQuery', () => {
  it('should lowercase and trim', () => {
    expect(normalizeQuery('  React Hooks  ')).toBe('react hooks');
  });

  it('should collapse multiple spaces', () => {
    expect(normalizeQuery('react   hooks   tutorial')).toBe('react hooks tutorial');
  });

  it('should remove non-word special characters', () => {
    expect(normalizeQuery('react + hooks = awesome!')).toBe('react  hooks = awesome');
  });

  it('should keep URL-safe characters', () => {
    expect(normalizeQuery('https://react.dev/docs/getting-started?lang=en')).toBe('https://react.dev/docs/getting-started?lang=en');
  });

  it('should handle empty string', () => {
    expect(normalizeQuery('')).toBe('');
  });

  it('should preserve Cyrillic characters and lowercase them', () => {
    expect(normalizeQuery('Какое сегодня число')).toBe('какое сегодня число');
    expect(normalizeQuery('ПРИВЕТ, МИР!')).toBe('привет мир');
  });

  it('should preserve mixed-script queries', () => {
    expect(normalizeQuery('Java последняя версия')).toBe('java последняя версия');
    expect(normalizeQuery('腾讯 QQ')).toBe('腾讯 qq');
  });

  it('should normalize Unicode to NFC so equivalent strings share a cache key', () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    expect(normalizeQuery(composed)).toBe(normalizeQuery(decomposed));
    expect(generateCacheKey(normalizeQuery(composed), 'web')).toBe(
      generateCacheKey(normalizeQuery(decomposed), 'web'),
    );
  });

  it('should strip symbols that are not letters, numbers or marks', () => {
    expect(normalizeQuery('🔥🔥')).toBe('');
    expect(normalizeQuery('привет 🔥 мир')).toBe('привет  мир');
  });
});

describe('generateCacheKey', () => {
  it('should generate consistent keys for same inputs', () => {
    const a = generateCacheKey('react hooks', 'web');
    const b = generateCacheKey('react hooks', 'web');
    expect(a).toBe(b);
  });

  it('should generate different keys for different intents', () => {
    const a = generateCacheKey('react hooks', 'web');
    const b = generateCacheKey('react hooks', 'docs');
    expect(a).not.toBe(b);
  });
});

describe('processQuery', () => {
  it('should return normalized and cacheKey', () => {
    const result = processQuery('  React Hooks Guide  ', 'web');
    expect(result.normalized).toBe('react hooks guide');
    expect(result.cacheKey).toBeTruthy();
    expect(result.cacheKey.length).toBe(64);
  });

  it('should produce same cacheKey for similar queries', () => {
    const a = processQuery('react hooks', 'web');
    const b = processQuery('  React HOOKS  ', 'web');
    expect(a.cacheKey).toBe(b.cacheKey);
  });
});
