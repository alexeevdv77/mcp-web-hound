import { existsSync } from 'node:fs';
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

// Global git installs run `prepare` from the cloned package, while npm installs
// dependencies into the global prefix. Install dev dependencies into the clone
// so `tsc` is available for the build. `--ignore-scripts` prevents recursion.
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
