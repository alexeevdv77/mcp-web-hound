#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process, { stdout, stderr } from 'node:process';
import { config } from '../utils/config.js';
import {
  declaredModelRuntimeVersion,
  formatBytes,
  inspectModelCache,
  isModelStackAvailable,
  loadModelRuntime,
  modelRuntimeDir,
  normalizeModelId,
  resolveModelCacheDir,
} from '../embeddings/model-runtime.js';

const isWindows = process.platform === 'win32';

function printHelp(): void {
  stdout.write(`
MCP Web Hound — Model Stack Tool

The ONNX stack (@xenova/transformers) is an optional dependency: semantic
deduplication and the NLI signal need it, everything else works without it.
Model weights live in a shared cache, so reinstalls and other transformers.js
tools can reuse them.

Usage:
  npx mcp-web-hound models               Show stack and cache status
  npx mcp-web-hound models status        Same as above
  npx mcp-web-hound models path          Print the cache directory
  npx mcp-web-hound models install       Install @xenova/transformers globally (repair)
  npx mcp-web-hound models download      Download the embedding and NLI models
  npx mcp-web-hound models download --force   Re-check and fetch missing files
  npx mcp-web-hound models --help        Show this help

Cache directory (first match wins):
  1. MODEL_CACHE_DIR from the server .env
  2. $HF_HOME/transformers-js
  3. $XDG_CACHE_HOME/huggingface/transformers-js
  4. ~/.cache/huggingface/transformers-js

The on-disk layout is <cache>/<org>/<model>/ (transformers.js v2), not the
Python HF hub layout, so only transformers.js-based tools share the files.
`);
}

function npmInvocation(args: string[]): { command: string; args: string[] } {
  const npmCli = process.env.npm_execpath;
  if (npmCli) return { command: process.execPath, args: [npmCli, ...args] };
  return { command: isWindows ? 'npm.cmd' : 'npm', args };
}

function printStatus(): void {
  const available = isModelStackAvailable();
  const runtimeDir = modelRuntimeDir();
  const cacheDir = resolveModelCacheDir();

  stdout.write(`Model stack  : ${available ? 'available' : 'MISSING'}\n`);
  if (runtimeDir) stdout.write(`Package dir  : ${runtimeDir}\n`);
  stdout.write(`Cache dir    : ${cacheDir}\n`);
  if (config.MODEL_CACHE_DIR.trim()) stdout.write(`               (from MODEL_CACHE_DIR)\n`);

  if (!available) {
    const spec = `@xenova/transformers@${declaredModelRuntimeVersion() ?? '2.17.2'}`;
    stdout.write(`\nSemantic dedup and the NLI signal are disabled until it is installed:\n`);
    stdout.write(`  mcp-web-hound models install\n`);
    stdout.write(`  # or: npm i -g ${spec}\n`);
    return;
  }

  stdout.write(`Semantic cache: ${config.SEMANTIC_ENABLED ? 'enabled' : 'disabled (SEMANTIC_ENABLED=false)'}\n`);
  stdout.write('\n');

  const targets = [
    { role: 'Embedding', id: normalizeModelId(config.EMBEDDING_MODEL) },
    { role: 'NLI      ', id: normalizeModelId(config.INTENT_CLASSIFIER_MODEL) },
  ];
  for (const target of targets) {
    const info = inspectModelCache(target.id, cacheDir);
    const state = info.complete
      ? `ready, ${formatBytes(info.size_bytes)}`
      : info.exists
        ? `incomplete, ${formatBytes(info.size_bytes)}`
        : 'not downloaded';
    stdout.write(`${target.role}: ${target.id} — ${state}\n`);
    if (info.exists && !info.complete) stdout.write(`             ${info.dir}\n`);
  }
}

function installModelStack(): number {
  if (isModelStackAvailable()) {
    stdout.write(`@xenova/transformers is already installed:\n  ${modelRuntimeDir()}\n`);
    return 0;
  }

  const version = declaredModelRuntimeVersion() ?? '2.17.2';
  const spec = `@xenova/transformers@${version}`;
  stdout.write(`Installing ${spec} globally (npm i -g)…\n`);

  const { command, args } = npmInvocation(['install', '-g', spec, '--no-audit', '--no-fund']);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: !process.env.npm_execpath && isWindows,
  });

  if (result.status !== 0) {
    stderr.write(`\nInstall failed (exit ${result.status ?? 'unknown'}). Run it manually:\n  npm i -g ${spec}\n`);
    return 1;
  }

  if (!isModelStackAvailable()) {
    stderr.write(`\nnpm reported success, but the package is still not resolvable from this install.\n`);
    stderr.write(`Run it manually, then re-run "mcp-web-hound models status":\n  npm i -g ${spec}\n`);
    return 1;
  }

  stdout.write(`\nInstalled:\n  ${modelRuntimeDir()}\n`);
  return 0;
}

async function downloadModels(force: boolean): Promise<number> {
  if (!isModelStackAvailable()) {
    stderr.write('The model stack is not installed. Run "mcp-web-hound models install" first.\n');
    return 1;
  }

  const cacheDir = resolveModelCacheDir();
  stdout.write(`Cache dir: ${cacheDir}\n`);

  const runtime = await loadModelRuntime();
  const targets = [
    { task: 'feature-extraction', id: normalizeModelId(config.EMBEDDING_MODEL) },
    { task: 'zero-shot-classification', id: normalizeModelId(config.INTENT_CLASSIFIER_MODEL) },
  ];

  let failures = 0;
  for (const target of targets) {
    const before = inspectModelCache(target.id, cacheDir);
    if (before.complete && !force) {
      stdout.write(`${target.id}: already cached (${formatBytes(before.size_bytes)})\n`);
      continue;
    }

    stdout.write(`${target.id}: downloading…\n`);
    const started = Date.now();
    try {
      await runtime.pipeline(target.task, target.id);
    } catch (err) {
      failures += 1;
      stderr.write(`${target.id}: failed — ${err instanceof Error ? err.message : String(err)}\n`);
      continue;
    }
    const after = inspectModelCache(target.id, cacheDir);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    stdout.write(`${target.id}: ${formatBytes(after.size_bytes)} ready in ${seconds}s\n`);
  }

  return failures === 0 ? 0 : 1;
}

export async function main(argv: string[]): Promise<void> {
  const [command = 'status', ...rest] = argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'status':
      printStatus();
      return;
    case 'path':
      stdout.write(`${resolveModelCacheDir()}\n`);
      return;
    case 'install':
      process.exitCode = installModelStack();
      return;
    case 'download':
      process.exitCode = await downloadModels(rest.includes('--force'));
      return;
    default:
      stderr.write(`Unknown models command: ${command}\n\n`);
      printHelp();
      process.exitCode = 1;
  }
}
