import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, buildBootstrap, Config, TOOL_MAPPING } from '../lib/index.js';

function context() {
  const providers = [];
  const sections = [];
  return {
    providers,
    sections,
    ctx: {
      logger: { warn() {} },
      skills: { registerProvider(factory) { providers.push(factory({ signal: new AbortController().signal, invalidate() {} })); return () => {}; } },
      systemPrompt: { section(section) { sections.push(section); return () => {}; } },
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
    },
  };
}

test('bootstrap strips frontmatter, wraps the skill once, and includes DSH mapping', () => {
  const text = buildBootstrap();
  assert.match(text, /^<EXTREMELY_IMPORTANT>/);
  assert.match(text, /<SUBAGENT-STOP>/);
  assert.match(text, /NEVER call the skill tool for using-superpowers/);
  assert.doesNotMatch(text, /^---/m);
  assert.equal(text.split('## DeepSeek Harness tool mapping').length - 1, 1);
  assert.match(text, /skill\("brainstorming"\)/);
  assert.match(text, /never `skill\("superpowers:brainstorming"\)`/);
  assert.match(text, /create_worktree/);
  assert.ok(text.includes(TOOL_MAPPING));
});

test('bootstrap section is after persona and before current DSH tool guidance', () => {
  const fixture = context();
  apply(fixture.ctx);
  assert.equal(fixture.sections.length, 1);
  assert.equal(fixture.sections[0].name, 'superpowers:bootstrap');
  assert.equal(fixture.sections[0].order, 50);
  assert.ok(fixture.sections[0].order > 0 && fixture.sections[0].order < 1000);
});

test('bootstrap, tool mapping, and order configuration switches work', () => {
  const disabled = context();
  apply(disabled.ctx, { bootstrap: false });
  assert.equal(disabled.sections.length, 0);

  const noMapping = context();
  apply(noMapping.ctx, { toolMapping: false, order: 75 });
  assert.equal(noMapping.sections[0].order, 75);
  assert.doesNotMatch(noMapping.sections[0].text, /DeepSeek Harness tool mapping/);
});

test('desktop configuration schema exposes defaults and bilingual field help', () => {
  const parsed = Config({});
  assert.equal(parsed.skills.get(), true);
  assert.equal(parsed.bootstrap.get(), true);
  assert.equal(parsed.toolMapping.get(), true);
  assert.equal(parsed.order.get(), 50);
  assert.throws(() => Config({ skills: 'yes' }), /boolean/);
  const serialized = JSON.parse(JSON.stringify(Config));
  const root = serialized.refs[serialized.uid];
  assert.match(root.meta.description.en, /skill catalog/);
  assert.match(root.meta.description.zh, /技能目录/);
  for (const key of ['skills', 'bootstrap', 'toolMapping', 'order']) {
    const field = serialized.refs[root.dict[key]];
    assert.equal(typeof field.meta.description.en, 'string');
    assert.equal(typeof field.meta.description.zh, 'string');
  }
});
