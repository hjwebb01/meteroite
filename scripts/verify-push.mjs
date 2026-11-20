import { mkdir, readFile, readdir, rm, stat, readlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTempDirectory } from './temp-root.mjs';

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', env: gitEnvironment() });
if (rootResult.status !== 0) {
  throw new Error(`Cannot locate the Meteroite Git checkout: ${rootResult.stderr.trim()}`);
}
const repo = rootResult.stdout.trim();
const updates = (await readStdin()).trim().split('\n').filter(Boolean).map((line) => {
  const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
  if (!localRef || !localSha || !remoteRef || !remoteSha) {
    throw new Error(`Malformed pre-push ref update: ${line}`);
  }
  return { localRef, localSha, remoteRef, remoteSha };
});
if (!updates.length) process.exit(0);

let interruptedBy;
let activeChild;
let tempRoot;
let snapshotGitDir;
const worktrees = new Set();
const onSignal = (signal) => {
  interruptedBy ??= signal;
  if (activeChild) terminate(activeChild, signal);
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

try {
  checkInterrupted();
  const commits = new Map();
  for (const update of updates) {
    if (/^0+$/.test(update.localSha)) {
      console.log(`[meteroite pre-push] ${update.localRef} -> ${update.remoteRef}: deletion, no new commit to verify.`);
      continue;
    }

    checkInterrupted();
    const objectType = git(['cat-file', '-t', update.localSha], repo, false);
    if (objectType === null) {
      throw new Error(`Cannot resolve pushed ref ${update.localRef} (${update.localSha}) to an available Git object.`);
    }
    const commitResult = gitResult(['rev-parse', '--verify', `${update.localSha}^{commit}`], repo);
    if (commitResult.status === 0) {
      const commit = commitResult.stdout.trim();
      if (!commits.has(commit)) commits.set(commit, []);
      commits.get(commit).push(update);
      continue;
    }

    const peeledResult = gitResult(['rev-parse', '--verify', `${update.localSha}^{}`], repo);
    if (peeledResult.status !== 0) {
      throw new Error(`Cannot peel pushed ref ${update.localRef} (${update.localSha}) to a valid Git object: ${peeledResult.stderr.trim()}`);
    }
    const peeledType = git(['cat-file', '-t', peeledResult.stdout.trim()], repo, false);
    if (peeledType === 'blob' || peeledType === 'tree') {
      console.log(`[meteroite pre-push] ${update.localRef} -> ${update.remoteRef}: valid ${peeledType} object, no commit tip to verify.`);
      continue;
    }
    throw new Error(`Cannot resolve pushed ref ${update.localRef} (${update.localSha}) to a commit: ${commitResult.stderr.trim()}`);
  }

  if (commits.size === 0) {
    console.log('[meteroite pre-push] No commit-bearing ref updates to verify.');
  } else {
    tempRoot = await createTempDirectory('meteroite-pre-push-');
    for (const [commit, refs] of commits) {
      if (interruptedBy) throw new Error(`Interrupted by ${interruptedBy}`);
      const label = refs.map(({ localRef }) => localRef).join(', ');
      console.log(`\n[meteroite pre-push] Verifying ${commit} (${label}) in an isolated snapshot.`);
      const checkout = join(tempRoot, commit);
      if (!snapshotGitDir) snapshotGitDir = await createSnapshotGitDir(tempRoot);
      checkInterrupted();
      git(['worktree', 'add', '--detach', checkout, commit], snapshotGitDir);
      worktrees.add(checkout);

      try {
        checkInterrupted();
        await assertSnapshotBlobBytes(commit, checkout, snapshotGitDir);
        const packageJson = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'));
        const missing = ['verify', 'lint', 'typecheck', 'check:convex', 'test', 'check:models', 'build']
          .filter((name) => typeof packageJson.scripts?.[name] !== 'string');
        try {
          await readFile(join(checkout, 'scripts/verify.mjs'));
        } catch {
          missing.push('scripts/verify.mjs');
        }
        if (missing.length) {
          throw new Error(`Pushed commit ${commit} is missing verification setup (${missing.join(', ')}). Install/commit the Meteroite verifier before pushing this commit.`);
        }

        const rootEntries = await readdir(checkout);
        const localSecrets = rootEntries.filter((name) => /^\.env(?:\.|$)/.test(name) || name === '.sentryclirc' || name === 'sentry.properties');
        if (localSecrets.length) {
          throw new Error(`Pushed commit ${commit} contains local secret configuration (${localSecrets.join(', ')}); verification stopped.`);
        }
        try {
          const npmrc = await readFile(join(checkout, '.npmrc'), 'utf8');
          if (/^\s*(?:[^=\s]+:)?(?:_authToken|_auth|_password|username)\s*=/im.test(npmrc)) {
            throw new Error(`Pushed commit ${commit} has credential-bearing .npmrc settings; verification stopped.`);
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }

        await run('npm', ['ci'], checkout, safeEnvironment(tempRoot));
        checkInterrupted();
        await run('npm', ['run', 'verify'], checkout, safeEnvironment(tempRoot, commit));
      } finally {
        git(['worktree', 'remove', '--force', checkout], snapshotGitDir);
        worktrees.delete(checkout);
      }
    }
    console.log('\n[meteroite pre-push] Every distinct commit-bearing tip passed full verification.');
  }
} catch (error) {
  if (interruptedBy) {
    process.exitCode = 128 + (interruptedBy === 'SIGINT' ? 2 : 15);
    console.error(`[meteroite pre-push] Interrupted by ${interruptedBy}; stopping child and cleaning temporary worktrees.`);
  } else {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} finally {
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  if (activeChild) {
    terminate(activeChild, interruptedBy ?? 'SIGTERM');
    await onceClose(activeChild);
  }
  for (const checkout of worktrees) {
    const result = gitResult(['worktree', 'remove', '--force', checkout], snapshotGitDir);
    if (result.status !== 0) console.error(`[meteroite pre-push] Could not remove temporary worktree ${checkout}: ${result.stderr.trim()}`);
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

function git(args, cwd = repo, fail = true) {
  const result = gitResult(args, cwd);
  if (result.status !== 0) {
    if (!fail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function gitResult(args, cwd = repo) {
  const env = gitEnvironment();
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  if (cwd !== repo) args = [`--git-dir=${cwd}`, ...args];
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
}

function gitEnvironment() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
}

function safeEnvironment(tempRoot, verificationCommit) {
  const names = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  env.HOME = tempRoot;
  env.CI = '1';
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.METEROITE_VERIFY_NO_UPLOAD = '1';
  env.npm_config_cache = join(tempRoot, 'npm-cache');
  env.npm_config_userconfig = '/dev/null';
  if (verificationCommit) env.METEROITE_VERIFICATION_SNAPSHOT = verificationCommit;
  return env;
}

function run(command, args, cwd, env) {
  console.log(`[meteroite pre-push] ${command} ${args.join(' ')} (${cwd})`);
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  activeChild = child;
  return new Promise((resolvePromise, reject) => {
    child.once('error', (error) => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.once('close', (code, signal) => {
      activeChild = undefined;
      if (interruptedBy) return reject(new Error(`Interrupted by ${interruptedBy}`));
      if (code !== 0) return reject(new Error(`${command} ${args.join(' ')} failed${signal ? ` (${signal})` : ` with exit code ${code}`}. Push rejected.`));
      resolvePromise();
    });
    if (interruptedBy) terminate(child, interruptedBy);
  });
}

function checkInterrupted() {
  if (interruptedBy) throw new Error(`Interrupted by ${interruptedBy}`);
}

async function createSnapshotGitDir(tempRoot) {
  const gitDir = join(tempRoot, 'snapshot.git');
  const sourceObjects = git(['rev-parse', '--path-format=absolute', '--git-path', 'objects'], repo);
  git(['init', '--bare', gitDir], repo);
  await mkdir(join(gitDir, 'objects/info'), { recursive: true });
  await writeFile(join(gitDir, 'objects/info/alternates'), `${sourceObjects}\n`);
  git(['config', 'core.bare', 'false'], gitDir);
  git(['config', 'core.autocrlf', 'false'], gitDir);
  git(['config', 'core.attributesFile', '/dev/null'], gitDir);
  checkInterrupted();
  return gitDir;
}

async function assertSnapshotBlobBytes(commit, checkout, gitDir) {
  const listing = gitResult(['ls-tree', '-rz', '--full-tree', '-r', commit], gitDir);
  if (listing.status !== 0) throw new Error(`Cannot inspect raw tree for ${commit}: ${listing.stderr.trim()}`);
  for (const record of listing.stdout.split('\0').filter(Boolean)) {
    checkInterrupted();
    const tab = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (type !== 'blob') continue;
    const raw = spawnSync('git', ['--git-dir=' + gitDir, 'cat-file', 'blob', object], {
      cwd: repo, env: gitEnvironment(), maxBuffer: 1024 * 1024 * 1024,
    });
    if (raw.status !== 0) throw new Error(`Cannot read raw blob ${object} for ${path}: ${raw.stderr.toString().trim()}`);
    const file = join(checkout, path);
    if (mode === '120000') {
      const target = await readlink(file);
      if (!Buffer.from(target).equals(raw.stdout)) throw new Error(`Snapshot symlink differs from raw blob ${object}: ${path}`);
    } else {
      const info = await stat(file);
      if (!info.isFile() || !(await readFile(file)).equals(raw.stdout)) {
        throw new Error(`Snapshot file differs from raw blob ${object}: ${path}`);
      }
    }
  }
  console.log('[meteroite pre-push] Raw commit tree blobs match the isolated snapshot byte-for-byte.');
}

function terminate(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
  const escalation = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {}
  }, 1500);
  escalation.unref();
}

function onceClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => child.once('close', resolvePromise));
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}
