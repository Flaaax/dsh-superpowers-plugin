#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFileManifest, REPOSITORY } from './upstream-utils.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: options.shell ?? false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return result.stdout?.trim();
}

function parseRef(argv) {
  const index = argv.indexOf('--ref');
  if (index < 0 || !argv[index + 1] || argv.length !== 2) {
    throw new Error('usage: node scripts/sync-upstream.mjs --ref <stable-tag-or-full-commit>');
  }
  const ref = argv[index + 1];
  if (/^(main|master|dev|head)$/i.test(ref)) throw new Error('a floating branch is not allowed; pass an explicit stable tag or full commit SHA');
  if (!/^v\d+\.\d+\.\d+$/.test(ref) && !/^[0-9a-f]{40}$/i.test(ref)) {
    throw new Error('ref must be a stable vX.Y.Z tag or a full 40-character commit SHA');
  }
  return ref;
}

async function existingLock() {
  try { return JSON.parse(await readFile(join(root, 'upstream-lock.json'), 'utf8')); }
  catch { return { files: {} }; }
}

function describeChanges(before, after) {
  const oldFiles = before.files ?? {};
  const added = Object.keys(after).filter((path) => !Object.hasOwn(oldFiles, path));
  const removed = Object.keys(oldFiles).filter((path) => !Object.hasOwn(after, path));
  const changed = Object.keys(after).filter((path) => Object.hasOwn(oldFiles, path) && after[path] !== oldFiles[path]);
  return { added, removed, changed };
}

async function swapPayload(stage, backup) {
  const targets = ['skills', 'LICENSE.superpowers', 'upstream-lock.json'];
  const moved = [];
  const installed = [];
  try {
    await mkdir(backup);
    for (const target of targets) {
      try {
        await rename(join(root, target), join(backup, target));
        moved.push(target);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await rename(join(stage, target), join(root, target));
      installed.push(target);
    }
  } catch (error) {
    for (const target of [...installed].reverse()) {
      await rm(join(root, target), { recursive: true, force: true });
    }
    for (const target of [...moved].reverse()) await rename(join(backup, target), join(root, target));
    throw error;
  }
  return async () => {
    for (const target of targets) {
      await rm(join(root, target), { recursive: true, force: true });
      if (moved.includes(target)) await rename(join(backup, target), join(root, target));
    }
  };
}

export async function sync(ref) {
  const checkoutRoot = await mkdtemp(join(tmpdir(), 'dsh-superpowers-upstream-'));
  const transactionRoot = await mkdtemp(join(root, '.sync-'));
  const checkout = join(checkoutRoot, 'repository');
  const stage = join(transactionRoot, 'stage');
  const backup = join(transactionRoot, 'backup');
  try {
    await mkdir(checkout);
    run('git', ['init', '--quiet'], { cwd: checkout });
    run('git', ['remote', 'add', 'origin', REPOSITORY], { cwd: checkout });
    run('git', ['fetch', '--quiet', '--depth', '1', 'origin', ref], { cwd: checkout });
    run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: checkout });
    const commit = run('git', ['rev-parse', 'HEAD'], { cwd: checkout, capture: true });
    if (/^[0-9a-f]{40}$/i.test(ref) && commit.toLowerCase() !== ref.toLowerCase()) {
      throw new Error(`resolved commit ${commit} does not match requested commit ${ref}`);
    }
    await mkdir(stage);
    await cp(join(checkout, 'skills'), join(stage, 'skills'), { recursive: true, force: true });
    await cp(join(checkout, 'LICENSE'), join(stage, 'LICENSE.superpowers'));
    const files = {};
    for (const [path, hash] of Object.entries(await buildFileManifest(join(stage, 'skills')))) files[`skills/${path}`] = hash;
    files['LICENSE.superpowers'] = (await buildFileManifest(stage))['LICENSE.superpowers'];
    const lock = {
      schemaVersion: 1,
      upstream: {
        repository: 'https://github.com/obra/superpowers',
        ref,
        ...(ref.startsWith('v') ? { tag: ref } : {}),
        commit,
        syncedAt: new Date().toISOString(),
      },
      algorithm: 'sha256',
      files,
      allowedDifferences: [],
    };
    await writeFile(join(stage, 'upstream-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
    const changes = describeChanges(await existingLock(), files);
    const rollback = await swapPayload(stage, backup);
    try {
      run(process.execPath, ['scripts/verify-upstream.mjs'], { cwd: root });
      run('npm', ['test'], { cwd: root, shell: process.platform === 'win32' });
    } catch (error) {
      await rollback();
      throw new Error(`validation failed; previous payload restored: ${error.message}`, { cause: error });
    }
    console.log(`Synced ${ref} at ${commit}.`);
    for (const key of ['added', 'removed', 'changed']) console.log(`${key}: ${changes[key].length ? changes[key].join(', ') : '(none)'}`);
  } finally {
    await rm(checkoutRoot, { recursive: true, force: true });
    await rm(transactionRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let ref;
  try { ref = parseRef(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(2); }
  sync(ref).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
