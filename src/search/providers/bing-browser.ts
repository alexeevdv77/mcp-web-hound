/**
 * Bing browser channel (Chrome DevTools Protocol)
 *
 * The alternative to HTTP scraping, selected with `BING_FETCH_MODE=browser`.
 * Live experiments (2026-11) showed what makes Bing answer a cold query string
 * with real organic results instead of its "fallback" page: a Chrome instance
 * whose user-agent does NOT carry the `HeadlessChrome` token, and the query
 * typed into Bing's search box (a real form submit). Navigating straight to
 * `/search?q=` keeps returning the fallback page even in a visible window, so
 * the input flow below cannot be replaced with a plain URL.
 *
 * Chrome runs headless and is fully detached from the user's profile: it gets
 * its own profile directory (cookies for Bing only), is reused across searches,
 * serialised through a one-element queue, and killed after an idle period.
 *
 * The module is dependency-light on purpose: no Puppeteer, just `ws` speaking
 * CDP to a local Chrome process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { config } from '../../utils/config.js';
import { findChromePath } from '../../utils/chrome-path.js';
import { CONFIG_DIR } from '../../utils/env-path.js';
import { logger } from '../../utils/logger.js';
import { buildAcceptLanguage } from '../query-locale.js';

/** Profile directory used when BING_BROWSER_PROFILE_DIR is not set. */
export const DEFAULT_PROFILE_DIR = resolve(CONFIG_DIR, 'bing-chrome-profile');

const HOME_URL = 'https://www.bing.com/';
const LAUNCH_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 150;

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserUnavailableError';
  }
}

/** Configured Chrome/Edge binary, or the first one found on this machine. */
export function resolveChromePath(explicit?: string): string | null {
  return findChromePath(explicit?.trim() || config.BING_BROWSER_PATH?.trim());
}

/** `HeadlessChrome/131` in the UA is what Bing keys the fallback page on. */
export function normalizeUserAgent(userAgent: string): string {
  return userAgent.replace(/HeadlessChrome/gi, 'Chrome');
}

/** Chrome flags for an isolated, quiet, headless automation profile. */
export function buildChromeArgs(profileDir: string): string[] {
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-sync',
    '--mute-audio',
    '--window-size=1280,900',
    '--lang=ru-RU',
    `--user-data-dir=${profileDir}`,
    '--profile-directory=Default',
    '--remote-debugging-port=0',
  ];

  if (config.BING_BROWSER_HEADLESS !== false) {
    args.unshift('--headless=new');
  }

  if (process.platform !== 'win32') {
    // Containers/CI commonly run as root without a usable /dev/shm or sandbox.
    args.push('--no-sandbox', '--disable-dev-shm-usage');
  }

  args.push('about:blank');
  return args;
}

// --- Minimal CDP client -----------------------------------------------------

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

class CdpConnection {
  private readonly ws: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, PendingCall>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;

    ws.on('message', (raw) => {
      let message: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(raw.toString()) as typeof message;
      } catch {
        return;
      }
      if (typeof message.id !== 'number') return;
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) {
        call.reject(new Error(message.error.message || 'CDP call failed'));
      } else {
        call.resolve(message.result);
      }
    });

    ws.on('close', () => {
      this.closed = true;
      for (const call of this.pending.values()) {
        call.reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string, timeoutMs = 10000): Promise<CdpConnection> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(new Error('CDP connect timeout')), timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        res();
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        rej(err instanceof Error ? err : new Error(String(err)));
      });
    });
    return new CdpConnection(ws);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('CDP connection closed'));
    }
    const id = ++this.nextId;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { resolve: res as (value: unknown) => void, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }), (err) => {
        if (!err) return;
        this.pending.delete(id);
        rej(err);
      });
    });
  }

  /** Evaluate a JS expression in the page and return its JSON value. */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const response = await this.send<{ result?: { value?: T } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return response.result?.value as T;
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

// --- Session lifecycle ------------------------------------------------------

interface Session {
  process: ChildProcess;
  cdp: CdpConnection;
  userAgent: string;
  /** Page currently shows Bing's home page with an empty search box. */
  atHome: boolean;
  idleTimer: NodeJS.Timeout | null;
}

let session: Session | null = null;
let launching: Promise<Session> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let exitHookInstalled = false;
/** Set when the browser cannot be used at all (no binary, launch failure). */
let unavailableReason: string | null = null;

export function isBrowserAvailable(): boolean {
  return unavailableReason === null && resolveChromePath() !== null;
}

/** Reason the browser mode is disabled, for diagnostics. */
export function browserUnavailableReason(): string | null {
  if (unavailableReason) return unavailableReason;
  return resolveChromePath() === null ? 'Chrome/Edge binary not found' : null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(
  probe: () => Promise<T | undefined | false>,
  deadline: number,
  label: string,
): Promise<T> {
  while (Date.now() < deadline) {
    const value = await probe().catch(() => undefined);
    if (value) return value;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Bing browser timeout: ${label}`);
}

function touchIdleTimer(current: Session): void {
  if (current.idleTimer) clearTimeout(current.idleTimer);
  const idleMs = Math.max(5000, config.BING_BROWSER_IDLE_MS);
  current.idleTimer = setTimeout(() => {
    logger.debug('Bing browser idle — closing Chrome');
    void closeBrowser();
  }, idleMs);
  current.idleTimer.unref?.();
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    try {
      session?.process.kill();
    } catch {
      // nothing to do on shutdown
    }
  });
}

async function findPageTarget(port: string, deadline: number): Promise<string> {
  return waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return false;
    const targets = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
    return targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  }, deadline, 'page target');
}

async function launchSession(): Promise<Session> {
  const chromePath = resolveChromePath();
  if (!chromePath) {
    unavailableReason = 'Chrome/Edge binary not found';
    throw new BrowserUnavailableError(unavailableReason);
  }

  const profileDir = config.BING_BROWSER_PROFILE_DIR?.trim() || DEFAULT_PROFILE_DIR;
  mkdirSync(profileDir, { recursive: true });

  logger.debug({ chromePath, profileDir }, 'Launching Bing browser mode');
  const child = spawn(chromePath, buildChromeArgs(profileDir), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let wsUrl: string | undefined;
  let stderr = '';

  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderr = (stderr + text).slice(-4000);
    const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match && !wsUrl) wsUrl = match[1];
  });

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  try {
    await waitFor(async () => wsUrl, deadline, 'devtools endpoint');
  } catch (err) {
    child.kill();
    const detail = stderr.trim().split('\n').slice(-2).join(' ');
    throw new BrowserUnavailableError(`Chrome did not expose DevTools: ${detail || String(err)}`);
  }

  const port = new URL(wsUrl as string).port;
  const pageWsUrl = await findPageTarget(port, deadline);
  const cdp = await CdpConnection.connect(pageWsUrl);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const userAgent = normalizeUserAgent(await cdp.evaluate<string>('navigator.userAgent'));
    const current: Session = { process: child, cdp, userAgent, atHome: false, idleTimer: null };
    touchIdleTimer(current);
    installExitHook();
    logger.debug({ userAgent }, 'Bing browser ready');
    return current;
  } catch (err) {
    cdp.close();
    child.kill();
    throw err;
  }
}

async function ensureSession(): Promise<Session> {
  if (session && !session.cdp.isClosed) {
    return session;
  }
  if (!launching) {
    launching = launchSession()
      .then((created) => {
        session = created;
        return created;
      })
      .catch((err: unknown) => {
        unavailableReason = err instanceof Error ? err.message : String(err);
        throw err;
      })
      .finally(() => {
        launching = null;
      });
  }
  return launching;
}

async function dismissConsent(cdp: CdpConnection): Promise<void> {
  await cdp
    .evaluate<boolean>(`(() => {
      let clicked = false;
      for (const el of document.querySelectorAll('button,a')) {
        const label = ((el.id || '') + ' ' + (el.className || '') + ' ' + (el.textContent || '')).toLowerCase();
        if (/accept|agree|принять|согласен/.test(label) && el.offsetParent) {
          el.click();
          clicked = true;
        }
      }
      return clicked;
    })()`)
    .catch(() => false);
}

async function pressEnter(cdp: CdpConnection): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    text: '\r',
  });
  await sleep(40);
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
}

/**
 * Type the query into Bing's search box and submit it like a user would.
 * Returns the resulting SERP HTML.
 */
async function runBrowserSearch(query: string, deadline: number): Promise<string> {
  const current = await ensureSession();
  const { cdp } = current;
  touchIdleTimer(current);

  await cdp
    .send('Emulation.setUserAgentOverride', {
      userAgent: current.userAgent,
      acceptLanguage: config.BING_ACCEPT_LANGUAGE?.trim() || buildAcceptLanguage(query),
    })
    .catch((err: unknown) => logger.debug({ err: String(err) }, 'Bing browser UA override failed'));

  if (!current.atHome) {
    // Wait for the home page itself, not just for `#sb_form_q`: the previous
    // SERP also has that id, and evaluating right after Page.navigate() would
    // otherwise type into the outgoing document.
    await cdp.send('Page.navigate', { url: HOME_URL });
    await waitFor(
      async () =>
        (await cdp.evaluate<boolean>(`location.pathname === '/' && document.readyState === 'complete'`)) || undefined,
      deadline,
      'Bing home page',
    );
    await waitFor(
      async () => (await cdp.evaluate<boolean>(`!!document.querySelector('#sb_form_q')`)) || undefined,
      deadline,
      'Bing search box',
    );
    await dismissConsent(cdp);
    await sleep(200);
    current.atHome = true;
  }

  await cdp.evaluate(
    `(() => {
      const input = document.querySelector('#sb_form_q');
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    })()`,
  );
  await cdp.send('Input.insertText', { text: query });
  await sleep(120);

  // A swallowed focus would leave the box empty and Enter would submit the
  // previous query — verify the text landed, and type once more if it did not.
  const typed = await cdp.evaluate<string>(`document.querySelector('#sb_form_q')?.value ?? ''`);
  const probe = query.slice(0, Math.min(12, query.length));
  if (!typed.includes(probe)) {
    logger.debug({ typed, query }, 'Bing search box did not take the query — retrying input');
    await cdp.evaluate(
      `(() => {
        const input = document.querySelector('#sb_form_q');
        if (!input) return false;
        input.focus();
        input.select();
        return true;
      })()`,
    );
    await cdp.send('Input.insertText', { text: query });
    await sleep(150);
  }

  await pressEnter(cdp);

  // The form submit navigates to /search; if Enter was swallowed (overlay,
  // focus loss) fall back to clicking the magnifier once.
  const navigated = await waitFor(
    async () => (await cdp.evaluate<boolean>(`location.pathname === '/search'`)) || undefined,
    Math.min(deadline, Date.now() + 6000),
    'search navigation',
  ).catch(() => undefined);

  if (!navigated) {
    await cdp.evaluate(`document.querySelector('#search_icon')?.click()`).catch(() => undefined);
  }

  await waitFor(
    async () =>
      (await cdp.evaluate<boolean>(
        `location.pathname === '/search' && (document.querySelectorAll('li.b_algo').length > 0 || !!document.querySelector('#b_results'))`,
      )) || undefined,
    deadline,
    'search results',
  );

  // Give the page a moment to finish rendering organic items.
  await sleep(600);
  current.atHome = false;
  return cdp.evaluate<string>('document.documentElement.outerHTML');
}

export interface BrowserFetchOptions {
  timeoutMs?: number;
}

/**
 * Fetch a Bing SERP through a headless Chrome with a typed query.
 * Calls are serialised: one browser, one page, one search at a time.
 */
export async function fetchSerpViaBrowser(query: string, options: BrowserFetchOptions = {}): Promise<string> {
  const run = async (): Promise<string> => {
    const timeoutMs = options.timeoutMs ?? config.BING_BROWSER_TIMEOUT_MS;
    const deadline = Date.now() + Math.max(3000, timeoutMs);
    try {
      return await runBrowserSearch(query, deadline);
    } catch (err) {
      // A broken page/process must not poison the next search.
      await closeBrowser();
      throw err;
    }
  };

  const task = queue.then(run, run);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** Kill the shared Chrome process (idle timeout, shutdown, or after failure). */
export async function closeBrowser(): Promise<void> {
  const current = session;
  session = null;
  launching = null;
  if (!current) return;

  if (current.idleTimer) clearTimeout(current.idleTimer);
  current.cdp.close();
  try {
    current.process.kill();
  } catch {
    // already exited
  }
  logger.debug('Bing browser closed');
}

/** Test seam: forget the "unavailable" verdict (after fixing BING_BROWSER_PATH). */
export function resetBrowserAvailability(): void {
  unavailableReason = null;
}
