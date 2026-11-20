import { lstat, mkdir, mkdtemp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function tempDirectoryBase({ tempDirectory = process.env.TMPDIR, home = homedir() } = {}) {
  return tempDirectory ? resolve(tempDirectory) : join(home, '.cache', 'meteroite');
}

export async function createTempDirectory(prefix, options = {}) {
  const base = tempDirectoryBase(options);
  await mkdir(base, { recursive: true, mode: 0o700 });

  if (!options.tempDirectory && !process.env.TMPDIR) {
    const details = await lstat(base);
    if (!details.isDirectory() || details.isSymbolicLink() || (process.getuid && details.uid !== process.getuid())) {
      throw new Error(`Default verification cache is not a user-owned directory: ${base}`);
    }
  }

  return mkdtemp(join(base, prefix));
}
