import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, createSkillProvider, DEFAULT_SKILLS_DIR, discoverSkills } from '../lib/index.js';
import { parseFrontmatter, validateSkillDocument } from '../lib/frontmatter.js';

test('frontmatter parser supports quoted, literal, and folded scalars', () => {
  const quoted = validateSkillDocument('---\nname: quoted\ndescription: "quoted: value"\n---\nBody.\n');
  assert.equal(quoted.data.description, 'quoted: value');

  const literal = parseFrontmatter('---\nname: literal\ndescription: |-\n  first line\n  second line\n---\nBody.\n');
  assert.equal(literal.data.description, 'first line\nsecond line');

  const folded = parseFrontmatter('---\nname: folded\ndescription: >-\n  first line\n  second line\n\n  next paragraph\n---\nBody.\n');
  assert.equal(folded.data.description, 'first line second line\n\nnext paragraph');
});

test('provider lists and lazily loads every vendored skill', async () => {
  const provider = createSkillProvider();
  const candidates = await provider.list();
  assert.equal(candidates.length, 15);
  assert.deepEqual(candidates.map((item) => item.name), [...candidates.map((item) => item.name)].sort());
  assert.equal(candidates.some((item) => Object.hasOwn(item, 'content')), false);
  const bootstrap = candidates.find((item) => item.name === 'using-superpowers');
  assert.deepEqual(bootstrap.invocation, { modelInvocable: false, userInvocable: true });
  for (const candidate of candidates) {
    const loaded = await provider.get(candidate);
    assert.equal(loaded.name, candidate.name);
    assert.ok(loaded.content.length > 0);
    assert.deepEqual(loaded.resourceBase, { kind: 'directory', path: join(DEFAULT_SKILLS_DIR, candidate.name) });
    assert.equal(loaded.content.startsWith('---'), false);
  }
});

test('apply registers a provider with DSH and respects the skills switch', () => {
  const providers = [];
  const sections = [];
  const ctx = {
    logger: { warn() {} },
    skills: { registerProvider(factory) { providers.push(factory({ signal: new AbortController().signal, invalidate() {} })); return () => {}; } },
    systemPrompt: { section(value) { sections.push(value); return () => {}; } },
    effect(fn) {
      const iterator = fn();
      const disposers = [];
      let step = iterator.next();
      while (!step.done) {
        if (typeof step.value === 'function') disposers.push(step.value);
        step = iterator.next();
      }
      return () => disposers.forEach((dispose) => dispose());
    },
    on() {},
  };
  apply(ctx, { bootstrap: false });
  assert.equal(providers.length, 1);
  assert.equal(providers[0].name, 'dsh-superpowers');
  apply(ctx, { skills: false, bootstrap: false });
  assert.equal(providers.length, 1);
  assert.equal(sections.length, 0);
});

test('invalid and duplicate skills are diagnosed without hiding valid skills', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-provider-'));
  const warnings = [];
  try {
    for (const name of ['valid', 'duplicate', 'broken']) await mkdir(join(root, name));
    await writeFile(join(root, 'valid', 'SKILL.md'), '---\nname: valid\ndescription: works\n---\nValid body.\n');
    await writeFile(join(root, 'duplicate', 'SKILL.md'), '---\nname: valid\ndescription: duplicate\n---\nDuplicate body.\n');
    await writeFile(join(root, 'broken', 'SKILL.md'), '---\nname: broken\n---\nBroken body.\n');
    const { candidates, diagnostics } = await discoverSkills(root);
    assert.deepEqual(candidates.map((item) => item.name), ['valid']);
    assert.equal(diagnostics.length, 2);
    assert.match(diagnostics.map((error) => error.message).join('\n'), /duplicate skill name/);
    assert.match(diagnostics.map((error) => error.message).join('\n'), /description/);
    const provider = createSkillProvider({ skillsDir: root, logger: { warn: (message) => warnings.push(message) } });
    assert.equal((await provider.list()).length, 1);
    assert.equal(warnings.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('missing files and cancellation are handled explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-missing-'));
  try {
    await assert.rejects(discoverSkills(join(root, 'absent')), /cannot read Superpowers skills directory/);
    const controller = new AbortController();
    controller.abort(new Error('cancelled by test'));
    await assert.rejects(discoverSkills(root, { signal: controller.signal }), /cancelled by test/);

    const directory = join(root, 'gone');
    await mkdir(directory);
    const file = join(directory, 'SKILL.md');
    await writeFile(file, '---\nname: gone\ndescription: temporary\n---\nBody.\n');
    const provider = createSkillProvider({ skillsDir: root, logger: { warn() {} } });
    const [candidate] = await provider.list();
    await rm(file);
    assert.equal(await provider.get(candidate), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provider lifecycle cancellation stops later discovery', async () => {
  const lifecycle = new AbortController();
  const provider = createSkillProvider({ lifecycleSignal: lifecycle.signal });
  lifecycle.abort(new Error('provider disposed by test'));
  await assert.rejects(provider.list(), /provider disposed by test/);
});
