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

// Global git installs run `prepare` from the cloned package, while npm installs
// dependencies into the global prefix. Install dev dependencies into the clone
// so `tsc` is available for the build. `--ignore-scripts` prevents recursion.
const installedForBuild = !existsSync('node_modules/typescript');

if (installedForBuild) {
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

// During a global git install npm runs prepare in a temporary clone and then
// packs that directory. Remove the temporary node_modules so they do not end
// up inside the installed package (and break its dependency install).
const isGlobalGitInstall =
  process.env.npm_config_global === 'true' ||
  /[\\/]_cacache[\\/]tmp[\\/]git-clone/.test(process.cwd());

if (installedForBuild && isGlobalGitInstall) {
  console.log('[prepare] Removing temporary build dependencies');
  rmSync('node_modules', { recursive: true, force: true });
}
