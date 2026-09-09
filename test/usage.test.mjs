/**
 * dsh-whale-girl-pet 用量与计费单测（纯逻辑，无外部依赖）。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTaskUsage,
  computeTodayUsage,
  foldTodayUsage,
  fmtTokens,
  isPeakBeijing,
  money,
  rateAt,
  taskSummaryLines,
  tierOfModel,
} from '../lib/usage.js';

const at = (text) => Date.parse(text);

/** 浮点金额比较（fold 内部保留原始浮点）。 */
const near = (actual, expected) => assert.ok(
  Math.abs(actual - expected) < 1e-9,
  `expected ${expected}, got ${actual}`,
);

const header = (model, time = 0) => ({
  type: 'request/header',
  time,
  data: { header: { config: { provider: 'deepseek-official', model } } },
});
const message = (turn, step, time, usage) => ({ type: 'assistant/message', time, data: { turn, step, usage } });
const attempt = (turn, step, time, usage) => ({
  type: 'assistant/attempt',
  time,
  data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] },
});
const retry = (turn, step, time) => ({ type: 'llm/retry-started', time, data: { turn, step } });
const session = (events) => ({ snapshotEvents: () => events });
const ctxOf = (...sessions) => ({ get: (name) => (name === 'sessions' ? { list: () => sessions } : undefined) });

test('峰谷判定：工作日两个窗口为高峰，周末与其余时间为空闲', () => {
  assert.equal(isPeakBeijing(at('2026-09-09T00:59:59.999Z')), false, '09:00 之前');
  assert.equal(isPeakBeijing(at('2026-09-09T01:00:00.000Z')), true, '09:00 起（含）');
  assert.equal(isPeakBeijing(at('2026-09-09T04:00:00.000Z')), false, '12:00 止（不含）');
  assert.equal(isPeakBeijing(at('2026-09-09T06:00:00.000Z')), true, '14:00 起');
  assert.equal(isPeakBeijing(at('2026-09-09T10:00:00.000Z')), false, '18:00 止');
  assert.equal(isPeakBeijing(at('2026-09-12T02:00:00.000Z')), false, '周六 10:00 空闲');
  assert.equal(isPeakBeijing(at('2026-09-13T02:00:00.000Z')), false, '周日 10:00 空闲');
  assert.equal(isPeakBeijing(at('2026-09-11T02:00:00.000Z')), true, '周五 10:00 高峰');
});

test('模型分档：含 flash 走 flash，其余走 pro', () => {
  assert.equal(tierOfModel('deepseek-v4-flash'), 'flash');
  assert.equal(tierOfModel('deepseek-v4-flash-vision-exp'), 'flash');
  assert.equal(tierOfModel('deepseek-v4.1-flash-expires-on-0910'), 'flash');
  assert.equal(tierOfModel('deepseek-v4-pro'), 'pro');
  assert.equal(tierOfModel(''), 'pro');
});

test('价目表：flash 在 2026-09-10 12:00 北京时间换价', () => {
  const before = rateAt('deepseek-v4-flash', at('2026-09-10T03:59:59.000Z')); // 11:59 高峰
  assert.equal(before.regime, 'peak');
  assert.equal(before.hit, 0.1);
  assert.equal(before.miss, 3);
  assert.equal(before.out, 9);

  const after = rateAt('deepseek-v4-flash', at('2026-09-10T04:00:00.000Z')); // 12:00 空闲
  assert.equal(after.regime, 'off');
  assert.equal(after.hit, 0.02);
  assert.equal(after.miss, 1);
  assert.equal(after.out, 4);

  const afterPeak = rateAt('deepseek-v4-flash', at('2026-09-10T06:00:00.000Z')); // 14:00 高峰
  assert.equal(afterPeak.regime, 'peak');
  assert.equal(afterPeak.hit, 0.04);
  assert.equal(afterPeak.miss, 2);
  assert.equal(afterPeak.out, 8);
});

test('价目表：pro 不受 2026-09-10 调价影响', () => {
  const before = rateAt('deepseek-v4-pro', at('2026-09-09T00:00:00.000Z'));
  const after = rateAt('deepseek-v4-pro', at('2026-09-11T00:00:00.000Z'));
  assert.equal(before.miss, 4.5);
  assert.equal(after.miss, 4.5);
  assert.equal(after.out, 13.5);
});

test('价目表：2026-08-17 之前为平价档（不分峰谷）', () => {
  const flash = rateAt('deepseek-v4-flash', at('2026-08-01T01:00:00.000Z'));
  assert.equal(flash.regime, 'flat');
  assert.equal(flash.hit, 0.02);
  assert.equal(flash.miss, 1);
  assert.equal(flash.out, 2);
  const pro = rateAt('deepseek-v4-pro', at('2026-08-01T01:00:00.000Z'));
  assert.equal(pro.miss, 3);
  assert.equal(pro.out, 6);
});

test('折叠：缓存写入按未命中价计，三桶费用分开累加', () => {
  const events = [
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), {
      inputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 500_000,
      outputTokens: 250_000,
    }),
  ];
  const fold = foldTodayUsage(events, 0);
  assert.deepEqual(fold.totals, { input: 1_000_000, cacheRead: 2_000_000, cacheWrite: 500_000, output: 250_000 });
  near(fold.costs.hit, 0.1); // 2M × 0.05 / 1M
  near(fold.costs.miss, 2.25); // (1M + 0.5M) × 1.5 / 1M
  near(fold.costs.out, 1.125); // 0.25M × 4.5 / 1M
  near(fold.regimes.off, 3.475);
});

test('折叠：同一 turn/step 后到的样本替换先到的样本', () => {
  const events = [
    header('deepseek-v4-flash'),
    attempt(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    message(1, 1, at('2026-09-09T00:00:01.000Z'), { inputTokens: 2_000_000, outputTokens: 0 }),
  ];
  const fold = foldTodayUsage(events, 0);
  assert.equal(fold.totals.input, 2_000_000);
  near(fold.costs.miss, 3); // 只计一次：2M × 1.5 / 1M
});

test('折叠：llm/retry-started 让重试的两次调用都计费', () => {
  const events = [
    header('deepseek-v4-flash'),
    attempt(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    retry(1, 1, at('2026-09-09T00:00:01.000Z')),
    message(1, 1, at('2026-09-09T00:00:02.000Z'), { inputTokens: 2_000_000, outputTokens: 0 }),
  ];
  const fold = foldTodayUsage(events, 0);
  assert.equal(fold.totals.input, 3_000_000);
  near(fold.costs.miss, 4.5); // 1M + 2M，各按 1.5 计
});

test('折叠：从 request/header 追踪模型，切换模型后按各自单价计费', () => {
  const events = [
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    header('deepseek-v4-pro'),
    message(1, 2, at('2026-09-09T00:00:02.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ];
  const fold = foldTodayUsage(events, 0);
  near(fold.costs.miss, 1.5 + 4.5);
  assert.deepEqual([...fold.models].sort(), ['deepseek-v4-flash', 'deepseek-v4-pro']);
});

test('折叠：assistant/chunk（旧版 DSH）仍可计费', () => {
  const events = [
    header('deepseek-v4-flash'),
    {
      type: 'assistant/chunk',
      time: at('2026-09-09T00:00:00.000Z'),
      data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 0 } } },
    },
  ];
  near(foldTodayUsage(events, 0).costs.miss, 1.5);
});

test('computeTaskUsage 返回总额与三桶费用', () => {
  const events = [
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), {
      inputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      outputTokens: 250_000,
    }),
  ];
  const usage = computeTaskUsage(ctxOf(session(events)), 0);
  assert.equal(usage.ok, true);
  assert.equal(usage.total, 3_250_000);
  assert.equal(usage.costCny, 2.725); // 0.1 + 1.5 + 1.125
  assert.equal(usage.costHitCny, 0.1);
  assert.equal(usage.costMissCny, 1.5);
  assert.equal(usage.costOutCny, 1.125);
});

test('computeTaskUsage 只统计 sinceMs 之后的事件', () => {
  const events = [
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    message(2, 1, at('2026-09-09T01:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ];
  const usage = computeTaskUsage(ctxOf(session(events)), at('2026-09-09T00:30:00.000Z'));
  assert.equal(usage.total, 1_000_000);
  assert.equal(usage.costMissCny, 3); // 09:00 高峰，flash 3.0/1M
});

test('computeTaskUsage 无用量时返回 ok:false', () => {
  const usage = computeTaskUsage(ctxOf(session([header('deepseek-v4-flash')])), 0);
  assert.equal(usage.ok, false);
  assert.equal(usage.total, 0);
});

test('computeTodayUsage 排除今天 0 点（北京时间）之前的事件', () => {
  const bjOffset = 8 * 3600e3;
  const todayStart = Math.floor((Date.now() + bjOffset) / 864e5) * 864e5 - bjOffset;
  const events = [
    header('deepseek-v4-flash'),
    message(1, 1, todayStart - 60_000, { inputTokens: 1_000_000, outputTokens: 0 }),
    message(2, 1, todayStart + 60_000, { inputTokens: 1_000_000, outputTokens: 0 }),
  ];
  const usage = computeTodayUsage(ctxOf(session(events)));
  assert.equal(usage.ok, true);
  assert.equal(usage.tokens.total, 1_000_000);
  assert.equal(typeof usage.costHitCny, 'number');
  assert.equal(typeof usage.costMissCny, 'number');
  assert.equal(typeof usage.costOutCny, 'number');
});

test('computeTodayUsage 在会话服务缺失时返回错误', () => {
  const usage = computeTodayUsage({ get: () => undefined });
  assert.equal(usage.ok, false);
  assert.match(usage.error, /会话服务不可用/);
});

test('taskSummaryLines 输出用时/消耗/花费 + 三桶费用', () => {
  const lines = taskSummaryLines('2分35秒', {
    ok: true,
    total: 1_200_000,
    costCny: 3.21,
    costHitCny: 0.28,
    costMissCny: 0.02,
    costOutCny: 2.91,
  });
  assert.deepEqual(lines, [
    '用时 2分35秒',
    '消耗 1.20M tokens',
    '花费 ≈¥3.21',
    '· 缓存命中 ≈¥0.28',
    '· 缓存未命中 ≈¥0.02',
    '· 输出 ≈¥2.91',
  ]);
});

test('taskSummaryLines 在无用量时只显示用时', () => {
  assert.deepEqual(taskSummaryLines('12秒', { ok: false, total: 0 }), ['用时 12秒']);
});

test('fmtTokens 与 money 的显示口径', () => {
  assert.equal(fmtTokens(1_234_567), '1.23M');
  assert.equal(fmtTokens(12_345), '12.3k');
  assert.equal(fmtTokens(999), '999');
  assert.equal(money(0), '≈¥0.00');
  assert.equal(money(0.004), '<¥0.01');
  assert.equal(money(3.21), '≈¥3.21');
});
