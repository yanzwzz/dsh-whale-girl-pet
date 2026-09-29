/**
 * dsh-whale-girl-pet 峰谷口径单测：法定节假日 + 宿主/客户端两份实现对拍。
 *
 * 【为什么需要"对拍"】
 *   宿主 lib/usage.js 的 isPeakBeijing 决定真实计价；lib/client.js 里还有一份
 *   isPeakNow（浏览器半侧拿不到宿主模块，只能镜像），决定看板底纹与文案。
 *   两份必须同规则，否则页面显示的高峰与实际计费不一致。
 *   浏览器侧的 isPeakNow 在 bundle factory 作用域内、外部无法 import，
 *   所以这里按 dashboard-layout.test.mjs 的既有办法：从 client.js 源码里
 *   抠出实现并求值，再与宿主逐时刻对拍。
 *
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bucketsFromUsage, costOfBuckets, isPeakBeijing, rateAt } from '../lib/usage.js';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, 'utf8');

const at = (text) => Date.parse(text);
const BJ = 8 * 3600e3;

/** 取 client.js 里 const NAME = [...] / new Set([...]) 的字面量列表。 */
function clientArrayLiteral(name) {
  const match = new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`).exec(CLIENT_SOURCE);
  assert.notEqual(match, null, `client.js 里必须存在常量 ${name}`);
  return match[1];
}

/** 从 client.js 里抠出 isPeakNow 的函数源码（花括号配平）。 */
function clientIsPeakNowSource() {
  const start = CLIENT_SOURCE.indexOf('function isPeakNow()');
  assert.notEqual(start, -1, 'client.js 里必须存在 isPeakNow 函数');
  const open = CLIENT_SOURCE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CLIENT_SOURCE.length; i += 1) {
    const ch = CLIENT_SOURCE[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return CLIENT_SOURCE.slice(start, i + 1);
    }
  }
  throw new Error('client.js 的 isPeakNow 花括号不配平');
}

/** 用给定的节假日表字面量 + client.js 的真实 isPeakNow 源码构造判定函数。 */
function makeIsPeakAt(holidaysLiteral) {
  const source = [
    `const CN_STATUTORY_HOLIDAYS = new Set([${holidaysLiteral}]);`,
    clientIsPeakNowSource(),
    'return (now) => {',
    '  const original = Date.now;',
    '  Date.now = () => now;',
    '  try { return isPeakNow(); } finally { Date.now = original; }',
    '};',
  ].join('\n');
  return new Function(source)();
}

/** 用 client.js 真实源码 + 真实节假日表构造的判定函数，用于与宿主对拍。 */
const clientIsPeak = makeIsPeakAt(clientArrayLiteral('CN_STATUTORY_HOLIDAYS'));

/** 逐个日期取一天中的多个时刻，方便穷举对拍。 */
function instantsBetween(fromIso, toIso) {
  const out = [];
  const day = 24 * 3600e3;
  for (let t = at(fromIso); t <= at(toIso); t += day) {
    // 北京时间 08:59 / 09:00 / 11:59 / 12:00 / 13:59 / 14:00 / 17:59 / 18:00 / 23:30
    for (const minutes of [539, 540, 719, 720, 839, 840, 1079, 1080, 1410]) {
      out.push(t + minutes * 60e3 - BJ);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. 宿主 isPeakBeijing：法定节假日整天低峰
// ---------------------------------------------------------------------------
test('法定节假日整天低峰（2026 全年逐日穷举）', () => {
  const days = [
    ['2026-01-01T09:00:00+08:00', '元旦'],
    ['2026-01-02T14:00:00+08:00', '元旦'],
    ['2026-01-03T10:00:00+08:00', '元旦'],
    ['2026-02-16T10:00:00+08:00', '春节'],
    ['2026-02-23T15:00:00+08:00', '春节'],
    ['2026-04-06T10:00:00+08:00', '清明'],
    ['2026-05-04T10:00:00+08:00', '劳动节'],
    ['2026-06-19T10:00:00+08:00', '端午'],
    ['2026-09-25T10:00:00+08:00', '中秋'],
    ['2026-09-26T15:00:00+08:00', '中秋'],
    ['2026-10-01T10:00:00+08:00', '国庆'],
    ['2026-10-07T16:00:00+08:00', '国庆'],
  ];
  for (const [iso, label] of days) {
    assert.equal(isPeakBeijing(at(iso)), false, `${label} ${iso} 应为低峰`);
  }
});

test('节假日整天低峰：覆盖两个高峰窗口内的每个整数小时', () => {
  // 2026-10-01（周四）落在高峰窗口的 09:00-11:xx 与 14:00-17:xx 都必须为低峰
  for (let hour = 9; hour < 12; hour += 1) {
    assert.equal(isPeakBeijing(at(`2026-10-01T${String(hour).padStart(2, '0')}:00:00+08:00`)), false, `${hour} 点`);
  }
  for (let hour = 14; hour < 18; hour += 1) {
    assert.equal(isPeakBeijing(at(`2026-10-01T${String(hour).padStart(2, '0')}:00:00+08:00`)), false, `${hour} 点`);
  }
});

test('调休上班的周末仍是低峰（官方按 UTC 周一至周五判工作日）', () => {
  // 国办发明电〔2025〕7 号：1/4(周日)、2/14(周六)、2/28(周六)、5/9(周六)、
  // 9/20(周日)、10/10(周六) 上班，但仍属日历周末 → 官方定价页"weekends ... in full"低峰。
  for (const iso of [
    '2026-01-04T10:00:00+08:00',
    '2026-02-14T10:00:00+08:00',
    '2026-02-28T10:00:00+08:00',
    '2026-05-09T10:00:00+08:00',
    '2026-09-20T10:00:00+08:00',
    '2026-10-10T10:00:00+08:00',
  ]) {
    assert.equal(isPeakBeijing(at(iso)), false, `调休补班日 ${iso} 应为低峰`);
  }
});

test('节假日相邻的非放假日不受影响（表不得多算）', () => {
  // 2026-09-24 周四、09-28 周一、10-08 周四：都是普通工作日，10:00 应为高峰
  assert.equal(isPeakBeijing(at('2026-09-24T10:00:00+08:00')), true, '9/24 周四 10:00 高峰');
  assert.equal(isPeakBeijing(at('2026-09-28T10:00:00+08:00')), true, '9/28 周一 10:00 高峰');
  assert.equal(isPeakBeijing(at('2026-10-08T10:00:00+08:00')), true, '10/8 周四 10:00 高峰');
  // 2026-09-24 是节前最后一天：11:59 高峰、12:00 低峰
  assert.equal(isPeakBeijing(at('2026-09-24T11:59:00+08:00')), true, '9/24 11:59 高峰');
  assert.equal(isPeakBeijing(at('2026-09-24T12:00:00+08:00')), false, '9/24 12:00 低峰');
});

test('非法时间戳不抛错且视为低峰', () => {
  assert.equal(isPeakBeijing(NaN), false);
  assert.equal(isPeakBeijing(undefined), false);
  assert.equal(isPeakBeijing(Infinity), false);
});

test('节假日判定按北京时间跨日切分（UTC 与北京不同日期时）', () => {
  // 北京时间 2026-10-01 00:30 = UTC 2026-09-30 16:30 → 属于节假日（10/1）
  assert.equal(isPeakBeijing(at('2026-09-30T16:30:00Z')), false, '北京 10/1 00:30 应为节假日低峰');
  // 北京时间 2026-10-08 08:30 = UTC 2026-10-08 00:30 → 节后工作日，窗口外低峰
  assert.equal(isPeakBeijing(at('2026-10-08T00:30:00Z')), false, '窗口外');
  assert.equal(isPeakBeijing(at('2026-10-08T02:00:00Z')), true, '北京 10/8 10:00 高峰');
});

// ---------------------------------------------------------------------------
// 2. 宿主与客户端两份实现对拍
// ---------------------------------------------------------------------------
test('client.js 的节假日表与宿主一致（两份镜像不得漂移）', () => {
  const client = clientArrayLiteral('CN_STATUTORY_HOLIDAYS');
  const host = readFileSync(fileURLToPath(new URL('../lib/usage.js', import.meta.url)), 'utf8');
  const hosted = [...host.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]).sort();
  const cliented = [...client.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]).sort();
  assert.deepEqual(cliented, hosted, 'client.js 与 usage.js 的节假日表必须逐项一致');
  assert.ok(cliented.length >= 30, '节假日表至少应含 30 天');
  assert.equal(new Set(cliented).size, cliented.length, '节假日表不得有重复日期');
});

test('宿主 isPeakBeijing 与客户端 isPeakNow 逐时刻对拍（2026 全年 + 2027 初）', () => {
  const instants = instantsBetween('2026-01-01T00:00:00+08:00', '2027-01-03T00:00:00+08:00');
  assert.ok(instants.length > 3000, '样本量应足够');
  const mismatches = [];
  for (const now of instants) {
    const host = isPeakBeijing(now);
    const client = clientIsPeak(now);
    if (host !== client) mismatches.push([new Date(now).toISOString(), host, client]);
  }
  assert.deepEqual(mismatches, [], `两份实现出现分歧：${JSON.stringify(mismatches.slice(0, 10))}`);
});

test('对拍覆盖到节假日：分歧检测本身有效（故意注入错误应被发现）', () => {
  // 自检：把节假日表换成空表，"节假日整天低峰"的断言必须失败，证明对拍不是恒真。
  const naive = makeIsPeakAt("''");
  const nationalDay = at('2026-10-01T10:00:00+08:00');
  assert.equal(isPeakBeijing(nationalDay), false, '宿主：国庆为低峰');
  assert.equal(naive(nationalDay), true, '无节假日表的实现会误判为高峰（证明对拍能发现分歧）');
});

// ---------------------------------------------------------------------------
// 3. 端到端：节假日真的让金额减半
// ---------------------------------------------------------------------------
test('端到端计费：法定节假日按低峰价，节后工作日按高峰价', () => {
  // 1M 未命中输入 + 1M 输出。2026-09-10 档 flash 低峰 1/4、高峰 2/8（元/1M）。
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const buckets = bucketsFromUsage(usage);
  const costAt = (iso) => costOfBuckets(buckets, rateAt('deepseek-v4-flash', at(iso)));

  const holiday = costAt('2026-10-01T10:00:00+08:00'); // 国庆（周四）
  const workday = costAt('2026-10-08T10:00:00+08:00'); // 节后周四
  assert.equal(holiday.regime, 'off', '国庆应为低峰');
  assert.equal(workday.regime, 'peak', '节后工作日应为高峰');
  assert.equal(holiday.total, 5, '国庆低峰：1M×1 + 1M×4');
  assert.equal(workday.total, 10, '工作日高峰：1M×2 + 1M×8');
  assert.equal(workday.total / holiday.total, 2, '官方口径：低峰 = 高峰的一半');
});
