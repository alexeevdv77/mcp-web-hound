import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { installEnvProxy, proxyUrlFromEnv, redactProxyUrl } from '../../src/utils/proxy.js';

const PROXY_KEYS = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'no_proxy', 'NO_PROXY'];

const originalDispatcher = getGlobalDispatcher();

beforeEach(() => {
  // The real environment may carry proxy variables; start every case from empty.
  for (const key of PROXY_KEYS) vi.stubEnv(key, '');
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  vi.unstubAllEnvs();
});

describe('proxyUrlFromEnv', () => {
  it('reads the uppercase and lowercase variants', () => {
    expect(proxyUrlFromEnv({ HTTPS_PROXY: 'http://proxy.local:3128' })).toBe('http://proxy.local:3128');
    expect(proxyUrlFromEnv({ https_proxy: 'http://proxy.local:3128' })).toBe('http://proxy.local:3128');
    expect(proxyUrlFromEnv({ HTTP_PROXY: 'http://proxy.local:8080' })).toBe('http://proxy.local:8080');
  });

  it('prefers the lowercase variant, matching undici precedence', () => {
    expect(
      proxyUrlFromEnv({ http_proxy: 'http://lower:1', HTTP_PROXY: 'http://upper:2' }),
    ).toBe('http://lower:1');
  });

  it('ignores unset, empty and whitespace-only values', () => {
    expect(proxyUrlFromEnv({})).toBeUndefined();
    expect(proxyUrlFromEnv({ HTTPS_PROXY: '' })).toBeUndefined();
    expect(proxyUrlFromEnv({ HTTPS_PROXY: '   ' })).toBeUndefined();
  });

  it('does not treat NO_PROXY alone as a proxy', () => {
    expect(proxyUrlFromEnv({ NO_PROXY: 'localhost,127.0.0.1' })).toBeUndefined();
  });
});

describe('redactProxyUrl', () => {
  it('masks embedded credentials', () => {
    const masked = redactProxyUrl('http://user:secret@proxy.local:3128');
    expect(masked).not.toContain('user');
    expect(masked).not.toContain('secret');
    expect(masked).toContain('proxy.local:3128');
  });

  it('keeps credential-free urls intact', () => {
    expect(redactProxyUrl('http://proxy.local:3128')).toBe('http://proxy.local:3128/');
  });

  it('falls back to a placeholder for unparsable values', () => {
    expect(redactProxyUrl('not a url')).toBe('***');
  });
});

describe('installEnvProxy', () => {
  it('leaves the global dispatcher untouched when no proxy is configured', () => {
    expect(installEnvProxy()).toBe(false);
    expect(getGlobalDispatcher()).toBe(originalDispatcher);
  });

  it('installs the env-aware dispatcher when HTTPS_PROXY is set', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:9');
    expect(installEnvProxy()).toBe(true);
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it('installs it for the lowercase-only form too', () => {
    vi.stubEnv('http_proxy', 'http://127.0.0.1:9');
    expect(installEnvProxy()).toBe(true);
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent);
  });

  it('does nothing when only NO_PROXY is set', () => {
    vi.stubEnv('NO_PROXY', 'localhost');
    expect(installEnvProxy()).toBe(false);
    expect(getGlobalDispatcher()).toBe(originalDispatcher);
  });
});
