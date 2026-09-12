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

test('气泡看板：词典键齐备，客户端接入 /api/whale-pet/usage', () => {
  const { exports } = loadClientBundle();
  const locales = [];
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: (ns, dicts) => { locales.push([ns, dicts]); return () => {}; } },
    slots: {
      inject: (name, factory) => {
        const produced = factory();
        if (produced && typeof produced[Symbol.iterator] === 'function') for (const _ of produced) { /* drive */ }
        return () => {};
      },
      register: () => () => {},
    },
  };
  exports.apply(ctx, {});
  const dicts = locales.find(([ns]) => ns === 'whale-pet-cost');
  assert.ok(dicts, '必须注册 whale-pet-cost 词典');
  const [ns, { zh, en }] = dicts;
  assert.equal(ns, 'whale-pet-cost');
  // 中英键必须一一对应（缺键会退回键名显示，属于缺陷）
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), '中英文案键必须一致');
  for (const key of Object.keys(zh)) {
    assert.ok(key.startsWith('dash.') || key.startsWith('pill.') || key.startsWith('dialog.') || key.startsWith('turn.'), '未知的文案键：' + key);
  }
  // 看板核心键
  for (const key of ['dash.title', 'dash.tabHourly', 'dash.tabDaily', 'dash.legendPeak', 'dash.legendOff', 'dash.note']) {
    assert.equal(typeof zh[key], 'string', '缺少中文键 ' + key);
    assert.equal(typeof en[key], 'string', '缺少英文键 ' + key);
  }
  // 源码里应当指向宿主新路由（不能拼错路径，否则看板永远读不到数据）
  const source = readFileSync(CLIENT_PATH, 'utf8');
  assert.ok(source.includes("'/api/whale-pet/usage'"), '客户端必须请求 /api/whale-pet/usage');
  assert.ok(source.includes('dsh-pet-dash-panel'), '必须含看板弹窗样式类');
  // 主图：结构化 SVG 堆叠柱（旧的 dsh-pet-dash-bar 单色柱已废弃）
  assert.ok(source.includes('dsh-pet-dash-plot'), '必须含绘图区样式类');
  assert.ok(source.includes('dsh-pet-dash-seg'), '必须含堆叠分段样式类');
  assert.ok(source.includes('dsh-pet-dash-grid'), '必须含网格线样式类');
  // 均值已从图里移到汇总格：图内不应再有均值线，汇总格要有按小时/按天的均值卡
  assert.equal(source.includes('dsh-pet-dash-avg'), false, '图内均值线应已移除');
  assert.ok(source.includes("'dash.avgHour'"), '汇总格必须有"平均每小时"卡');
  assert.ok(source.includes("'dash.avgDay'"), '汇总格必须有"平均每天"卡');
  // 三桶 + 命中率 + 均值文案键
  for (const key of ['dash.bucketHit', 'dash.bucketMiss', 'dash.bucketOut', 'dash.hitRate', 'dash.avg']) {
    assert.equal(typeof zh[key], 'string', '缺少中文键 ' + key);
    assert.equal(typeof en[key], 'string', '缺少英文键 ' + key);
  }
});

test('createPortal 的容器必须经过校验（防 minified React #200 再次发生）', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  // 容器不是真实 DOM 元素时 React 会抛 minified #200，并把整个 shell.overlay
  // 条目打挂（= 桌宠直接消失）。所以每处 createPortal 的容器都必须来自
  // portalContainer()，且绝不能出现裸的 document.body。
  const calls = source.match(/createPortal\(/g) ?? [];
  assert.ok(calls.length >= 3, '应至少有三处 createPortal（看板 / 会话费用 / 本轮费用），实际 ' + calls.length);
  assert.equal(
    (source.match(/, document\.body\)/g) ?? []).length, 0,
    '不得直接传 document.body 给 createPortal',
  );
  assert.ok(
    (source.match(/portalContainer\(\)/g) ?? []).length >= 4,
    '每处 portal 都要先取 portalContainer()（1 处定义 + 3 处使用起）',
  );
  const helper = /function portalContainer\(\)[\s\S]*?\n\t\t\}/.exec(source);
  assert.ok(helper !== null, '必须存在 portalContainer()');
  assert.ok(helper[0].includes('nodeType === 1'), 'portalContainer 必须按 nodeType 校验');
  assert.ok(helper[0].includes('documentElement'), 'portalContainer 必须有 documentElement 兜底');
  // 看板必须包在错误围栏里，异常不得冒泡到桌宠
  assert.ok(source.includes('DashboardBoundary'), '看板必须有错误围栏');
  assert.ok(source.includes('getDerivedStateFromError'), '错误围栏必须实现 getDerivedStateFromError');
});
