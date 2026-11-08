import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

/**
 * The ONNX stack is an optional dependency: a lean install (`--omit=optional`)
 * leaves it out, and the server keeps working with semantic dedup and the NLI
 * signal disabled. Loading it through a non-literal specifier also keeps `tsc`
 * independent of its type declarations.
 */
const MODEL_RUNTIME_SPECIFIER = '@xenova/transformers';

type ModelRuntimeEnv = {
  cacheDir: string;
  allowRemoteModels: boolean;
  allowLocalModels: boolean;
  useFSCache: boolean;
};

export type ModelRuntimeModule = {
  env: ModelRuntimeEnv;
  pipeline: (...args: unknown[]) => Promise<unknown>;
};

export interface ModelCacheInfo {
  /** Absolute path of this model inside the cache. */
  dir: string;
  exists: boolean;
  size_bytes: number;
  files: string[];
  /** Tokenizer plus at least one ONNX weight file are present. */
  complete: boolean;
}

const requireFromHere = createRequire(import.meta.url);
let configuredCacheDir: string | undefined;

/** Directory of the installed `@xenova/transformers`, or undefined when absent. */
export function modelRuntimeDir(): string | undefined {
  try {
    return dirname(dirname(requireFromHere.resolve(MODEL_RUNTIME_SPECIFIER)));
  } catch {
    return undefined;
  }
}

export function isModelStackAvailable(): boolean {
  return modelRuntimeDir() !== undefined;
}

/** Version declared in this package's manifest (the version npm is asked to install). */
export function declaredModelRuntimeVersion(): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { optionalDependencies?: Record<string, string>; dependencies?: Record<string, string> };
    return pkg.optionalDependencies?.[MODEL_RUNTIME_SPECIFIER] ?? pkg.dependencies?.[MODEL_RUNTIME_SPECIFIER];
  } catch {
    return undefined;
  }
}

/**
 * Shared model cache, so reinstalls and other tools can reuse the weights.
 * Priority: MODEL_CACHE_DIR → HF_HOME → XDG_CACHE_HOME → ~/.cache, then
 * `<root>/huggingface/transformers-js` (the same root the HF tooling uses).
 */
export function resolveModelCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  configured: string = config.MODEL_CACHE_DIR,
): string {
  const explicit = configured.trim();
  if (explicit) return resolve(explicit);

  const hfHome = env.HF_HOME?.trim();
  if (hfHome) return join(resolve(hfHome), 'transformers-js');

  const cacheBase = env.XDG_CACHE_HOME?.trim() || join(homedir(), '.cache');
  return join(resolve(cacheBase), 'huggingface', 'transformers-js');
}

function walkFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

export function inspectModelCache(modelId: string, cacheDir: string = resolveModelCacheDir()): ModelCacheInfo {
  const dir = join(cacheDir, modelId);
  if (!existsSync(dir)) {
    return { dir, exists: false, size_bytes: 0, files: [], complete: false };
  }

  const files = walkFiles(dir);
  let sizeBytes = 0;
  for (const rel of files) {
    try {
      sizeBytes += statSync(join(dir, rel)).size;
    } catch {
      // A file vanished mid-scan; ignore it, the size is informational only.
    }
  }

  const complete =
    files.includes('tokenizer.json') && files.some((f) => f.startsWith('onnx/') && f.endsWith('.onnx'));
  return { dir, exists: true, size_bytes: sizeBytes, files, complete };
}

/**
 * Older installs kept the weights inside the package
 * (`<pkg>/node_modules/@xenova/transformers/.cache`), which a reinstall deletes.
 * On the first run with the shared cache, copy whatever is already there
 * instead of downloading it again.
 */
/** `<package>/.cache`, the cache location transformers.js defaults to. */
function defaultLegacyCacheRoot(): string | undefined {
  const runtimeDir = modelRuntimeDir();
  return runtimeDir ? join(runtimeDir, '.cache') : undefined;
}

export function importLegacyModelCache(target: string, legacyRoot: string = defaultLegacyCacheRoot() ?? ''): string[] {
  if (!legacyRoot || !existsSync(legacyRoot) || resolve(legacyRoot) === resolve(target)) return [];

  const imported: string[] = [];
  for (const org of readdirSync(legacyRoot)) {
    const orgDir = join(legacyRoot, org);
    if (!statSync(orgDir).isDirectory()) continue;
    for (const model of readdirSync(orgDir)) {
      const src = join(orgDir, model);
      const dst = join(target, org, model);
      if (!statSync(src).isDirectory() || existsSync(dst)) continue;
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(src, dst, { recursive: true });
      imported.push(`${org}/${model}`);
    }
  }

  if (imported.length > 0) {
    logger.info({ from: legacyRoot, to: target, models: imported }, 'Imported model cache from the package directory');
  }
  return imported;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Load the optional runtime once, pointing it at the shared cache. */
export async function loadModelRuntime(): Promise<ModelRuntimeModule> {
  const mod = (await import(MODEL_RUNTIME_SPECIFIER)) as ModelRuntimeModule;

  if (configuredCacheDir === undefined) {
    const cacheDir = resolveModelCacheDir();
    mod.env.cacheDir = cacheDir;
    mod.env.allowRemoteModels = true;
    mod.env.allowLocalModels = true;
    mod.env.useFSCache = true;
    importLegacyModelCache(cacheDir);
    configuredCacheDir = cacheDir;
    logger.info({ cache_dir: cacheDir }, 'Model cache directory');
  }

  return mod;
}

/** Normalize a configured model name to the `<org>/<name>` form used on disk. */
export function normalizeModelId(model: string): string {
  return model.startsWith('Xenova') ? model : `Xenova/${model}`;
}
