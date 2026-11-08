import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  declaredModelRuntimeVersion,
  formatBytes,
  importLegacyModelCache,
  inspectModelCache,
  isModelStackAvailable,
  modelRuntimeDir,
  normalizeModelId,
  resolveModelCacheDir,
} from '../../src/embeddings/model-runtime.js';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-web-hound-models-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveModelCacheDir', () => {
  it('uses MODEL_CACHE_DIR when it is set', () => {
    const configured = join(tmpdir(), 'explicit-model-cache');
    expect(resolveModelCacheDir({}, configured)).toBe(configured);
  });

  it('resolves a relative MODEL_CACHE_DIR against the working directory', () => {
    expect(resolveModelCacheDir({}, './relative-cache')).toBe(join(process.cwd(), 'relative-cache'));
  });

  it('honours HF_HOME', () => {
    const hfHome = join(tmpdir(), 'hf-home');
    expect(resolveModelCacheDir({ HF_HOME: hfHome }, '')).toBe(join(hfHome, 'transformers-js'));
  });

  it('honours XDG_CACHE_HOME when HF_HOME is not set', () => {
    const xdg = join(tmpdir(), 'xdg-cache');
    expect(resolveModelCacheDir({ XDG_CACHE_HOME: xdg }, '')).toBe(
      join(xdg, 'huggingface', 'transformers-js'),
    );
  });

  it('falls back to the shared Hugging Face cache under the home directory', () => {
    expect(resolveModelCacheDir({}, '')).toBe(join(homedir(), '.cache', 'huggingface', 'transformers-js'));
  });

  it('prefers MODEL_CACHE_DIR over HF_HOME', () => {
    const configured = join(tmpdir(), 'explicit-model-cache');
    const hfHome = join(tmpdir(), 'hf-home');
    expect(resolveModelCacheDir({ HF_HOME: hfHome }, configured)).toBe(configured);
  });

  it('ignores blank values', () => {
    const xdg = join(tmpdir(), 'xdg-cache');
    expect(resolveModelCacheDir({ HF_HOME: '  ', XDG_CACHE_HOME: xdg }, '   ')).toBe(
      join(xdg, 'huggingface', 'transformers-js'),
    );
  });
});

describe('inspectModelCache', () => {
  it('reports a missing model', () => {
    const cacheDir = tempDir();
    const info = inspectModelCache('Xenova/missing-model', cacheDir);

    expect(info.exists).toBe(false);
    expect(info.complete).toBe(false);
    expect(info.size_bytes).toBe(0);
    expect(info.files).toEqual([]);
    expect(info.dir).toBe(join(cacheDir, 'Xenova', 'missing-model'));
  });

  it('reports an incomplete download', () => {
    const cacheDir = tempDir();
    const modelDir = join(cacheDir, 'Xenova', 'partial');
    mkdirSync(join(modelDir, 'onnx'), { recursive: true });
    writeFileSync(join(modelDir, 'config.json'), '{}');
    writeFileSync(join(modelDir, 'onnx', 'model_quantized.onnx'), 'weights');

    const info = inspectModelCache('Xenova/partial', cacheDir);
    expect(info.exists).toBe(true);
    // No tokenizer.json yet.
    expect(info.complete).toBe(false);
    expect(info.size_bytes).toBeGreaterThan(0);
  });

  it('reports a complete model', () => {
    const cacheDir = tempDir();
    const modelDir = join(cacheDir, 'Xenova', 'ready');
    mkdirSync(join(modelDir, 'onnx'), { recursive: true });
    writeFileSync(join(modelDir, 'tokenizer.json'), '{}');
    writeFileSync(join(modelDir, 'onnx', 'model_quantized.onnx'), 'weights');

    const info = inspectModelCache('Xenova/ready', cacheDir);
    expect(info.complete).toBe(true);
    expect(info.files).toContain('tokenizer.json');
    expect(info.files).toContain('onnx/model_quantized.onnx');
  });
});

describe('model runtime helpers', () => {
  it('normalizes model ids to the Xenova org', () => {
    expect(normalizeModelId('multilingual-e5-small')).toBe('Xenova/multilingual-e5-small');
    expect(normalizeModelId('Xenova/nli-deberta-v3-xsmall')).toBe('Xenova/nli-deberta-v3-xsmall');
    expect(normalizeModelId('Xenova')).toBe('Xenova');
  });

  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(220 * 1024 * 1024)).toBe('220.0 MB');
  });

  it('declares the runtime version from the manifest', () => {
    expect(declaredModelRuntimeVersion()).toBe('2.17.2');
  });

  it('reports stack availability from the installed package', () => {
    expect(isModelStackAvailable()).toBe(modelRuntimeDir() !== undefined);
  });

  it('imports nothing when there is no legacy cache', () => {
    expect(importLegacyModelCache(tempDir(), join(tempDir(), 'absent'))).toEqual([]);
  });

  it('skips the import when the legacy root is the target itself', () => {
    const dir = tempDir();
    expect(importLegacyModelCache(dir, dir)).toEqual([]);
  });

  it('copies the weights out of the package cache once', () => {
    const legacy = tempDir();
    mkdirSync(join(legacy, 'Xenova', 'multilingual-e5-small', 'onnx'), { recursive: true });
    writeFileSync(join(legacy, 'Xenova', 'multilingual-e5-small', 'tokenizer.json'), '{}');
    writeFileSync(join(legacy, 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'), 'weights');
    const target = tempDir();

    expect(importLegacyModelCache(target, legacy)).toEqual(['Xenova/multilingual-e5-small']);
    const copied = inspectModelCache('Xenova/multilingual-e5-small', target);
    expect(copied.complete).toBe(true);
    expect(copied.size_bytes).toBeGreaterThan(0);

    // Already in the shared cache: nothing to copy a second time.
    expect(importLegacyModelCache(target, legacy)).toEqual([]);
  });
});
