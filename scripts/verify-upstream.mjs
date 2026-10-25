#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFileManifest, hashFile, HASH_ALGORITHM } from './upstream-utils.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lockPath = join(root, 'upstream-lock.json');

export async function verifyUpstream(projectRoot = root) {
  let lock;
  try {
    lock = JSON.parse(await readFile(join(projectRoot, 'upstream-lock.json'), 'utf8'));
  } catch (error) {
    throw new Error(`cannot read upstream-lock.json: ${error.message}`, { cause: error });
  }
  if (lock.schemaVersion !== 1 || lock.algorithm !== HASH_ALGORITHM) {
    throw new Error(`unsupported upstream lock schema or hash algorithm in ${lockPath}`);
  }
  if (!/^[0-9a-f]{40}$/.test(lock.upstream?.commit ?? '')) throw new Error('upstream lock requires a full 40-character commit SHA');
  if (lock.upstream?.repository !== 'https://github.com/obra/superpowers') throw new Error('unexpected upstream repository');
  if (!Array.isArray(lock.allowedDifferences)) throw new Error('allowedDifferences must be an explicit array');

  // Hash the two independently stored payload roots without copying them.
  const actual = {};
  const skills = await buildFileManifest(join(projectRoot, 'skills'));
  for (const [path, hash] of Object.entries(skills)) actual[`skills/${path}`] = hash;
  actual['LICENSE.superpowers'] = await hashFile(join(projectRoot, 'LICENSE.superpowers'));

  const expectedKeys = Object.keys(lock.files).sort();
  const actualKeys = Object.keys(actual).sort();
  const missing = expectedKeys.filter((path) => !Object.hasOwn(actual, path));
  const unexpected = actualKeys.filter((path) => !Object.hasOwn(lock.files, path));
  const changed = expectedKeys.filter((path) => Object.hasOwn(actual, path) && actual[path] !== lock.files[path]);
  if (missing.length || unexpected.length || changed.length) {
    const lines = [
      ...missing.map((path) => `missing: ${path}`),
      ...unexpected.map((path) => `unexpected: ${path}`),
      ...changed.map((path) => `changed: ${path}`),
    ];
    throw new Error(`vendored Superpowers payload does not match upstream-lock.json:\n${lines.join('\n')}`);
  }
  return { lock, fileCount: actualKeys.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyUpstream().then(({ lock, fileCount }) => {
    console.log(`Verified ${fileCount} vendored files from ${lock.upstream.tag ?? lock.upstream.ref} (${lock.upstream.commit}).`);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
