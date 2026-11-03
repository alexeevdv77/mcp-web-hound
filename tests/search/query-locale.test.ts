import { describe, it, expect } from 'vitest';
import { detectQueryLanguages, buildAcceptLanguage } from '../../src/search/query-locale.js';

describe('detectQueryLanguages', () => {
  it('detects Cyrillic as Russian', () => {
    expect(detectQueryLanguages('последняя версия')).toEqual(['ru']);
  });

  it('detects mixed Cyrillic + Latin brand token without inventing a second language', () => {
    expect(detectQueryLanguages('последняя версия npm')).toEqual(['ru']);
  });

  it('detects multiple scripts in a mixed query', () => {
    const langs = detectQueryLanguages('последняя версия die besteversion');
    expect(langs).toContain('ru');
    expect(langs).toContain('de');
  });

  it('detects Japanese before Chinese when kana is present', () => {
    expect(detectQueryLanguages('npm 最新バージョン')).toEqual(['ja']);
  });

  it('detects Chinese from kanji only', () => {
    expect(detectQueryLanguages('npm 最新版本')).toEqual(['zh']);
  });

  it('detects Arabic', () => {
    expect(detectQueryLanguages('آخر إصدار npm')).toEqual(['ar']);
  });

  it('detects Latin languages by stop words', () => {
    expect(detectQueryLanguages('neueste version npm')).toEqual(['de']);
    expect(detectQueryLanguages('dernière version npm')).toEqual(['fr']);
    expect(detectQueryLanguages('última versión npm')).toEqual(['es']);
    expect(detectQueryLanguages('latest version npm')).toEqual(['en']);
  });

  it('falls back to English for an empty query', () => {
    expect(detectQueryLanguages('')).toEqual(['en']);
    expect(detectQueryLanguages('npm 12.2.1')).toEqual(['en']);
  });
});

describe('buildAcceptLanguage', () => {
  it('keeps a broad fallback chain for a Russian query', () => {
    const header = buildAcceptLanguage('последняя версия npm');
    expect(header).toBe('ru-RU,ru;q=0.9,en-US,en;q=0.6');
  });

  it('weights the primary language first for mixed queries', () => {
    const header = buildAcceptLanguage('последняя версия die besteversion');
    expect(header.startsWith('ru-RU,ru;q=0.9')).toBe(true);
    expect(header).toContain('de-DE,de;q=0.8');
  });

  it('does not duplicate English when the query is English', () => {
    const header = buildAcceptLanguage('latest version npm');
    expect(header).toBe('en-US,en;q=0.9');
  });

  it('matches non-Latin queries with their own region plus English fallback', () => {
    expect(buildAcceptLanguage('npm 最新バージョン')).toBe('ja-JP,ja;q=0.9,en-US,en;q=0.6');
    expect(buildAcceptLanguage('npm 最新版本')).toBe('zh-CN,zh;q=0.9,en-US,en;q=0.6');
    expect(buildAcceptLanguage('آخر إصدار npm')).toBe('ar-SA,ar;q=0.9,en-US,en;q=0.6');
  });
});
