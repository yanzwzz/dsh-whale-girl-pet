/**
 * dsh-whale-girl-pet 宿主半侧集成测试：真跑 apply() + 真打路由。
 *
 * 【为什么需要这层】单测只覆盖纯函数（usage/weather/balance 整形），而
 * `resolveConfig is not defined` 这类**作用域**缺陷恰恰发生在"路由 handler 与
 * 模块级函数之间"：weather 路由曾把模块级的 queryWeather 写成了读 applyInner
 * 闭包里的 resolveConfig，单测全绿、真机 502。这里用一个假 ctx 把插件真装起来、
 * 拿到它注册的路由、再用桩 fetch 打一遍，才能覆盖这种缝。
 *
 * 覆盖：
 *   1) 路由清单（少一条就是功能消失）
 *   2) 天气：城市取自设置（回归 resolveConfig 作用域缺陷）+ 失败分支文案
 *   3) 余额：没有 key / 401 的文案
 *   4) issue #1：投影键撞名时 apply() 不得整体失败（DSH 会拒绝同名不同版本）
 *   5) 宿主与浏览器半侧的投影键必须一致（写错就是费用 pill 静默失灵）
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply } from '../lib/index.js';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const PROJECTION_PATH = fileURLToPath(new URL('../lib/cost-projection.js', import.meta.url));

/** 一份能装上插件的假 ctx：只实现 applyInner 真正用到的东西。 */
function makeCtx(options = {}) {
  const routes = [];
  const projections = [];
  const listeners = [];
  const warnings = [];
  const live = { config: Object.assign({ city: '济南', dashboardWindowDays: 7, dashboardHistory: false }, options.config) };
  const ctx = {
    fiber: { entry: { options: { id: 'pet' } }, config: live.config },
    logger: {
      warn: (...args) => { warnings.push(args.map(String).join(' ')); },
      info: () => {}, error: () => {}, debug: () => {},
    },
    effect: (fn) => { fn(); return () => {}; },
    on: (event, handler) => { listeners.push({ event, handler }); return () => {}; },
    webServer: {
      register: (spec) => { routes.push(spec); return () => {}; },
    },
    sessionProjections: {
      register: (projection) => {
        // DSH 的真实行为：同名键已被别的 stateVersion 注册时**抛错**拒绝
        if (options.takenProjections !== undefined && options.takenProjections.includes(projection.key)) {
          throw new Error('session projection key "' + projection.key + '" is already registered at stateVersion 9; refusing to share it with stateVersion ' + String(projection.stateVersion));
        }
        projections.push(projection);
        return () => {};
      },
    },
    settings: { writable: true, mutate: async () => {} },
    get: (name) => {
      if (name === 'credentials') return options.credentials;
      if (name === 'timer') return { interval: () => () => {}, timeout: () => () => {} };
      if (name === 'agents') return { list: () => [], roots: () => [] };
      if (name === 'sessions') return undefined;
      if (name === 'sessionPersistence') return undefined;
      return undefined;
    },
  };
  return { ctx, routes, projections, listeners, warnings };
}

/** 打一条已注册的路由，返回 { status, json, text }。 */
async function hit(routes, path, { method = 'GET', url = path } = {}) {
  const route = routes.find((r) => r.path === path);
  assert.ok(route !== undefined, '路由未注册：' + path);
  let status = 0;
  let body = '';
  const res = {
    writeHead: (code) => { status = code; return res; },
    end: (chunk) => { body = chunk === undefined ? '' : String(chunk); return res; },
    setHeader: () => {}, write: () => true,
  };
  await route.handler({ method, url, headers: {}, on: () => {} }, res);
  let json;
  try { json = JSON.parse(body); } catch { json = undefined; }
  return { status, json, text: body };
}

/** 临时替换全局 fetch，跑完自动还原。 */
async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('apply() 注册了全部宿主路由（少一条就是功能消失）', () => {
  const { ctx, routes } = makeCtx();
  apply(ctx, ctx.fiber.config);
  const paths = routes.map((r) => r.path);
  for (const path of ['/api/whale-pet/state', '/api/whale-pet/settings', '/api/whale-pet/weather',
    '/api/whale-pet/usage', '/api/whale-pet/subtree-cost', '/api/whale-balance']) {
    assert.ok(paths.includes(path), '缺少路由 ' + path);
  }
  assert.ok(routes.some((r) => r.kind === 'prefix'), '必须有 /pet 前缀路由（动画资源）');
});

test('天气路由：城市取自设置，返回整形后的结果（回归 resolveConfig 作用域缺陷）', async () => {
  const { ctx, routes } = makeCtx({ config: { city: '济南' } });
  apply(ctx, ctx.fiber.config);

  const wttr = {
    current_condition: [{ temp_C: '28', weatherCode: '113' }],
    nearest_area: [{ latitude: '36.683', longitude: '117.050', areaName: [{ value: 'Hongjialou' }] }],
    weather: [
      { maxtempC: '26', mintempC: '17', hourly: [{ time: '1200', weatherCode: '116' }] },
      { maxtempC: '24', mintempC: '18', hourly: [{ time: '1200', weatherCode: '122' }] },
    ],
  };
  const seen = [];
  const result = await withFetch(async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => wttr };
  }, () => hit(routes, '/api/whale-pet/weather'));

  assert.equal(result.status, 200);
  assert.deepEqual(result.json, {
    ok: true, city: '济南', icon: '☀️', temp: '28°C',
    tomorrowIcon: '☁️', tomorrowLow: 18, tomorrowHigh: 24, tomorrowDesc: '阴',
  });
  assert.ok(seen[0].startsWith('https://wttr.in/'), '必须直连 wttr.in，实际 ' + seen[0]);
  assert.ok(seen[0].includes(encodeURIComponent('济南')), '城市名必须进 URL：' + seen[0]);
});

test('天气路由：网络/HTTP 失败只报数据层错误，不得冒出 JS 作用域错误', async () => {
  const { ctx, routes } = makeCtx({ config: { city: '济南' } });
  apply(ctx, ctx.fiber.config);

  const http500 = await withFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }),
    () => hit(routes, '/api/whale-pet/weather'));
  assert.equal(http500.status, 502);
  assert.equal(http500.json.error, 'wttr.in 请求失败（HTTP 500）');

  const thrown = await withFetch(async () => { throw new Error('getaddrinfo ENOTFOUND wttr.in'); },
    () => hit(routes, '/api/whale-pet/weather'));
  assert.equal(thrown.status, 502);
  assert.ok(thrown.json.error.includes('ENOTFOUND'), '必须把底层网络原因带出来：' + thrown.json.error);
  // 这条断言就是本文件的存在理由：作用域/引用错误必须在这里被抓住
  assert.equal(/is not defined|ReferenceError|TypeError|SyntaxError/.test(thrown.json.error), false,
    '不得出现 JS 层错误：' + thrown.json.error);
});

test('余额路由：没有 key 与 HTTP 401 的文案', async () => {
  const noKey = makeCtx();
  apply(noKey.ctx, noKey.ctx.fiber.config);
  const missing = await hit(noKey.routes, '/api/whale-balance');
  assert.equal(missing.status, 502);
  assert.ok(missing.json.error.includes('DEEPSEEK_API_KEY'), missing.json.error);

  const withKey = makeCtx({ credentials: { resolve: async () => ({ value: 'sk-test-123456' }) } });
  apply(withKey.ctx, withKey.ctx.fiber.config);
  const unauthorized = await withFetch(async () => ({
    ok: false, status: 401, text: async () => 'Authentication Fails (auth header format should be Bearer sk-...)',
  }), () => hit(withKey.routes, '/api/whale-balance'));
  assert.equal(unauthorized.status, 502);
  assert.ok(unauthorized.json.error.includes('HTTP 401'), unauthorized.json.error);
  assert.ok(unauthorized.json.ok === false);
});

test('issue #1：投影键被别的插件占用时，apply() 不得整体失败（桌宠不能消失）', () => {
  // dsh-cost-meter 用 costUsage：模拟"已被 stateVersion 9 注册"
  const { ctx, routes, projections, warnings } = makeCtx({ takenProjections: ['costUsage'] });
  assert.doesNotThrow(() => apply(ctx, ctx.fiber.config), '投影撞键绝不能让整条 entry 挂掉');
  assert.deepEqual(projections.map((p) => p.key), ['whalePetCost'], '我们自己的投影必须换个键注册成功');
  assert.ok(routes.some((r) => r.path === '/api/whale-pet/weather'), '投影失败不影响路由注册');
  assert.deepEqual(warnings, [], '换了键之后不该有任何装配被跳过（零功能跳过）');
});

test('宿主与浏览器半侧的投影键必须一致（写错就是费用 pill 静默失灵）', () => {
  const hostKey = /key: '([^']+)'/.exec(readFileSync(PROJECTION_PATH, 'utf8'));
  assert.ok(hostKey !== null, '宿主投影必须声明 key');
  const clientKeys = [...readFileSync(CLIENT_PATH, 'utf8').matchAll(/useProjection\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(clientKeys.length >= 2, '浏览器半侧应有会话 pill 与本轮 pill 两处读取，实际 ' + clientKeys.length);
  for (const key of clientKeys) assert.equal(key, hostKey[1], '浏览器读取的投影键必须与宿主一致');
  assert.equal(hostKey[1].includes('.'), false, '键名不该带点号');
  assert.notEqual(hostKey[1], 'costUsage', '不得再用通用键名 costUsage（issue #1）');
});
