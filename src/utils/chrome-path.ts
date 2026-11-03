import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chrome / Edge discovery.
 *
 * Deliberately dependency-free (no config import): both the first-run config
 * bootstrap (`utils/config.ts`) and the Bing browser fetch mode
 * (`search/providers/bing-browser.ts`) need it, and neither may create an
 * import cycle.
 */

/** Platform Chrome/Edge candidates, most common first. */
export function chromeCandidates(): string[] {
  const list: string[] = [];

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      list.push(join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      list.push(join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    list.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    list.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }

  return list;
}

/** An explicit path is honoured only when it exists; otherwise the first hit. */
export function findChromePath(explicit?: string): string | null {
  const configured = explicit?.trim() || process.env.CHROME_PATH?.trim();
  if (configured) {
    return existsSync(configured) ? configured : null;
  }
  return chromeCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

/** True when some Chrome/Edge is installed on this machine. */
export function hasChrome(): boolean {
  return findChromePath() !== null;
}
