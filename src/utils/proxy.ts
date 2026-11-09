import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { logger } from './logger.js';

/**
 * Standard proxy variables, in the order undici resolves them.
 *
 * Node's global fetch ignores all of them by default: the built-in dispatcher
 * connects directly. `NODE_USE_ENV_PROXY=1` makes Node itself honour them, but
 * that flag exists only on Node 24+, so older runtimes need the dispatcher below.
 *
 * `NO_PROXY` does not enable proxying on its own — it only lists hosts to skip,
 * and `ALL_PROXY` is not read by undici at all.
 */
const PROXY_VARS = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY'] as const;

/**
 * undici's default connect timeout is 10 s. A proxy that is briefly saturated
 * (for example while a large model file is streaming through it) can exceed
 * that, surfacing as `UND_ERR_CONNECT_TIMEOUT` / `fetch failed` even though the
 * proxy is reachable. A longer timeout rides out those spikes; a genuinely
 * unreachable proxy still fails, just later.
 */
export const PROXY_CONNECT_TIMEOUT_MS = 30_000;

/** First non-empty proxy value from the environment, or undefined when none is set. */
export function proxyUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of PROXY_VARS) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Proxy URL with credentials replaced, so `user:pass@host` never reaches the log. */
export function redactProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '***';
  }
}

/**
 * Install the undici dispatcher that honours `HTTP_PROXY` / `HTTPS_PROXY` /
 * `NO_PROXY`. Must run after the `.env` files are loaded into `process.env`
 * (see `config.ts`) and before the first outbound request.
 *
 * No proxy variables -> the global dispatcher is left untouched, so the server
 * behaves exactly as before. Returns whether a proxy was installed.
 */
export function installEnvProxy(): boolean {
  const proxy = proxyUrlFromEnv();
  if (!proxy) return false;

  try {
    setGlobalDispatcher(new EnvHttpProxyAgent({ connectTimeout: PROXY_CONNECT_TIMEOUT_MS }));
    logger.info(
      { proxy: redactProxyUrl(proxy), no_proxy: (process.env.no_proxy ?? process.env.NO_PROXY ?? '').trim() },
      'Proxy from environment',
    );
    return true;
  } catch (err) {
    // A broken proxy setting must not take the server down: log and stay direct.
    logger.warn({ err }, 'Proxy from environment could not be enabled');
    return false;
  }
}
