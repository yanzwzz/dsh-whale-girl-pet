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
const HOST_PATH = fileURLToPath(new URL('../lib/index.js', import.meta.url));
const HOST_SOURCE = readFileSync(HOST_PATH, 'utf8');
const PROJECTION_PATH = fileURLToPath(new URL('../lib/cost-projection.js', import.meta.url));

/** 一份能装上插件的假 ctx：只实现 applyInner 真正用到的东西。 */
function makeCtx(options = {}) {
  const routes = [];
  const projections = [];
  const listeners = [];
  const warnings = [];
  const mutations = []; // settings.mutate 的调用记录（issue #10：尺寸/位置写回的接线断言）
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
    settings: { writable: options.writable !== false, mutate: async (ns, ops) => { mutations.push({ ns, ops }); } },
    get: (name) => {
      if (name === 'credentials') return options.credentials;
      if (name === 'timer') return { interval: () => () => {}, timeout: () => () => {} };
      if (name === 'agents') return options.agents !== undefined ? options.agents : { list: () => [], roots: () => [] };
      if (name === 'sessions') return options.sessions;
      if (name === 'sessionPersistence') return undefined;
      return undefined;
    },
  };
  return { ctx, routes, projections, listeners, warnings, mutations };
}

/** 打一条已注册的路由，返回 { status, json, text }。 */
async function hit(routes, path, { method = 'GET', url = path, body } = {}) {
  const route = routes.find((r) => r.path === path);
  assert.ok(route !== undefined, '路由未注册：' + path);
  let status = 0;
  let body2 = '';
  const res = {
    writeHead: (code) => { status = code; return res; },
    end: (chunk) => { body2 = chunk === undefined ? '' : String(chunk); return res; },
    setHeader: () => {}, write: () => true,
  };
  // 请求体：readBody 走 req.on('data')/('end')，这里按需同步喂给它
  const chunks = body === undefined ? [] : [String(body)];
  const req = {
    method, url, headers: {}, destroy: () => {},
    on: (event, callback) => {
      if (event === 'data') { for (const chunk of chunks) callback(chunk); }
      else if (event === 'end') callback();
      return req;
    },
  };
  await route.handler(req, res);
  let json;
  try { json = JSON.parse(body2); } catch { json = undefined; }
  return { status, json, text: body2 };
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

test('费用显示开关：schema 里五个键都存在且默认 true', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');
  for (const key of ['costPillSession', 'costPillTurn', 'costInBubble', 'costBalanceButton', 'costDashboard']) {
    // 必须 .default(true).volatile()：前者保证默认开，后者保证它能出现在设置面板里并被写回
    const pattern = new RegExp(key + ':\\s*Schema\\.boolean\\(\\)\\.default\\(true\\)\\.volatile\\(\\)');
    assert.ok(pattern.test(source), '缺少费用显示开关 ' + key);
  }
});

test('费用显示开关：costBalanceButton 关闭时余额响应不再附带今日用量', async () => {
  const credentials = { resolve: async () => ({ value: 'sk-test-123456' }) };
  const fetchStub = async () => ({
    ok: true, status: 200,
    json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '1.00' }] }),
  });

  const off = makeCtx({ credentials, config: { costBalanceButton: false } });
  apply(off.ctx, off.ctx.fiber.config);
  const hidden = await withFetch(fetchStub, () => hit(off.routes, '/api/whale-balance'));
  assert.equal(hidden.json.ok, true);
  assert.equal('usage' in hidden.json, false, '关掉 💰 按钮后不应再计算/返回今日用量');

  const on = makeCtx({ credentials });
  apply(on.ctx, on.ctx.fiber.config);
  const shown = await withFetch(fetchStub, () => hit(on.routes, '/api/whale-balance'));
  assert.equal(shown.json.ok, true);
  assert.ok('usage' in shown.json, '默认（开关为开）必须照旧返回今日用量');
});

test('费用显示开关：气泡的花费行必须是配置驱动的（接线断言）', () => {
  const source = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');
  // 只加开关不够：taskSummaryLines 的 withCost 必须真的接上配置，否则开关写了也不生效
  assert.ok(
    /taskSummaryLines\(durStr,\s*usage,\s*\{\s*withCost:\s*resolveConfig\(\)\.costInBubble !== false/.test(source),
    '任务完成气泡必须把 costInBubble 传给 taskSummaryLines({ withCost })',
  );
  // usage 只算一次，随后同时喂给气泡与（新增的）结构化摘要字段
  assert.ok(
    /const usage = computeTaskUsage\(ctx, taskSince\)/.test(source),
    'computeTaskUsage 必须先赋给 usage 再复用',
  );
  assert.ok(
    /summary\.costCny = usage\.costCny/.test(source),
    '回来汇总用的 costCny 必须来自同一次 computeTaskUsage',
  );
});

/**
 * 真端到端（不是字符串断言）：驱动 agent 注册表 + 打 state 路由，检查队列里那条
 * done 到底带了哪些字段。
 *
 * 【为什么必须有这层】push() 是**白名单拷贝**：新增字段忘记登记就会被静默丢掉，
 * 而客户端「回来汇总」正是靠这些字段才能报出与平时气泡同形的总账 —— 这类缺陷
 * 单测和字符串断言都发现不了。
 *
 * 【批次判定现在归路由】running 的上升沿记开局、下降沿算用量并推 done。所以这里
 * 通过翻转 agents 桩的状态来驱动，而不是发 agent/status 事件。
 */
test('端到端：最后一个 agent 收工后 state 里的 done 必须带齐六个数值字段', async () => {
  // 【时间戳必须晚于 runningSince】foldTodayUsage 只统计 time >= 开局时刻的事件，
  // 所以事件时间要在 snapshotEvents() 被调用时现取（Date.now()），不能提前算好 ——
  // 提前取值会卡在"同一毫秒才通过"的 flaky 边界上。
  const session = {
    snapshotEvents: () => {
      const at = Date.now();
      return [
        { type: 'request/context', data: { model: 'deepseek-v4-flash' }, time: at },
        {
          type: 'assistant/message',
          time: at,
          data: {
            turn: 1,
            step: 1,
            usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      ];
    },
  };
  const agents = [{ id: 'main', status: 'running' }];
  const h = makeCtx({
    sessions: { list: () => [session] },
    agents: { list: () => agents.slice(), roots: () => [] },
  });
  apply(h.ctx, h.ctx.fiber.config);

  // 第一次轮询：有 agent 在跑 → 开窗口（并补记开局时刻）
  const opened = await hit(h.routes, '/api/whale-pet/state');
  assert.equal(opened.json.running, true, '在跑时必须报 running=true');
  assert.equal(opened.json.items.filter((item) => item.type === 'done').length, 0, '开局不该有 done');

  // 收工
  agents[0].status = 'idle';
  const closed = await hit(h.routes, '/api/whale-pet/state');
  assert.equal(closed.json.running, false, '收工后 running 必须为 false（三种提示的闸门依据）');
  const done = closed.json.items.find((item) => item.type === 'done');
  assert.ok(done !== undefined, '收工后队列里必须有一条 done');
  assert.equal(typeof done.durSec, 'number', 'done 必须带 durSec');
  for (const key of ['tokens', 'costCny', 'costHitCny', 'costMissCny', 'costOutCny']) {
    assert.equal(typeof done[key], 'number', 'done 缺少数值字段：' + key);
  }
  assert.equal(done.tokens, 2_000_000, 'tokens 应为未命中输入 + 输出');
  const buckets = Math.round((done.costHitCny + done.costMissCny + done.costOutCny) * 100) / 100;
  assert.equal(buckets, done.costCny, '三桶之和必须等于总额（否则汇总气泡的明细自相矛盾）');
  assert.ok(done.costCny > 0, '有用量就必须算出金额');
  assert.ok(!done.message.includes('这一轮任务已经搞定啦'), '算得出用量时不得退回兜底文案');

  // 再轮询一次：窗口已关，不得再重复推 done
  const again = await hit(h.routes, '/api/whale-pet/state');
  assert.equal(again.json.items.filter((item) => item.type === 'done').length, 0, '不得重复入队 done');
});

/**
 * 回归：子代理收工**不得**结束这一批。
 *
 * 【真实故障】DSH 的 agent/status 对每个 agent 都发（payload 是 { agent, status }），
 * 旧实现没过滤 agent —— 子代理一结束就把 runningSince 清零、还用掉 4 秒冷却，
 * 于是主任务真正收尾时 taskSince 已是 0，气泡只剩「这一轮任务已经搞定啦～」，
 * 既没用时也没花费（用户截图里的就是这样）。
 */
test('回归：中途有子代理收工，这一批结束时仍必须算出用量', async () => {
  const session = {
    snapshotEvents: () => {
      const at = Date.now();
      return [
        { type: 'request/context', data: { model: 'deepseek-v4-flash' }, time: at },
        {
          type: 'assistant/message',
          time: at,
          data: {
            turn: 1,
            step: 1,
            usage: { inputTokens: 500_000, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      ];
    },
  };
  const agents = [{ id: 'main', status: 'running' }, { id: 'sub', status: 'running' }];
  const h = makeCtx({
    sessions: { list: () => [session] },
    agents: { list: () => agents.slice(), roots: () => [] },
  });
  apply(h.ctx, h.ctx.fiber.config);

  await hit(h.routes, '/api/whale-pet/state');          // 开局
  agents.splice(1, 1);                                  // 子代理收工，主 agent 还在跑
  const mid = await hit(h.routes, '/api/whale-pet/state');
  assert.equal(mid.json.running, true, '子代理收工后仍有人在跑');
  assert.equal(
    mid.json.items.filter((item) => item.type === 'done').length,
    0,
    '子代理收工不得推出 done（那会把这一批提前结束）',
  );

  agents[0].status = 'idle';                            // 主 agent 收工
  const end = await hit(h.routes, '/api/whale-pet/state');
  const done = end.json.items.find((item) => item.type === 'done');
  assert.ok(done !== undefined, '整批结束后必须有一条 done');
  assert.equal(typeof done.tokens, 'number', '带子代理的这一批也必须算出 tokens');
  assert.equal(typeof done.costCny, 'number', '带子代理的这一批也必须算出花费');
  assert.ok(!done.message.includes('这一轮任务已经搞定啦'), '不得退回兜底文案');
});

// ---------------------------------------------------------------------------
// issue #10：尺寸 / 位置（size / posX / posY）的读写链路
// ---------------------------------------------------------------------------
test('issue #10：schema 里 posX/posY 存在、无默认值且 volatile', () => {
  for (const key of ['size', 'position', 'posX', 'posY']) {
    assert.ok(new RegExp('^  ' + key + ': Schema\\.', 'm').test(HOST_SOURCE), 'Config 缺少字段 ' + key);
  }
  // 无默认值 = "未设置"语义：settings 的表单投影会略过它们，
  // 客户端据此判定"跟随角落"还是"固定像素位置"（有默认值就永远进自定义模式了）。
  assert.ok(/^  posX: Schema\.number\(\)\.volatile\(\),/m.test(HOST_SOURCE), 'posX 必须是无默认值的 volatile number');
  assert.ok(/^  posY: Schema\.number\(\)\.volatile\(\),/m.test(HOST_SOURCE), 'posY 必须是无默认值的 volatile number');
});

test('issue #10 第三点：hidden 开关存在、默认 false（不隐藏）且 volatile', () => {
  // 默认必须是 false：升级后没人愿意一觉醒来宠物不见了
  assert.ok(/^  hidden: Schema\.boolean\(\)\.default\(false\)\.volatile\(\),/m.test(HOST_SOURCE),
    'hidden 必须是 default(false) 的 volatile 布尔（即时生效、默认显示）');
  // 它必须是"隐藏本体"而不是"关掉插件行"：插件行的开关会连费用 pill / 看板 / 设置面板一起干掉
  assert.ok(HOST_SOURCE.includes("'/api/whale-pet/settings'"), '设置路由照旧（隐藏不影响任何路由）');
});

test('issue #10：设置路由把尺寸/位置的 set 与 unset 原样透传给 settings.mutate', async () => {
  const h = makeCtx();
  apply(h.ctx, h.ctx.fiber.config);

  // 编辑框「保存」/ 面板「应用」：尺寸与位置一次性写入
  const ops = [
    { op: 'set', path: ['size'], value: 320 },
    { op: 'set', path: ['posX'], value: 800 },
    { op: 'set', path: ['posY'], value: 500 },
  ];
  const saved = await hit(h.routes, '/api/whale-pet/settings', { method: 'POST', body: JSON.stringify({ ops }) });
  assert.equal(saved.status, 200, '保存必须 200');
  assert.deepEqual(saved.json, { ok: true });
  assert.equal(h.mutations.length, 1, '必须正好调用一次 mutate');
  assert.equal(h.mutations[0].ns, 'pet', '必须按插件行的 entry id 寻址');
  assert.deepEqual(h.mutations[0].ops, ops, '操作数组必须原样透传（不许改写路径或值）');

  // 面板「恢复默认角落」：清掉像素位置 → 回到 position 角落
  const resetOps = [{ op: 'unset', path: ['posX'] }, { op: 'unset', path: ['posY'] }];
  const reset = await hit(h.routes, '/api/whale-pet/settings', { method: 'POST', body: JSON.stringify({ ops: resetOps }) });
  assert.equal(reset.status, 200);
  assert.deepEqual(h.mutations[1].ops, resetOps, 'unset 必须一并透传（否则清不掉像素位置）');
});

test('issue #10：设置读接口同时返回 value 与 writable（只读实例要能禁用几何控件）', async () => {
  const h = makeCtx({ config: { size: 300, posX: 640, posY: 480 } });
  apply(h.ctx, h.ctx.fiber.config);
  const got = await hit(h.routes, '/api/whale-pet/settings');
  assert.equal(got.status, 200);
  assert.equal(got.json.value.size, 300, '尺寸必须回读得到');
  assert.equal(got.json.value.posX, 640, 'X 必须回读得到');
  assert.equal(got.json.value.posY, 480, 'Y 必须回读得到');
  assert.equal(got.json.writable, true);

  const readOnly = makeCtx({ writable: false });
  apply(readOnly.ctx, readOnly.ctx.fiber.config);
  const denied = await hit(readOnly.routes, '/api/whale-pet/settings');
  assert.equal(denied.json.writable, false, '只读实例必须如实上报 writable=false');
});
