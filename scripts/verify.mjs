import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTempDirectory } from './temp-root.mjs';
import { createInterrupts, onceClose, terminate, throwIfInterrupted } from './interrupts.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await createTempDirectory('meteroite-verify-');
const snapshotCommit = process.env.METEROITE_VERIFICATION_SNAPSHOT;
const checkout = snapshotCommit ? source : join(tempRoot, 'checkout');
const interrupt = createInterrupts();
const checkInterrupted = () => throwIfInterrupted(interrupt);

try {
  if (snapshotCommit) {
    checkInterrupted();
    assertCleanSnapshot(snapshotCommit);
    const entries = await readdir(source);
    const localSecrets = entries.filter((name) => /^\.env(?:\.|$)/.test(name) || name === '.sentryclirc' || name === 'sentry.properties');
    if (localSecrets.length) throw new Error(`Snapshot contains local secret configuration (${localSecrets.join(', ')}); verification stopped.`);
  } else {
    checkInterrupted();
    await cp(source, checkout, {
      recursive: true,
      filter: (path) => {
        const relative = path.slice(source.length).replace(/^\//, '');
        if (!relative) return true;
        const parts = relative.split('/');
        return !parts.some((part) => part === '.git' || part === '.next' || part === 'node_modules' || part === '.agents' || part === '.npmrc' || part === '.sentryclirc' || part === 'sentry.properties' || /^\.env(?:\.|$)/.test(part));
      },
    });
    checkInterrupted();
    try {
      await cp(join(source, 'node_modules'), join(checkout, 'node_modules'), { recursive: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await mkdir(join(checkout, 'node_modules'), { recursive: true });
    }
  }

  for (const [script, args = [], buildEnv = {}] of checks()) {
    checkInterrupted();
    console.log(`\n[verify] npm run ${script}${args.length ? ` -- ${args.join(' ')}` : ''}`);
    await run('npm', ['run', script, ...(args.length ? ['--', ...args] : [])], checkout, { ...safeEnvironment(tempRoot), ...buildEnv });
  }

  console.log('\n[verify] All six required checks passed.');
} catch (error) {
  if (interrupt.by) {
    process.exitCode = 128 + (interrupt.by === 'SIGINT' ? 2 : 15);
    console.error(`[verify] Interrupted by ${interrupt.by}; temporary verification copy will be removed.`);
  } else {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} finally {
  interrupt.dispose();
  if (interrupt.child) {
    terminate(interrupt.child, interrupt.by ?? 'SIGTERM');
    await onceClose(interrupt.child);
  }
  await rm(tempRoot, { recursive: true, force: true });
}

function assertCleanSnapshot(expectedCommit) {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  };
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', env });
  if (head.status !== 0 || head.stdout.trim() !== expectedCommit) {
    throw new Error('Push snapshot identity changed before verification.');
  }
  const status = spawnSync('git', ['status', '--porcelain=v1'], { cwd: source, encoding: 'utf8', env });
  if (status.status !== 0 || status.stdout.trim()) {
    throw new Error('Push snapshot is not clean before verification.');
  }
}

function checks() {
  return [
    ['lint', []],
    ['typecheck', []],
    ['check:convex', []],
    ['test', []],
    ['check:models', []],
    ['build', [], {
      METEROITE_VERIFY_NO_UPLOAD: '1',
      NEXT_PUBLIC_CONVEX_URL: 'https://example.convex.cloud',
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk',
    }],
  ];
}

function safeEnvironment(tempRoot) {
  const names = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
  env.HOME = tempRoot;
  env.TMPDIR = process.env.TMPDIR || tempRoot;
  env.CI = '1';
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.npm_config_cache = join(tempRoot, 'npm-cache');
  env.npm_config_userconfig = '/dev/null';
  return env;
}

function run(command, args, cwd, env) {
  console.log(`[verify] ${command} ${args.join(' ')} (${cwd})`);
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  interrupt.child = child;
  return new Promise((resolvePromise, reject) => {
    child.once('error', (error) => reject(new Error(`[verify] Could not start ${command}: ${error.message}`)));
    child.once('close', (code, signal) => {
      interrupt.child = undefined;
      if (interrupt.by) return reject(new Error(`Interrupted by ${interrupt.by}`));
      if (code !== 0) return reject(new Error(`[verify] npm run ${args[1]} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`));
      resolvePromise();
    });
    if (interrupt.by) terminate(child, interrupt.by);
  });
}
