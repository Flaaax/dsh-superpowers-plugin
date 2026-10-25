import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const REPOSITORY = 'https://github.com/obra/superpowers.git';
export const HASH_ALGORITHM = 'sha256';

export async function walkFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) output.push(absolute);
    }
  }
  await visit(root);
  return output;
}

export function portablePath(root, file) {
  return relative(root, file).split(sep).join('/');
}

export async function hashFile(file) {
  return createHash(HASH_ALGORITHM).update(await readFile(file)).digest('hex');
}

export async function buildFileManifest(payloadRoot) {
  const files = {};
  for (const file of await walkFiles(payloadRoot)) files[portablePath(payloadRoot, file)] = await hashFile(file);
  return files;
}
