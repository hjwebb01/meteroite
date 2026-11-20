import { spawnSync } from 'node:child_process';

const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error('Cannot install Meteroite hooks: run this command inside a Git checkout.');
  process.exit(1);
}

const repo = result.stdout.trim();
const config = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repo, stdio: 'inherit' });
if (config.status !== 0) process.exit(config.status ?? 1);

const active = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo, encoding: 'utf8' });
if (active.status !== 0 || active.stdout.trim() !== '.githooks') {
  console.error(`Hook installation failed: expected core.hooksPath=.githooks, got ${active.stdout.trim() || '(unset)'}.`);
  process.exit(1);
}
console.log(`Meteroite hooks installed: ${active.stdout.trim()}`);
