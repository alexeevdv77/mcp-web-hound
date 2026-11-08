import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CacheInfo = {
  dir: string;
  exists: boolean;
  size_bytes: number;
  files: string[];
  complete: boolean;
};

const runtime = vi.hoisted(() => ({
  available: false,
  flipOnInstall: false,
  cacheDir: 'C:/shared-model-cache',
  cache: new Map<string, CacheInfo>(),
  spawnResult: { status: 0 } as { status: number | null },
  pipelineModels: [] as string[],
}));

vi.mock('../../src/embeddings/model-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/embeddings/model-runtime.js')>();
  return {
    ...actual,
    isModelStackAvailable: () => runtime.available,
    modelRuntimeDir: () => (runtime.available ? 'C:/pkg/node_modules/@xenova/transformers' : undefined),
    resolveModelCacheDir: () => runtime.cacheDir,
    declaredModelRuntimeVersion: () => '2.17.2',
    inspectModelCache: (modelId: string): CacheInfo =>
      runtime.cache.get(modelId) ?? {
        dir: `${runtime.cacheDir}/${modelId}`,
        exists: false,
        size_bytes: 0,
        files: [],
        complete: false,
      },
    loadModelRuntime: async () => ({
      pipeline: async (_task: string, modelId: string) => {
        runtime.pipelineModels.push(modelId);
        return () => [];
      },
    }),
  };
});

vi.mock('node:child_process', () => ({
  spawnSync: () => {
    if (runtime.spawnResult.status === 0 && runtime.flipOnInstall) runtime.available = true;
    return runtime.spawnResult;
  },
}));

import { formatBytes } from '../../src/embeddings/model-runtime.js';
import { main } from '../../src/cli/models.js';

const EMBEDDING = 'Xenova/multilingual-e5-small';
const NLI = 'Xenova/nli-deberta-v3-xsmall';

let out: string[] = [];
let err: string[] = [];

function cached(id: string, sizeBytes = 1024): void {
  runtime.cache.set(id, {
    dir: `${runtime.cacheDir}/${id}`,
    exists: true,
    size_bytes: sizeBytes,
    files: ['tokenizer.json', 'onnx/model_quantized.onnx'],
    complete: true,
  });
}

beforeEach(() => {
  runtime.available = false;
  runtime.flipOnInstall = false;
  runtime.cache = new Map();
  runtime.spawnResult = { status: 0 };
  runtime.pipelineModels = [];
  process.exitCode = 0;
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

const stdoutOf = (): string => out.join('');
const stderrOf = (): string => err.join('');

describe('models path', () => {
  it('prints the cache directory only', async () => {
    await main(['path']);
    expect(stdoutOf().trim()).toBe(runtime.cacheDir);
  });
});

describe('models status', () => {
  it('reports a missing stack and how to install it', async () => {
    await main(['status']);
    expect(stdoutOf()).toContain('MISSING');
    expect(stdoutOf()).toContain(runtime.cacheDir);
    expect(stdoutOf()).toContain('models install');
    expect(stdoutOf()).toContain('npm i -g @xenova/transformers@2.17.2');
  });

  it('reports a ready model with its size and a missing one', async () => {
    runtime.available = true;
    cached(EMBEDDING, 129 * 1024 * 1024);

    await main(['status']);
    expect(stdoutOf()).toContain('Model stack  : available');
    expect(stdoutOf()).toContain(`ready, ${formatBytes(129 * 1024 * 1024)}`);
    expect(stdoutOf()).toContain('not downloaded');
  });

  it('shows where an incomplete download lives', async () => {
    runtime.available = true;
    runtime.cache.set(EMBEDDING, {
      dir: `${runtime.cacheDir}/${EMBEDDING}`,
      exists: true,
      size_bytes: 12,
      files: ['config.json'],
      complete: false,
    });

    await main(['status']);
    expect(stdoutOf()).toContain('incomplete');
    expect(stdoutOf()).toContain(`${runtime.cacheDir}/${EMBEDDING}`);
  });
});

describe('models install', () => {
  it('does nothing when the stack is already present', async () => {
    runtime.available = true;
    await main(['install']);
    expect(stdoutOf()).toContain('already installed');
    expect(process.exitCode).toBe(0);
  });

  it('reports a failed npm run', async () => {
    runtime.spawnResult = { status: 1 };
    await main(['install']);
    expect(stderrOf()).toContain('Install failed');
    expect(process.exitCode).toBe(1);
  });

  it('reports success that leaves the package unresolvable', async () => {
    runtime.spawnResult = { status: 0 };
    await main(['install']);
    expect(stderrOf()).toContain('still not resolvable');
    expect(process.exitCode).toBe(1);
  });

  it('confirms the package once npm finishes and it resolves', async () => {
    // The fake npm run flips availability on success.
    runtime.flipOnInstall = true;
    await main(['install']);
    expect(stdoutOf()).toContain('Installing @xenova/transformers@2.17.2 globally');
    expect(stdoutOf()).toContain('Installed:');
    expect(process.exitCode).toBe(0);
  });
});

describe('models download', () => {
  it('refuses without the model stack', async () => {
    await main(['download']);
    expect(stderrOf()).toContain('models install');
    expect(process.exitCode).toBe(1);
  });

  it('skips models that are already cached', async () => {
    runtime.available = true;
    cached(EMBEDDING);
    cached(NLI);

    await main(['download']);
    expect(stdoutOf()).toContain('already cached');
    expect(runtime.pipelineModels).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it('downloads a missing model and reports its size', async () => {
    runtime.available = true;
    cached(NLI, 2048);

    await main(['download']);
    expect(runtime.pipelineModels).toEqual([EMBEDDING]);
    expect(stdoutOf()).toContain('downloading');
    expect(process.exitCode).toBe(0);
  });

  it('re-fetches cached models with --force', async () => {
    runtime.available = true;
    cached(EMBEDDING);
    cached(NLI);

    await main(['download', '--force']);
    expect(runtime.pipelineModels).toEqual([EMBEDDING, NLI]);
    expect(process.exitCode).toBe(0);
  });
});

describe('models help', () => {
  it('prints usage for --help', async () => {
    await main(['--help']);
    expect(stdoutOf()).toContain('Usage:');
    expect(stdoutOf()).toContain('MODEL_CACHE_DIR');
  });

  it('prints usage and fails for an unknown command', async () => {
    await main(['nope']);
    expect(stderrOf()).toContain('Unknown models command');
    expect(stdoutOf()).toContain('Usage:');
    expect(process.exitCode).toBe(1);
  });
});
