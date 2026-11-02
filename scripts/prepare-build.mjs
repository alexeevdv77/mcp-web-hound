import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npmCli = process.env.npm_execpath;

function run(args) {
  const command = npmCli ? process.execPath : isWindows ? 'npm.cmd' : 'npm';
  const commandArgs = npmCli ? [npmCli, ...args] : args;

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

// npm prepares git dependencies in a temporary clone under its cache. When
// installing globally, npm may run `prepare` there while dependencies live in
// the global prefix, so install them locally first. `--ignore-scripts` avoids
// triggering this prepare script recursively.
const isGitClone = /[\\/]_cacache[\\/]tmp[\\/]git-clone/.test(process.cwd());

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
