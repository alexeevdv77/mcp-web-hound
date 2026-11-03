/**
 * Query Locale Detection
 *
 * Scraped engines pick the SERP they serve from the request locale, not from
 * the query text. Forcing a single market (`mkt=en-US&setlang=en-US&cc=US`)
 * makes non-English queries degrade into irrelevant junk, so providers send no
 * market params at all and only align `Accept-Language` with the languages
 * actually present in the query.
 *
 * Queries are frequently mixed-language ("последняя версия npm"), so detection
 * returns every language found (primary first) and the header builder keeps a
 * broad fallback chain instead of one hard locale.
 */

const REGION_BY_LANG: Record<string, string> = {
  ru: 'ru-RU',
  uk: 'uk-UA',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-BR',
  nl: 'nl-NL',
  pl: 'pl-PL',
  tr: 'tr-TR',
  ar: 'ar-SA',
  he: 'he-IL',
  hi: 'hi-IN',
  th: 'th-TH',
  el: 'el-GR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
  en: 'en-US',
};

/** Non-Latin scripts are unambiguous — a single codepoint range is enough. */
const SCRIPT_LANGS: Array<{ script: RegExp; lang: string }> = [
  { script: /[\u3040-\u30FF]/u, lang: 'ja' }, // kana wins over kanji
  { script: /[\uAC00-\uD7AF]/u, lang: 'ko' },
  { script: /[\u0400-\u04FF]/u, lang: 'ru' },
  { script: /[\u0600-\u06FF]/u, lang: 'ar' },
  { script: /[\u0590-\u05FF]/u, lang: 'he' },
  { script: /[\u0E00-\u0E7F]/u, lang: 'th' },
  { script: /[\u0900-\u097F]/u, lang: 'hi' },
  { script: /[\u0370-\u03FF]/u, lang: 'el' },
  { script: /[\u4E00-\u9FFF\u3400-\u4DBF]/u, lang: 'zh' },
];

/** Latin script is ambiguous — distinctive stop words only, heuristics. */
const LATIN_LANGS: Array<{ lang: string; stop: RegExp }> = [
  { lang: 'de', stop: /\b(der|die|das|und|für|nicht|mit|wie|auch|neueste|aktuelle)\b/iu },
  { lang: 'fr', stop: /\b(le|les|pour|avec|dans|dernière|derniere|comment|où|est)\b/iu },
  { lang: 'es', stop: /\b(el|los|última|ultima|versión|como|donde|para|con|una)\b/iu },
  { lang: 'it', stop: /\b(il|del|per|come|ultima|versione|dove|questo)\b/iu },
  { lang: 'pt', stop: /\b(como|última|ultima|versão|onde|para|uma|não)\b/iu },
  { lang: 'nl', stop: /\b(het|van|waar|nieuwste|versie)\b/iu },
  { lang: 'pl', stop: /\b(jak|gdzie|najnowsza|wersja|dla)\b/iu },
  { lang: 'tr', stop: /\b(bir|için|son|sürüm|nasıl)\b/iu },
  { lang: 'en', stop: /\b(the|of|for|with|latest|how|where|what|download|version)\b/iu },
];

const LATIN_SCRIPT = /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F]/u;

/**
 * Languages present in the query, most prominent first.
 * Always returns at least one language.
 */
export function detectQueryLanguages(query: string): string[] {
  const q = typeof query === 'string' ? query : '';
  if (!q) {
    return ['en'];
  }

  const found: string[] = [];
  for (const { script, lang } of SCRIPT_LANGS) {
    if (script.test(q) && !found.includes(lang)) {
      found.push(lang);
    }
  }

  if (LATIN_SCRIPT.test(q)) {
    // Cognates ("version"/"versión") make Latin detection noisy — take the most
    // specific match only, never stack several Latin languages.
    const latin = LATIN_LANGS.find(({ stop }) => stop.test(q));
    if (latin && !found.includes(latin.lang)) {
      found.push(latin.lang);
    }
  }

  // Japanese writing uses kanji, so the Han range must not add a phantom zh.
  if (found.includes('ja') && found.includes('zh')) {
    found.splice(found.indexOf('zh'), 1);
  }

  return found.length > 0 ? found.slice(0, 3) : ['en'];
}

/**
 * Accept-Language value matching the query languages, with a broad fallback:
 *   "последняя версия npm" → "ru-RU,ru;q=0.9,en-US,en;q=0.6"
 */
export function buildAcceptLanguage(query: string): string {
  const langs = detectQueryLanguages(query);
  const parts = langs.map((lang, i) => {
    const tag = REGION_BY_LANG[lang] ?? lang;
    return `${tag},${lang};q=${i === 0 ? '0.9' : '0.8'}`;
  });
  if (!langs.includes('en')) {
    parts.push('en-US,en;q=0.6');
  }
  return parts.join(',');
}
