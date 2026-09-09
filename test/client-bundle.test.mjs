/**
 * dsh-whale-girl-pet 浏览器半侧 bundle 冒烟测试：
 * 在 VM 里按 __ModuleLoader__ 协议加载 lib/client.js，执行 factory，
 * 并检查 apply 注册的槽位（桌宠、设置面板、费用 pill）与文案命名空间。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/** 最小 react 替身：顶层只做定义，不真正渲染。 */
const react = new Proxy({}, {
  get: (_target, prop) => {
    if (prop === 'Component') return class Component {};
    if (prop === 'createElement') return () => ({});
    if (prop === 'Fragment') return 'Fragment';
    return () => {};
  },
});
const jsxRuntime = { jsx: () => ({}), jsxs: () => ({}), Fragment: 'Fragment' };
const reactDom = { createPortal: (node) => node };

/** 按 loader 协议加载 bundle 并返回 factory 的执行结果。 */
function loadClientBundle() {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const handoffs = [];
  const sandbox = { window: { __ModuleLoader__: { load: (handoff) => { handoffs.push(handoff); } } } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.equal(handoffs.length, 1, 'bundle 必须恰好注册一个模块');
  const require = (id) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === 'react-dom') return reactDom;
    throw new Error('unexpected external: ' + id);
  };
  return { handoff: handoffs[0], exports: handoffs[0].factory(require) };
}

test('client bundle 以正确 id 注册并导出插件三件套', () => {
  const { handoff, exports } = loadClientBundle();
  assert.equal(handoff.id, 'dsh-whale-girl-pet');
  assert.equal(typeof exports.apply, 'function');
  assert.equal(typeof exports.name, 'string');
  assert.equal(JSON.stringify(exports.inject), JSON.stringify(['slots', 'locale']));
});

test('apply 注册桌宠、设置面板与费用 pill，并注册费用文案', () => {
  const { exports } = loadClientBundle();
  const injected = [];
  const registered = [];
  const locales = [];
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: (ns, dicts) => { locales.push([ns, dicts]); return () => {}; } },
    slots: {
      inject: (name, factory) => {
        injected.push(name);
        // inject 的工厂是 generator（官方叠加式注册），必须迭代才会执行注册体
        const produced = factory();
        if (produced && typeof produced[Symbol.iterator] === 'function') {
          for (const _ of produced) { /* 驱动注册 */ }
        }
        return () => {};
      },
      register: (options, component) => {
        registered.push([options, component]);
        return () => {};
      },
    },
  };
  exports.apply(ctx, {});
  assert.deepEqual(injected, [
    'shell.overlay',
    'settings.section',
    'conversation.composer.dock',
    'conversation.chat.assistant-actions',
  ]);
  assert.deepEqual(locales.map(([ns]) => ns), ['whale-pet-cost']);
  const dock = registered.find(([options]) => options.name === 'conversation.composer.dock');
  assert.ok(dock, '必须注册 conversation.composer.dock 条目');
  assert.equal(JSON.stringify(dock[0]), JSON.stringify({
    name: 'conversation.composer.dock',
    id: 'whale-pet-cost',
    order: 5,
    locale: 'whale-pet-cost',
  }));
  assert.equal(typeof dock[1], 'function');
  const turnPill = registered.find(([options]) => options.name === 'conversation.chat.assistant-actions');
  assert.ok(turnPill, '必须注册 conversation.chat.assistant-actions 条目');
  assert.equal(JSON.stringify(turnPill[0]), JSON.stringify({
    name: 'conversation.chat.assistant-actions',
    id: 'whale-pet-cost-turn',
    order: 50,
    locale: 'whale-pet-cost',
  }));
  assert.equal(typeof turnPill[1], 'function');
});
