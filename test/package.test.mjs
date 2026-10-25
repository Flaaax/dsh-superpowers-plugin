import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { verifyUpstream } from '../scripts/verify-upstream.mjs';
import { walkFiles, portablePath } from '../scripts/upstream-utils.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const onWindows = process.platform === 'win32';

function command(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    shell: options.shell ?? (onWindows && command === 'npm'),
  });
  assert.equal(result.status, 0, `${command} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('manifest, ESM entry, and bundle patch are valid', async () => {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './lib/index.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const plugin = await import(`${pathToFileURL(join(root, pkg.main)).href}?test=${Date.now()}`);
  assert.equal(plugin.name, 'dsh-superpowers');
  assert.equal(typeof plugin.apply, 'function');

  const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8');
  assert.deepEqual([...patch.matchAll(/^\s+- id:\s*(.+)$/gm)].map((match) => match[1]), ['dsh-superpowers']);
  assert.match(patch, /^\s+name: dsh-superpowers-plugin$/m);
});

test('vendored payload matches the pinned upstream lock', async () => {
  const { lock, fileCount } = await verifyUpstream(root);
  assert.match(lock.upstream.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(lock.upstream.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(lock.allowedDifferences, []);
  assert.equal(fileCount, 85);
});

test('npm dry-run contains every runtime, skill, reference, script, and license file', async () => {
  const output = command('npm', ['pack', '--json', '--dry-run']);
  const report = JSON.parse(output)[0];
  const packed = new Set(report.files.map((entry) => entry.path));
  const expected = [
    'package.json', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md', 'NOTICE.md',
    'LICENSE', 'LICENSE.superpowers', 'upstream-lock.json',
    ...(await walkFiles(join(root, 'lib'))).map((file) => portablePath(root, file)),
    ...(await walkFiles(join(root, 'skills'))).map((file) => portablePath(root, file)),
    ...(await walkFiles(join(root, 'scripts'))).map((file) => portablePath(root, file)),
  ];
  for (const file of expected) assert.ok(packed.has(file), `npm package is missing ${file}`);
  for (const file of packed) {
    assert.doesNotMatch(file, /^(?:\.git|test|node_modules|\.sync-)(?:\/|$)/, `unexpected package file ${file}`);
  }
});

test('actual tarball unpacks and imports independently', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-superpowers-pack-'));
  try {
    const output = command('npm', ['pack', '--json', '--pack-destination', temporary]);
    const report = JSON.parse(output)[0];
    const tarball = join(temporary, report.filename);
    command('tar', ['-xf', tarball, '-C', temporary], { shell: false });
    const extracted = join(temporary, 'package');
    const plugin = await import(`${pathToFileURL(join(extracted, 'lib', 'index.js')).href}?packed=${Date.now()}`);
    assert.equal(plugin.name, 'dsh-superpowers');
    assert.equal((await plugin.createSkillProvider().list()).length, 15);
    assert.ok((await readdir(join(extracted, 'skills'))).includes('using-superpowers'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
