import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDirectoryBase } from './temp-root.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const nextConfig = await readFile(join(project, 'next.config.ts'), 'utf8');
assert.match(nextConfig, /sourcemaps:\s*\{\s*disable:\s*verificationMode/s, 'verification builds must disable Sentry source-map upload');
assert.match(nextConfig, /telemetry:\s*verificationMode\s*\?\s*false\s*:\s*undefined/, 'verification builds must disable Sentry plugin telemetry');
assert.match(nextConfig, /export default withSentryConfig\(nextConfig, sentryBuildOptions\)/, 'verification builds must preserve the Sentry-wrapped production config');
const verifier = await readFile(join(project, 'scripts/verify.mjs'), 'utf8');
assert.match(verifier, /\['build',\s*\[\]/, 'verification must run the ordinary production build without weaker flags');
const originalTmpdir = process.env.TMPDIR;
try {
  delete process.env.TMPDIR;
  assert.equal(tempDirectoryBase({ home: '/home/test-user' }), '/home/test-user/.cache/meteroite', 'default temporary verification files must use the home cache');
  process.env.TMPDIR = '/custom/tmp';
  assert.equal(tempDirectoryBase({ home: '/home/test-user' }), '/custom/tmp', 'explicit TMPDIR must remain an override');
} finally {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
}
const tempRoot = await mkdtemp(join(tmpdir(), 'meteroite-hook-tests-'));
const source = join(tempRoot, 'source');
const bare = join(tempRoot, 'remote.git');

try {
  await mkdir(source, { recursive: true });
  git(['init', '-b', 'main'], source);
  git(['config', 'user.name', 'Hook Test'], source);
  git(['config', 'user.email', 'hook-test@example.invalid'], source);
  git(['init', '--bare', bare], tempRoot);
  await mkdir(join(source, '.githooks'));
  await mkdir(join(source, 'scripts'));
  await mkdir(join(source, 'node_modules'));
  await writeFile(join(source, '.gitignore'), 'node_modules/\n.env.local\n.npmrc\n.sentryclirc\nsentry.properties\n');
  await writeFile(join(source, 'node_modules/placeholder'), 'installed dependency placeholder\n');
  await writeFile(join(source, '.githooks/pre-push'), await readFile(join(project, '.githooks/pre-push')));
  await chmod(join(source, '.githooks/pre-push'), 0o755);
  await writeFile(join(source, 'scripts/verify-push.mjs'), await readFile(join(project, 'scripts/verify-push.mjs')));
  await writeFile(join(source, 'scripts/verify.mjs'), await readFile(join(project, 'scripts/verify.mjs')));
  await writeFile(join(source, 'scripts/temp-root.mjs'), await readFile(join(project, 'scripts/temp-root.mjs')));
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: 'hook-fixture',
    private: true,
    scripts: {
      verify: 'node scripts/verify.mjs',
      lint: 'node scripts/check.mjs lint',
      typecheck: 'node scripts/check.mjs typecheck',
      'check:convex': 'node scripts/check.mjs check:convex',
      test: 'node scripts/check.mjs test',
      'check:models': 'node scripts/check.mjs check:models',
      build: 'node scripts/check.mjs build',
    },
  }, null, 2));
  await writeFile(join(source, 'package-lock.json'), JSON.stringify({ name: 'hook-fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'hook-fixture', version: '1.0.0' } } }, null, 2));
  await writeFile(join(source, 'scripts/check.mjs'), `
import { existsSync } from 'node:fs';
const check = process.argv[2];
console.log('[fixture] ' + check);
if (process.env.SENTRY_AUTH_TOKEN || process.env.LIVE_SECRET || process.env.GIT_INDEX_FILE || process.env.GIT_DIR) {
  throw new Error('verification child received an inherited secret or Git variable');
}
if (!process.env.TMPDIR) {
  throw new Error('verification child has no private temporary directory');
}
if (existsSync('.env.local') || existsSync('.npmrc') || existsSync('.sentryclirc') || existsSync('sentry.properties')) {
  throw new Error('verification copy contains a local env/config file');
}
if (check === 'build' && process.env.METEROITE_VERIFY_NO_UPLOAD !== '1') {
  throw new Error('build does not have explicit Sentry no-upload mode');
}
if (check === 'build' && process.env.NEXT_TELEMETRY_DISABLED !== '1') {
  throw new Error('build does not have Next.js telemetry disabled');
}
if (check === 'build' && process.argv.includes('--no-mangling')) {
  throw new Error('build must use ordinary production build settings');
}
if (check === 'test' && (await import('node:fs')).existsSync('FAIL_REQUIRED_CHECK')) process.exit(17);
if (check === 'test' && (await import('node:fs')).existsSync('SLOW_CHECK')) {
  console.log('[fixture] sleeping in required test');
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}
`);
  await writeFile(join(source, '.env.local'), 'SENTRY_AUTH_TOKEN=local-sentinel\nLIVE_SECRET=local-sentinel\n');
  await writeFile(join(source, '.npmrc'), '//registry.npmjs.org/:_authToken=local-sentinel\n');
  await writeFile(join(source, '.sentryclirc'), 'auth.token=local-sentinel\n');
  await writeFile(join(source, 'sentry.properties'), 'auth.token=local-sentinel\n');
  git(['config', 'core.hooksPath', '.githooks'], source);
  git(['remote', 'add', 'origin', bare], source);

  await writeFile(join(source, 'version.txt'), 'main\n');
  git(['add', '.'], source);
  git(['commit', '-m', 'main tip'], source);
  const mainTip = git(['rev-parse', 'HEAD'], source).trim();

  await mkdir(join(source, '.git/info'), { recursive: true });
  await writeFile(join(source, '.git/info/attributes'), 'version.txt filter=hostile\n');
  git(['config', 'filter.hostile.smudge', 'sed s/main/filtered/'], source);

  git(['switch', '-c', 'replacement-target'], source);
  await writeFile(join(source, 'version.txt'), 'replacement content\n');
  git(['commit', '-am', 'replacement object'], source);
  const replacementTip = git(['rev-parse', 'HEAD'], source).trim();
  git(['switch', 'main'], source);
  git(['update-ref', `refs/replace/${mainTip}`, replacementTip], source);

  git(['switch', '-c', 'non-head'], source);
  await writeFile(join(source, 'version.txt'), 'non-head\n');
  git(['commit', '-am', 'non-head tip'], source);
  const nonHeadTip = git(['rev-parse', 'HEAD'], source).trim();
  git(['tag', '-a', 'v-hook-test', '-m', 'annotated commit tag', nonHeadTip], source);
  git(['switch', 'main'], source);
  await writeFile(join(source, 'untouched-dirty-file'), 'preserve me\n');

  const hookTemp = join(tempRoot, 'hook-tmp');
  await mkdir(hookTemp);
  const inheritedEnv = {
    ...process.env,
    TMPDIR: hookTemp,
    GIT_INDEX_FILE: join(tempRoot, 'unrelated-index'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.quotePath',
    GIT_CONFIG_VALUE_0: 'false',
    SENTRY_AUTH_TOKEN: 'environment-sentinel',
    LIVE_SECRET: 'environment-sentinel',
  };
  const direct = spawnSync('node', [join(source, 'scripts/verify.mjs')], { cwd: source, encoding: 'utf8', env: inheritedEnv });
  if (direct.stdout) process.stdout.write(direct.stdout);
  if (direct.stderr) process.stderr.write(direct.stderr);
  assert.equal(direct.status, 0, direct.stderr || direct.stdout);
  const directInterrupted = await interruptDirectVerification(source, inheritedEnv, hookTemp);
  assert.notEqual(directInterrupted.status, 0, 'an interrupted direct verification must fail');
  assert.match(directInterrupted.output, /Interrupted by SIGTERM/);
  assert.equal((await (await import('node:fs/promises')).readdir(hookTemp)).some((name) => name.startsWith('meteroite-verify-')), false, 'interrupted direct verification must remove its temporary copy after stopping children');
  const push = run(['push', 'origin', 'main:main', 'non-head:refs/heads/non-head', 'refs/tags/v-hook-test'], source, inheritedEnv);
  assert.equal(push.status, 0, push.stderr || push.stdout);
  assert.match(push.stdout, new RegExp(mainTip));
  assert.match(push.stdout, new RegExp(nonHeadTip));
  assert.equal((push.stdout.match(/\[meteroite pre-push\] Verifying /g) ?? []).length, 2, 'duplicate tag target should be verified once');
  assert.match(push.stdout, /Raw commit tree blobs match the isolated snapshot/);
  for (const name of ['lint', 'typecheck', 'check:convex', 'test', 'check:models', 'build']) {
    assert.match(push.stdout, new RegExp(`\\[fixture\\] ${name.replace(':', ':')}`));
  }
  assert.equal(await readFile(join(source, 'untouched-dirty-file'), 'utf8'), 'preserve me\n');
  assert.equal(git(['status', '--porcelain'], source).includes('?? untouched-dirty-file'), true, 'dirty checkout should remain dirty and intact');

  const blob = git(['hash-object', '-w', '--stdin'], source, 'tagged blob\n').trim();
  const tree = git(['rev-parse', `${mainTip}^{tree}`], source).trim();
  git(['update-ref', 'refs/tags/blob-tag', blob], source);
  git(['update-ref', 'refs/tags/tree-tag', tree], source);
  const nonCommitTags = run(['push', 'origin', 'refs/tags/blob-tag', 'refs/tags/tree-tag'], source, inheritedEnv);
  assert.equal(nonCommitTags.status, 0, nonCommitTags.stderr || nonCommitTags.stdout);
  assert.match(nonCommitTags.stdout, /valid blob object, no commit tip to verify/);
  assert.match(nonCommitTags.stdout, /valid tree object, no commit tip to verify/);

  const invalidObject = spawnSync('node', [join(source, 'scripts/verify-push.mjs')], {
    cwd: source,
    input: `refs/heads/missing ${'f'.repeat(40)} refs/heads/missing ${'0'.repeat(40)}\n`,
    encoding: 'utf8',
    env: inheritedEnv,
  });
  assert.notEqual(invalidObject.status, 0, 'an unavailable object must fail');
  assert.match(invalidObject.stderr, /available Git object/);

  git(['switch', '-c', 'missing-verifier'], source);
  await rm(join(source, 'scripts/verify.mjs'));
  git(['add', '-A'], source);
  git(['commit', '-m', 'commit without verification setup'], source);
  const missingSetupPush = run(['push', 'origin', 'HEAD:refs/heads/missing-verifier'], source);
  assert.notEqual(missingSetupPush.status, 0, 'a commit without verification setup must be rejected');
  assert.match(missingSetupPush.stdout + missingSetupPush.stderr, /missing verification setup.*Install\/commit the Meteroite verifier/);

  git(['switch', 'main'], source);
  git(['switch', '-c', 'credential-config'], source);
  git(['add', '-f', '.npmrc'], source);
  git(['commit', '-m', 'credential-bearing npm config'], source);
  const credentialConfigPush = run(['push', 'origin', 'HEAD:refs/heads/credential-config'], source);
  assert.notEqual(credentialConfigPush.status, 0, 'credential-bearing npm config must be rejected before install');
  assert.match(credentialConfigPush.stdout + credentialConfigPush.stderr, /credential-bearing \.npmrc settings/);

  git(['switch', 'main'], source);
  git(['switch', '-c', 'failing-tip'], source);
  await writeFile(join(source, 'version.txt'), 'failing\n');
  await writeFile(join(source, 'FAIL_REQUIRED_CHECK'), 'test must fail\n');
  git(['add', '.'], source);
  git(['commit', '-m', 'failing required check'], source);
  const failingPush = run(['push', 'origin', 'HEAD:refs/heads/failing'], source);
  assert.notEqual(failingPush.status, 0, 'a failed required check must reject the actual git push');
  assert.match(failingPush.stdout + failingPush.stderr, /npm run verify failed|Push rejected/);
  const failedRemoteRef = spawnSync('git', ['--git-dir', bare, 'show-ref', '--verify', 'refs/heads/failing'], { encoding: 'utf8' });
  assert.notEqual(failedRemoteRef.status, 0, 'failed push must not update remote ref');

  git(['branch', 'obsolete', 'main'], source);
  const createObsolete = run(['push', 'origin', 'obsolete:refs/heads/obsolete'], source);
  assert.equal(createObsolete.status, 0, createObsolete.stderr || createObsolete.stdout);
  const deletion = run(['push', 'origin', ':refs/heads/obsolete'], source);
  assert.equal(deletion.status, 0, deletion.stderr || deletion.stdout);
  assert.match(deletion.stdout, /deletion, no new commit to verify/);

  git(['switch', 'main'], source);
  git(['switch', '-c', 'interrupted-tip'], source);
  await writeFile(join(source, 'SLOW_CHECK'), 'block the required test\n');
  git(['add', 'SLOW_CHECK'], source);
  git(['commit', '-m', 'slow required check'], source);
  const interrupted = await interruptPush(source, inheritedEnv, hookTemp);
  assert.notEqual(interrupted.status, 0, 'an interrupted required check must reject the push');
  assert.match(interrupted.output, /Interrupted by SIGTERM/);
  assert.equal(spawnSync('git', ['--git-dir', bare, 'show-ref', '--verify', 'refs/heads/interrupted'], { encoding: 'utf8' }).status, 128);
  assert.equal((await (await import('node:fs/promises')).readdir(hookTemp)).some((name) => name.startsWith('meteroite-pre-push-')), false, 'interrupted verification must remove its temporary root');
  assert.equal(git(['worktree', 'list', '--porcelain'], source).includes('meteroite-pre-push-'), false, 'interrupted verification must unregister its worktree');

  console.log('[test:hooks] Passed bare-remote checks for commit/blob/tree tips, replacement refs, raw blob bytes, hostile smudge filters, invalid objects, required-check refusal, environment isolation, dirty checkout preservation, deletion handling, and direct/push signal cleanup.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function git(args, cwd, input) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function run(args, cwd, env = process.env) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

async function interruptPush(cwd, env, hookTemp) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['push', 'origin', 'HEAD:refs/heads/interrupted'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let signaled = false;
    const collect = (chunk) => {
      output += chunk.toString();
      if (signaled || !output.includes('[fixture] sleeping in required test')) return;
      signaled = true;
      const processTable = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).stdout;
      const verifier = processTable.split('\n').find((line) => line.includes('node ') && line.includes('/scripts/verify-push.mjs'));
      if (!verifier) return reject(new Error('Could not locate active push verifier to reproduce SIGTERM cleanup'));
      const pid = Number(verifier.trim().split(/\s+/, 1)[0]);
      process.kill(pid, 'SIGTERM');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (!signaled) return reject(new Error(`Push did not reach the blocking required check. Output: ${output}`));
      resolvePromise({ status: code ?? 128, signal, output });
    });
    const timeout = setTimeout(() => {
      if (!signaled) child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for required check. Hook temp: ${hookTemp}. Output: ${output}`));
    }, 60_000);
    child.once('close', () => clearTimeout(timeout));
  });
}

async function interruptDirectVerification(cwd, env, hookTemp) {
  await writeFile(join(cwd, 'SLOW_CHECK'), 'block the required test\n');
  const child = spawn('node', [join(cwd, 'scripts/verify.mjs')], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let signaled = false;
  return new Promise((resolvePromise, reject) => {
    const collect = (chunk) => {
      output += chunk.toString();
      if (signaled || !output.includes('[fixture] sleeping in required test')) return;
      signaled = true;
      process.kill(child.pid, 'SIGTERM');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (!signaled) return reject(new Error(`Direct verification did not reach the blocking required check. Output: ${output}`));
      resolvePromise({ status: code ?? 128, signal, output });
    });
    const timeout = setTimeout(() => {
      if (!signaled) child.kill('SIGKILL');
      reject(new Error(`Timed out waiting for direct verification. Hook temp: ${hookTemp}. Output: ${output}`));
    }, 60_000);
    child.once('close', () => clearTimeout(timeout));
  });
}
