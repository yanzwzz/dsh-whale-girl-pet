/**
 * dsh-whale-girl-pet 看板布局单测。
 *
 * 关键设计：测试不是"再抄一份实现"，而是**从 lib/client.js 里把
 * createDashboardLayoutStore 工厂的源码抠出来**，放进 vm 沙箱求值再跑。
 * 所以这里跑的就是插件里真实运行的那段代码，不会被"实现改了、测试没改"骗过。
 *
 * 覆盖的正是曾经真实踩到的两个 bug：
 *   1) 存进去用 {x,y,w,h,moved}，读出来却按旧的 {dx,dy} 白名单过滤
 *      → 重新打开后位置丢失；
 *   2) 用布尔开关时若走 Number() 强转，moved 会变成 1。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/** 从 client.js 源码里抠出 `const NAME = <字面量>;` 的值。 */
function readLiteral(source, name) {
  const match = new RegExp('const ' + name + ' = ([^;]+);').exec(source);
  assert.notEqual(match, null, 'client.js 里必须存在常量 ' + name);
  // 这些常量都是纯数字字面量，直接求值即可（不 eval 复杂表达式）
  const value = Number(match[1].trim());
  assert.equal(Number.isFinite(value), true, name + ' 必须是数字字面量，实际：' + match[1]);
  return value;
}

/**
 * 从 client.js 里抠出 createDashboardLayoutStore 的函数源码（花括号配平），
 * 同时把工厂依赖的模块级常量一并带出来（否则沙箱里求值会 ReferenceError）。
 */
function extractFactory() {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const start = source.indexOf('function createDashboardLayoutStore(options) {');
  assert.notEqual(start, -1, 'client.js 里必须存在 createDashboardLayoutStore 工厂');
  let depth = 0;
  let body = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { body = source.slice(start, index + 1); break; }
    }
  }
  assert.notEqual(body, null, '工厂函数体没有配平');
  return {
    body,
    version: readLiteral(source, 'DASH_LAYOUT_VERSION'),
    defaultWidth: readLiteral(source, 'DASH_DEFAULT_WIDTH'),
    defaultHeight: readLiteral(source, 'DASH_DEFAULT_HEIGHT'),
  };
}

const FACTORY = extractFactory();

/**
 * 在沙箱里求值工厂。沙箱内的对象来自另一个 realm，node:assert 的 deep* 比较
 * 会因为原型不同而报 "same structure but not reference-equal"，所以断言统一
 * 走下面的 plain() 序列化后再比较（这些值本来就只有字符串/数字/布尔）。
 */
const sandbox = {};
vm.createContext(sandbox);
// 工厂引用的模块级常量：按 client.js 里的真实值注入，保证测的就是线上语义
vm.runInContext(
  'const DASH_LAYOUT_VERSION = ' + FACTORY.version + ';'
  + 'const DASH_DEFAULT_WIDTH = ' + FACTORY.defaultWidth + ';'
  + 'const DASH_DEFAULT_HEIGHT = ' + FACTORY.defaultHeight + ';\n'
  + FACTORY.body + '\n;globalThis.__factory = createDashboardLayoutStore;',
  sandbox,
);
const createStore = sandbox.__factory;

/** 来自 client.js 的真实默认值（测试期望值引用它，避免写死两份）。 */
const DEFAULT_W = FACTORY.defaultWidth;
const DEFAULT_H = FACTORY.defaultHeight;
const LAYOUT_VERSION = FACTORY.version;

/** 把跨 realm 的普通数据对象转成本 realm 的副本。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 内存版 localStorage。 */
function memoryStorage(initial) {
  const map = new Map(initial === undefined ? [] : Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

/** 造一个存储：视口 1000×800，📊 按钮在 (600, 500)、大小 38×38。 */
function makeStore(overrides = {}) {
  return createStore(Object.assign({
    storage: memoryStorage(),
    viewport: () => ({ width: 1000, height: 800 }),
    anchor: () => ({ left: 600, top: 500, width: 38, height: 38 }),
  }, overrides));
}

test('工厂可以从 client.js 源码里求值（保证测试的就是线上代码）', () => {
  assert.equal(typeof createStore, 'function');
  const store = makeStore();
  for (const name of ['read', 'write', 'clear', 'sizeOf', 'applySize', 'clampPoint', 'centerBase', 'place', 'dragTo', 'resizeTo']) {
    assert.equal(typeof store[name], 'function', '缺少方法 ' + name);
  }
  assert.equal(store.key, 'dsh-whale-pet.dashboard-layout');
  assert.equal(DEFAULT_W, 720, '默认宽度应从 client.js 读出');
  assert.equal(DEFAULT_H, 480, '默认高度应从 client.js 读出');
  assert.equal(LAYOUT_VERSION, 5, '记忆版本号应从 client.js 读出');
});

test('归一化：白名单数值 + 布尔 moved，脏数据不污染', () => {
  const store = makeStore();
  store.write({
    x: 12.6, y: '40', w: 640, h: 480, moved: true,
    junk: 'ignored', dx: 999, dy: 999,
  });
  const read = plain(store.read());
  assert.equal(read.x, 13, '数值四舍五入');
  assert.equal(read.y, 40, '数字字符串可被接受');
  assert.equal(read.w, 640);
  assert.equal(read.h, 480);
  assert.equal(read.moved, true, 'moved 必须保持布尔 true');
  assert.equal('dx' in read, false, '旧键名不得被读取');
  assert.equal('junk' in read, false);
  assert.equal('v' in read, false, '版本号是存储内部字段，不进布局对象');
});

test('moved 不会被 Number() 强转成数字（回归：曾把开关变成 1）', () => {
  const store = makeStore();
  store.write({ w: 520, h: 320, moved: 1 });
  assert.equal(store.read().moved, undefined, 'moved:1 不是合法布尔，应忽略');
  store.write({ w: 520, h: 320, moved: 'true' });
  assert.equal(store.read().moved, undefined);
  store.write({ w: 520, h: 320, moved: true });
  assert.equal(store.read().moved, true);
});

test('版本号：写入自动带 v，读到旧版本整份作废（新默认值才能生效）', () => {
  const storage = memoryStorage();
  const store = makeStore({ storage });
  store.write({ x: 100, y: 100, w: 700, h: 500, moved: true });
  const raw = JSON.parse(storage.getItem('dsh-whale-pet.dashboard-layout'));
  assert.equal(raw.v, LAYOUT_VERSION, '写入必须带当前版本号');

  // 模拟"旧的默认尺寸/默认位置"存下来的记忆（无版本号或旧版本号）
  const legacy = makeStore({ storage: memoryStorage({
    'dsh-whale-pet.dashboard-layout': JSON.stringify({ x: 100, y: 100, w: 700, h: 500, moved: true }),
  }) });
  assert.deepEqual(plain(legacy.read()), {}, '无版本号的旧记忆必须作废');
  const oldVersion = makeStore({ storage: memoryStorage({
    'dsh-whale-pet.dashboard-layout': JSON.stringify({ v: LAYOUT_VERSION - 1, x: 100, y: 100, w: 700, h: 500, moved: true }),
  }) });
  assert.deepEqual(plain(oldVersion.read()), {}, '旧版本号的记忆必须作废');
  // 作废后落定 → 回到新的默认位置/尺寸
  const placed = oldVersion.place(oldVersion.read(), undefined);
  assert.notEqual(placed.moved, true);
});

test('读写往返：拖动后写入的键全部能读回来（回归：重开丢位置）', () => {
  const store = makeStore();
  const afterDrag = store.dragTo({}, { x: 100, y: 100 }, { dx: 40, dy: 30 });
  // 起手是空布局 → 尺寸取默认值
  store.write(afterDrag);
  const read = plain(store.read());
  assert.deepEqual(read, { x: 140, y: 130, w: DEFAULT_W, h: DEFAULT_H, moved: true });
  // 重新打开：必须回到记忆坐标，而不是回默认位置
  const reopened = store.place(read);
  assert.equal(reopened.x, 140);
  assert.equal(reopened.y, 130);
  assert.equal(reopened.w, DEFAULT_W, '拖动会把起手尺寸锁定进记忆');
});

test('没拖过时默认位置 = 视口居中，默认尺寸 = client.js 里的常量', () => {
  const store = makeStore();
  const placed = store.place({});
  assert.equal(placed.w, DEFAULT_W);
  assert.equal(placed.h, DEFAULT_H);
  assert.equal(placed.x, Math.round((1000 - DEFAULT_W) / 2), '水平居中');
  assert.equal(placed.y, Math.round((800 - DEFAULT_H) / 2), '垂直居中');
  assert.equal(placed.moved, undefined, '默认态不写 moved');
});

test('sizeOf 不再把"当前渲染尺寸"当兜底（回归：默认尺寸曾被 CSS 520px 盖住）', () => {
  const store = makeStore();
  // 旧实现会把传入的实测尺寸当默认值，于是 CSS 的 520 永远赢
  assert.deepEqual(plain(store.sizeOf({})), { width: DEFAULT_W, height: DEFAULT_H });
  assert.deepEqual(plain(store.sizeOf(undefined)), { width: DEFAULT_W, height: DEFAULT_H });
});

test('applySize：双击复位时用显式尺寸覆盖（只有它是显式覆盖入口）', () => {
  const store = makeStore();
  const sized = plain(store.applySize({ moved: true, x: 10, y: 20 }, { w: 500, h: 400 }));
  assert.deepEqual(sized, { moved: true, x: 10, y: 20, w: 500, h: 400 });
  // 非法尺寸忽略，不污染布局
  assert.deepEqual(plain(store.applySize({ w: 700 }, { w: 0, h: 10 })), { w: 700 });
  assert.deepEqual(plain(store.applySize({ w: 700 }, undefined)), { w: 700, });
});

test('applySize 只改尺寸、保留位置语义（回归：曾被误当成"复位"入口）', () => {
  const store = makeStore();
  // 空覆盖对象 = 无效尺寸 → 布局原样返回，位置仍是用户拖走的坐标
  const unchanged = plain(store.applySize({ moved: true, x: 12, y: 34 }, {}));
  assert.deepEqual(unchanged, { moved: true, x: 12, y: 34 }, '空覆盖不应改动任何字段');
  assert.equal(store.place({ moved: true, x: 12, y: 34 }, {}).x, 12, 'place 仍会用记忆坐标');
});

test('复位语义：place 必须收到"空布局"才会回到默认尺寸 + 视口居中', () => {
  const store = makeStore();
  // 先造一份"用户拖走 + 放大"的记忆
  const dragged = store.dragTo({}, { x: 0, y: 0 }, { dx: 300, dy: 200 });
  const grown = store.resizeTo(dragged, { w: 860, h: 700 });
  assert.equal(grown.moved, true, '仍处于"被拖过"状态');
  assert.ok(grown.w > 0 && grown.h > 0, '尺寸有效：' + grown.w + '×' + grown.h);

  // ✅ 正确的复位：内存布局也清空后再落定
  const reset = store.place({});
  assert.equal(reset.moved, undefined, '复位后不应再是"被拖过"状态');
  assert.equal(reset.w, DEFAULT_W);
  assert.equal(reset.h, DEFAULT_H);
  assert.equal(reset.x, Math.round((1000 - DEFAULT_W) / 2), '回到水平居中');
  assert.equal(reset.y, Math.round((800 - DEFAULT_H) / 2), '回到垂直居中');

  // ❌ 反面：把旧布局喂给 place 只会保留旧坐标（这正是曾经的 bug 形态）
  const notReset = store.place(grown);
  assert.equal(notReset.x, grown.x, '带着旧布局落定不会改变位置');
  assert.notEqual(notReset.x, reset.x, '所以"清记忆"必须同时清内存布局');
});

test('place 的尺寸覆盖参数会改掉 w/h（复位路径）', () => {
  const store = makeStore();
  const placed = store.place({}, { w: 500, h: 430 });
  assert.equal(placed.w, 500);
  assert.equal(placed.h, 430);
  assert.equal(placed.x, Math.round((1000 - 500) / 2), '按覆盖后的尺寸居中');
});

test('视口比默认尺寸小的时候，默认尺寸收窄到视口内并居中', () => {
  const narrow = makeStore({ viewport: () => ({ width: 400, height: 300 }) });
  const size = plain(narrow.sizeOf({}));
  assert.deepEqual(size, { width: 376, height: 276 }, '应是「视口 − 24」');
  const placed = narrow.place({});
  // 尺寸 = 视口 − 24，两边正好各留 12px：(400-376)/2=12, (300-276)/2=12
  assert.deepEqual(plain({ x: placed.x, y: placed.y }), { x: 12, y: 12 }, '收窄后仍然居中');
});

test('记忆坐标与默认居中都会夹进视口（幂等）', () => {
  const store = makeStore();
  const once = store.place({ moved: true, x: -500, y: -500 });
  const twice = store.place(once);
  assert.deepEqual(plain(twice), plain(once), '重复落定结果必须一致（否则每次打开都会漂移）');
  assert.equal(once.x, 8);
  assert.equal(once.y, 8);

  const far = store.place({ moved: true, x: 99999, y: 99999 });
  assert.equal(far.x, 1000 - DEFAULT_W - 8);
  assert.equal(far.y, 800 - DEFAULT_H - 8);
});

test('拖动位移是叠加在当前坐标上，连续拖动不漂移', () => {
  const store = makeStore();
  const first = store.dragTo({ moved: true, x: 100, y: 100, w: 520, h: 348 }, { x: 100, y: 100 }, { dx: 50, dy: 20 });
  assert.deepEqual(plain({ x: first.x, y: first.y }), { x: 150, y: 120 });
  // 第二次拖动的起点是"当前坐标"（150,120），所以再 +10 就是 160
  const second = store.dragTo(first, { x: first.x, y: first.y }, { dx: 10, dy: 10 });
  assert.deepEqual(plain({ x: second.x, y: second.y }), { x: 160, y: 130 });
  assert.equal(second.w, 520, '自定义尺寸在拖动中原样保留');
});

test('拖动会把起始尺寸锁定下来（w/h 落盘，重开时尺寸不跳）', () => {
  const store = makeStore();
  const dragged = store.dragTo({}, { x: 0, y: 0 }, { dx: 10, dy: 10 });
  assert.equal(dragged.w, DEFAULT_W, '空布局起手 = 默认尺寸');
  assert.equal(dragged.h, DEFAULT_H);
  assert.equal(dragged.moved, true);
});

test('缩放：夹在最小尺寸与视口剩余空间之间', () => {
  const store = makeStore();
  const tiny = plain(store.resizeTo({ x: 100, y: 100 }, { w: 10, h: 10 }));
  assert.deepEqual({ w: tiny.w, h: tiny.h }, { w: 300, h: 200 }, '不得小于最小尺寸');

  // 起点 (100,100)，视口 1000×800 → 最大 892×692
  const huge = plain(store.resizeTo({ x: 100, y: 100 }, { w: 5000, h: 5000 }));
  assert.deepEqual({ w: huge.w, h: huge.h }, { w: 892, h: 692 });

  const normal = plain(store.resizeTo({ x: 100, y: 100 }, { w: 640, h: 480 }));
  assert.deepEqual({ w: normal.w, h: normal.h }, { w: 640, h: 480 });
});

test('缩放不影响 moved 与坐标', () => {
  const store = makeStore();
  const resized = store.resizeTo({ moved: true, x: 140, y: 130, w: 520, h: 348 }, { w: 700, h: 500 });
  assert.equal(resized.moved, true);
  assert.equal(resized.x, 140);
  assert.equal(resized.y, 130);
});

test('clear 之后回到默认（视口居中 + 默认尺寸）', () => {
  const store = makeStore();
  store.write(store.dragTo({}, { x: 0, y: 0 }, { dx: 300, dy: 200 }));
  assert.equal(store.read().moved, true);
  store.clear();
  assert.deepEqual(plain(store.read()), {});
  const placed = store.place(store.read());
  assert.equal(placed.w, DEFAULT_W, '复位回默认宽度');
  assert.equal(placed.h, DEFAULT_H, '复位回默认高度');
  assert.equal(placed.x, Math.round((1000 - DEFAULT_W) / 2), '应回到视口水平居中');
  assert.equal(placed.y, Math.round((800 - DEFAULT_H) / 2), '应回到视口垂直居中');
});

test('storage 不可用（无痕/被禁）时退化为不记忆但不抛错', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const store = makeStore({ storage: broken });
  assert.deepEqual(plain(store.read()), {});
  store.write({ x: 1, y: 2, moved: true });
  const store2 = makeStore({ storage: null });
  assert.deepEqual(plain(store2.read()), {});
  store2.write({ x: 1 });
  assert.equal(store2.place({}).moved, undefined);
});

test('localStorage 里是坏 JSON 时退回自动布局', () => {
  const store = makeStore({ storage: memoryStorage({ 'dsh-whale-pet.dashboard-layout': '{not json' }) });
  assert.deepEqual(plain(store.read()), {});
  const store2 = makeStore({ storage: memoryStorage({ 'dsh-whale-pet.dashboard-layout': 'null' }) });
  assert.deepEqual(plain(store2.read()), {});
});

test('重置（clean + place）：尺寸回到自然大小且重新锚定（回归：曾把旧尺寸写回记忆）', () => {
  const store = makeStore();
  // 用户先拖走 + 放大
  store.write(store.resizeTo(
    store.dragTo({}, { x: 0, y: 0 }, { dx: 300, dy: 200 }),
    { w: 660, h: 500 },
  ));
  const before = plain(store.read());
  assert.equal(before.moved, true);
  assert.equal(before.w, 660);

  // 双击头部：清记忆 → 尺寸回到默认值、位置回到视口居中
  store.clear();
  assert.deepEqual(plain(store.read()), {});
  const placed = store.place(store.read(), { w: 500, h: 400 });
  assert.equal(placed.moved, undefined, '重置后不再是"被拖过"状态');
  // 传了 measured 就以实测为准（复位时用"自然尺寸"落定），位置按它居中
  assert.equal(placed.w, 500);
  assert.equal(placed.h, 400);
  assert.equal(placed.x, Math.round((1000 - 500) / 2), '重新回到视口水平居中');
  assert.equal(placed.y, Math.round((800 - 400) / 2), '重新回到视口垂直居中');
});

test('sizeOf：自定义优先，否则取 client.js 里的默认常量', () => {
  const store = makeStore();
  assert.deepEqual(plain(store.sizeOf({ w: 640, h: 480 })), { width: 640, height: 480 });
  assert.deepEqual(plain(store.sizeOf({})), { width: DEFAULT_W, height: DEFAULT_H });
  assert.deepEqual(plain(store.sizeOf(undefined)), { width: DEFAULT_W, height: DEFAULT_H });
  // 视口很窄时默认尺寸跟着收
  const narrow = makeStore({ viewport: () => ({ width: 400, height: 800 }) });
  assert.deepEqual(plain(narrow.sizeOf({})), { width: 376, height: Math.min(DEFAULT_H, 776) });
  // 视口比默认高度还矮时，高度也收（收窄值 = 视口 − 24）
  const short = makeStore({ viewport: () => ({ width: 1200, height: 420 }) });
  assert.deepEqual(plain(short.sizeOf({})), { width: DEFAULT_W, height: 396 });
  // 视口刚好比默认高度小一点 → 收窄到视口 − 24（此时按"收窄值"算）
  const justUnder = makeStore({ viewport: () => ({ width: 1200, height: DEFAULT_H + 10 }) });
  assert.deepEqual(plain(justUnder.sizeOf({})), { width: DEFAULT_W, height: DEFAULT_H - 14 });
  // 视口足够高 → 用默认高度
  const tall = makeStore({ viewport: () => ({ width: 1200, height: DEFAULT_H + 100 }) });
  assert.deepEqual(plain(tall.sizeOf({})), { width: DEFAULT_W, height: DEFAULT_H }, '视口够高时用默认高度');
});
