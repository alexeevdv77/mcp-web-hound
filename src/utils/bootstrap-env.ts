import { hasChrome } from './chrome-path.js';

/**
 * First-run `.env` shaping.
 *
 * `default.env` ships Bing on the plain HTTP channel. When a Chrome/Edge is
 * installed on this machine, the browser channel gives noticeably better Bing
 * SERPs (see `search/providers/bing-browser.ts`), so the generated config
 * starts with it instead. Anything the operator wrote by hand is left alone —
 * only the shipped default line is rewritten.
 */
export function applyDetectedBingMode(defaultEnvContent: string, chromeFound: boolean = hasChrome()): string {
  if (!chromeFound) {
    return defaultEnvContent;
  }
  return defaultEnvContent.replace(/^BING_FETCH_MODE[ \t]*=[ \t]*http[ \t]*$/m, 'BING_FETCH_MODE=browser');
}
