import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_PROFILE_DIR,
  browserUnavailableReason,
  buildChromeArgs,
  closeBrowser,
  fetchSerpViaBrowser,
  isBrowserAvailable,
  normalizeUserAgent,
  resetBrowserAvailability,
  resolveChromePath,
} from '../../../src/search/providers/bing-browser.js';
import { config } from '../../../src/utils/config.js';

/** Fake Chrome + fake CDP socket: records what the provider asked the browser to do. */
const fake = vi.hoisted(() => ({
  devtoolsLine: 'DevTools listening on ws://127.0.0.1:9333/devtools/browser/fake-session\n',
  calls: [] as Array<{ method: string; params: Record<string, unknown> }>,
  evaluate: (_expression: string): unknown => undefined,
  spawnCount: 0,
  killCount: 0,
}));

vi.mock('node:child_process', () => ({
  spawn: () => {
    fake.spawnCount += 1;
    return {
      pid: 4242,
      stdout: { on: () => undefined },
      stderr: {
        on: (_event: string, callback: (chunk: Buffer) => void) => {
          setTimeout(() => callback(Buffer.from(fake.devtoolsLine)), 0);
        },
      },
      kill: () => {
        fake.killCount += 1;
        return true;
      },
      once: () => undefined,
    };
  },
}));

vi.mock('ws', () => {
  class FakeCdpSocket {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(_url: string) {
      setTimeout(() => this.fire('open'), 0);
    }

    on(event: string, callback: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? [];
      list.push(callback);
      this.listeners.set(event, list);
    }

    once(event: string, callback: (...args: unknown[]) => void): void {
      const wrapper = (...args: unknown[]): void => {
        this.off(event, wrapper);
        callback(...args);
      };
      this.on(event, wrapper);
    }

    off(event: string, callback: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? [];
      this.listeners.set(event, list.filter((cb) => cb !== callback));
    }

    private fire(event: string, ...args: unknown[]): void {
      for (const callback of [...(this.listeners.get(event) ?? [])]) callback(...args);
    }

    send(payload: string, callback?: (err?: Error) => void): void {
      const message = JSON.parse(payload) as { id: number; method: string; params?: Record<string, unknown> };
      fake.calls.push({ method: message.method, params: message.params ?? {} });

      const result =
        message.method === 'Runtime.evaluate'
          ? { result: { value: fake.evaluate(String(message.params?.expression ?? '')) } }
          : {};
      setTimeout(() => this.fire('message', JSON.stringify({ id: message.id, result })), 0);
      callback?.();
    }

    close(): void {
      this.fire('close');
    }
  }

  return { default: FakeCdpSocket };
});

const HEADLESS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36';

describe('normalizeUserAgent', () => {
  it('removes the HeadlessChrome token Bing keys the fallback SERP on', () => {
    const ua = normalizeUserAgent(HEADLESS_UA);

    expect(ua).not.toContain('HeadlessChrome');
    expect(ua).toContain('Chrome/131.0.0.0');
  });

  it('is case-insensitive and leaves a regular UA untouched', () => {
    expect(normalizeUserAgent('Foo headlesschrome/1.0 Bar')).toBe('Foo Chrome/1.0 Bar');

    const regular = HEADLESS_UA.replace('HeadlessChrome', 'Chrome');
    expect(normalizeUserAgent(regular)).toBe(regular);
  });
});

describe('buildChromeArgs', () => {
  it('runs an isolated, headless profile with a random DevTools port', () => {
    const args = buildChromeArgs('C:\\profiles\\bing');

    expect(args).toContain('--headless=new');
    expect(args).toContain('--user-data-dir=C:\\profiles\\bing');
    expect(args).toContain('--remote-debugging-port=0');
    expect(args).toContain('about:blank');
    expect(args).toContain('--no-first-run');
  });

  it('drops the headless flag when BING_BROWSER_HEADLESS=false', () => {
    const original = config.BING_BROWSER_HEADLESS;
    try {
      config.BING_BROWSER_HEADLESS = false;
      const args = buildChromeArgs('/tmp/bing-profile');

      expect(args).not.toContain('--headless=new');
      expect(args).toContain('--user-data-dir=/tmp/bing-profile');
    } finally {
      config.BING_BROWSER_HEADLESS = original;
    }
  });
});

describe('browser discovery', () => {
  it('accepts an explicit path only when it exists', () => {
    expect(resolveChromePath('/definitely/not/a/chrome/binary')).toBeNull();
    const detected = resolveChromePath();
    expect(detected === null || typeof detected === 'string').toBe(true);
  });

  it('exposes availability without throwing', () => {
    expect(typeof isBrowserAvailable()).toBe('boolean');
    const reason = browserUnavailableReason();
    expect(reason === null || typeof reason === 'string').toBe(true);
  });

  it('uses a dedicated profile directory under the config dir', () => {
    expect(DEFAULT_PROFILE_DIR.replace(/\\/g, '/')).toMatch(/\/bing-chrome-profile$/);
  });

  it('closes cleanly when no browser is running', async () => {
    await expect(closeBrowser()).resolves.toBeUndefined();
  });
});

describe('typed search through a mocked CDP session', () => {
  const QUERY = 'сколько стоит солярка';
  const SERP =
    '<html><body><ol id="b_results"><li class="b_algo"><h2><a href="https://example.com/solyarka">Солярка — цена за литр</a></h2></li></ol></body></html>';

  const originalPath = config.BING_BROWSER_PATH;
  const originalProfile = config.BING_BROWSER_PROFILE_DIR;

  /** Text the fake page currently has in the box — whatever insertText last sent. */
  function lastTyped(): string {
    const inserts = fake.calls.filter((call) => call.method === 'Input.insertText');
    return String(inserts[inserts.length - 1]?.params.text ?? '');
  }

  /** Answers every Runtime.evaluate the browser channel performs, in a healthy session. */
  function healthyPage(expression: string): unknown {
    if (expression === 'navigator.userAgent') return HEADLESS_UA;
    if (expression === 'document.documentElement.outerHTML') return SERP;
    if (expression.includes("location.pathname === '/search'")) return true;
    if (expression.includes("location.pathname === '/'")) return true;
    if (expression.includes('#sb_form_q')) return expression.includes('.value') ? lastTyped() : true;
    if (expression.includes('accept|agree')) return false;
    return undefined;
  }

  beforeEach(() => {
    fake.calls.length = 0;
    fake.spawnCount = 0;
    fake.killCount = 0;
    fake.evaluate = healthyPage;
    resetBrowserAvailability();

    config.BING_BROWSER_PATH = process.execPath; // any existing binary — launch is faked anyway
    config.BING_BROWSER_PROFILE_DIR = join(tmpdir(), 'mcp-web-hound-bing-test-profile');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/fake' }],
      })),
    );
  });

  afterEach(async () => {
    await closeBrowser();
    vi.unstubAllGlobals();
    config.BING_BROWSER_PATH = originalPath;
    config.BING_BROWSER_PROFILE_DIR = originalProfile;
  });

  function paramsOf(method: string): Record<string, unknown> | undefined {
    return fake.calls.find((call) => call.method === method)?.params;
  }

  it('launches Chrome, types the query with a clean UA and returns the SERP', { timeout: 20000 }, async () => {
    const html = await fetchSerpViaBrowser(QUERY, { timeoutMs: 10000 });

    expect(html).toContain('b_algo');
    expect(fake.spawnCount).toBe(1);

    expect(paramsOf('Page.navigate')?.url).toBe('https://www.bing.com/');
    expect(paramsOf('Input.insertText')?.text).toBe(QUERY);
    expect(fake.calls.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => c.params.type)).toEqual([
      'keyDown',
      'keyUp',
    ]);

    // the whole point of this channel: no HeadlessChrome token, locale from the query
    const override = paramsOf('Emulation.setUserAgentOverride');
    expect(String(override?.userAgent)).not.toContain('HeadlessChrome');
    expect(String(override?.userAgent)).toContain('Chrome/131.0.0.0');
    expect(String(override?.acceptLanguage)).toMatch(/^ru-RU/);
  });

  it('reuses the same Chrome process for the next search', { timeout: 30000 }, async () => {
    await fetchSerpViaBrowser(QUERY, { timeoutMs: 10000 });
    await fetchSerpViaBrowser('замена ремня ГРМ цена', { timeoutMs: 10000 });

    expect(fake.spawnCount).toBe(1);
    expect(fake.calls.filter((c) => c.method === 'Input.insertText')).toHaveLength(2);
    // each search starts from the home page: the SERP also has #sb_form_q
    expect(fake.calls.filter((c) => c.method === 'Page.navigate')).toHaveLength(2);
  });

  it('kills the browser and reports a timeout when results never render', { timeout: 30000 }, async () => {
    fake.evaluate = (expression: string): unknown => {
      if (expression === 'navigator.userAgent') return HEADLESS_UA;
      if (expression.includes('/search')) return false;
      if (expression.includes('#sb_form_q')) return expression.includes('.value') ? QUERY : true;
      return undefined;
    };

    await expect(fetchSerpViaBrowser(QUERY, { timeoutMs: 3000 })).rejects.toThrow('Bing browser timeout');
    expect(fake.killCount).toBeGreaterThan(0);
  });
});
