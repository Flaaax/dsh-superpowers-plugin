import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 捕获 window.__ModuleLoader__.load 的定义。
let loadDef;
globalThis.window = {
  __ModuleLoader__: {
    load: (def) => { loadDef = def; },
  },
};
await import(`${pathToFileURL(join(root, 'lib', 'client.js')).href}?client=${Date.now()}`);

test('客户端 bundle 通过包名注册', () => {
  assert.ok(loadDef, '客户端应调用 window.__ModuleLoader__.load');
  assert.equal(loadDef.id, 'dsh-superpowers-plugin');
  assert.equal(typeof loadDef.factory, 'function');
});

// mock require：只提供 react（基线模块）；require 任何其它模块都应失败，
// 以此证明客户端没有 require @deepseek-ai/dsh-client-ui-* 包。
const mockRequire = (specifier) => {
  if (specifier === 'react') {
    return {
      createElement: (tag, props, ...children) => ({ tag, props, children }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
    };
  }
  throw new Error(`unexpected require: ${specifier}`);
};

const moduleExports = loadDef.factory(mockRequire);

const registerCalls = [];
const slotInjectNames = [];
let configFormsEntryId;

function makeScope() {
  return {
    getSnapshot: () => ({ status: 'ready', value: { skills: true, bootstrap: true, toolMapping: true, order: 50 }, writable: true, revision: 1 }),
    subscribe: () => () => {},
    mutate: async () => true,
  };
}

function makeCtx() {
  const scope = makeScope();
  return {
    scope,
    configForms: {
      get(entryId) {
        configFormsEntryId = entryId;
        return scope;
      },
    },
    slots: {
      inject(name, setup) {
        slotInjectNames.push(name);
        return setup();
      },
      register(options, component) {
        registerCalls.push({ options, component });
        return () => {};
      },
    },
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
  };
}

test('客户端导出 name 与所需服务，且不 require 任何 dsh-client-ui 包', () => {
  assert.equal(moduleExports.name, 'dsh-superpowers');
  assert.deepEqual(moduleExports.inject, ['configForms', 'slots']);
  assert.equal(typeof moduleExports.apply, 'function');
});

test('apply 以 entry id 读取配置，并以包名注册到插件页 slot', () => {
  const ctx = makeCtx();
  moduleExports.apply(ctx);
  assert.equal(configFormsEntryId, 'dsh-superpowers');
  assert.deepEqual(slotInjectNames, ['plugins.bundle.config']);
  assert.equal(registerCalls.length, 1);
  assert.equal(registerCalls[0].options.name, 'plugins.bundle.config');
  assert.equal(registerCalls[0].options.key, 'dsh-superpowers-plugin');
  assert.equal(typeof registerCalls[0].component, 'function');
});

test('配置卡 slot 注入面把 settings scope 交给组件', () => {
  const ctx = makeCtx();
  moduleExports.apply(ctx);
  const face = registerCalls[registerCalls.length - 1].options.inject();
  assert.equal(face.scope, ctx.scope);
});
