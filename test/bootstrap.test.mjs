import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, buildBootstrap, TOOL_MAPPING } from '../lib/index.js';

function context() {
  const providers = [];
  const sections = [];
  return {
    providers,
    sections,
    ctx: {
      logger: { warn() {} },
      skills: { registerProvider(factory) { providers.push(factory({ signal: new AbortController().signal, invalidate() {} })); } },
      systemPrompt: { section(section) { sections.push(section); } },
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
  assert.throws(() => apply(context().ctx, { skills: 'yes', bootstrap: false }), /config\.skills must be a boolean/);
});
