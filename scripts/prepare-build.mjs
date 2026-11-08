import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCli = process.env.npm_execpath;

function npmCommand(args) {
  const command = npmCli ? process.execPath : isWindows ? 'npm.cmd' : 'npm';
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  return { command, commandArgs };
}

function run(args) {
  const { command, commandArgs } = npmCommand(args);

  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: process.env,
    shell: !npmCli && isWindows,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(args) {
  const { command, commandArgs } = npmCommand(args);
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf-8',
    env: process.env,
    shell: !npmCli && isWindows,
  });
  if (result.error || result.status !== 0) return undefined;
  return (result.stdout ?? '').trim();
}

// npm prepares git dependencies in a temporary clone under its cache. When
// installing globally, npm may run `prepare` there while dependencies live in
// the global prefix, so install them locally first. `--ignore-scripts` avoids
// triggering this prepare script recursively.
const isGitClone = /[\\/]_cacache[\\/]tmp[\\/]git-clone/.test(process.cwd());

const MODEL_RUNTIME = '@xenova/transformers';

function declaredModelRuntimeVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
    return (
      (pkg.optionalDependencies ?? {})[MODEL_RUNTIME] ??
      (pkg.dependencies ?? {})[MODEL_RUNTIME] ??
      '2.17.2'
    );
  } catch {
    return '2.17.2';
  }
}

/**
 * Why this exists: on Windows, reifying the optional ONNX stack can fail while
 * npm extracts protobufjs's bundled CLI tree (thousands of files). npm then
 * rolls the whole optional subtree back and the server silently loses
 * @xenova/transformers. With a copy already present at the target prefix npm
 * dedupes to it and never extracts that fragile tree.
 *
 * Skipped for `--omit=optional` (install without models) and MCP_SKIP_MODELS=1.
 * A failure here is not fatal: the build continues, semantic features stay off,
 * and `mcp-web-hound models install` repairs it later.
 */
function preinstallModelStack() {
  const omit = (process.env.npm_config_omit ?? '').split(',').map((value) => value.trim());
  if (process.env.MCP_SKIP_MODELS === '1' || omit.includes('optional')) {
    console.log('[prepare] Skipping the model stack (install without models)');
    return;
  }

  const globalRoot = capture(['root', '-g']);
  if (!globalRoot) {
    console.warn('[prepare] Could not locate the global prefix; skipping the model stack pre-install');
    return;
  }
  if (existsSync(join(globalRoot, MODEL_RUNTIME, 'package.json'))) {
    // npm also runs `prepare` during the resolution stage, where its output is not
    // shown. Without this line an install that pre-installed the stack in that first
    // pass looks like the pre-install never happened.
    console.log(`[prepare] Model stack already present in the install prefix (${globalRoot})`);
    return;
  }

  const spec = `${MODEL_RUNTIME}@${declaredModelRuntimeVersion()}`;
  console.log(`[prepare] Pre-installing the model stack (${spec}) into the install prefix`);

  const { command, commandArgs } = npmCommand(['install', '-g', spec, '--no-audit', '--no-fund']);
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: process.env,
    shell: !npmCli && isWindows,
  });

  if (result.error || result.status !== 0) {
    console.warn(
      '[prepare] Model stack pre-install failed; the server will run without semantic features. ' +
        'Install it later with "mcp-web-hound models install".',
    );
  }
}

if (isGitClone || process.env.npm_config_global === 'true') {
  preinstallModelStack();
}

if (!existsSync('node_modules/typescript')) {
  console.log('[prepare] TypeScript missing in the package tree; installing build dependencies');
  run([
    'install',
    '--global=false',
    '--ignore-scripts',
    '--no-save',
    '--include=dev',
    '--no-audit',
    '--no-fund',
  ]);
}

run(['run', 'build']);

// npm reifies the clone after `prepare`. Leaving this temporary node_modules in
// place makes npm try to replace its own dependency tree, which fails on
// Windows with EPERM/ENOTEMPTY. Remove it once the build output is ready.
if (isGitClone) {
  console.log('[prepare] Removing temporary build dependencies');
  rmSync('node_modules', {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
