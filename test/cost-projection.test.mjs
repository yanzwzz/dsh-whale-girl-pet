/**
 * dsh-whale-girl-pet costUsage 投影单测（宿主半侧，费用 pill 的数据源）。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCostUsageProjection } from '../lib/cost-projection.js';

const at = (text) => Date.parse(text);
const projection = createCostUsageProjection();

const header = (model, time = 0) => ({
  type: 'request/header',
  time,
  data: { header: { config: { provider: 'deepseek-official', model } } },
});
const message = (turn, step, time, usage, id = `msg-${turn}-${step}`) => ({
  type: 'assistant/message',
  time,
  data: { turn, step, usage, message: { id } },
});
const attempt = (turn, step, time, usage) => ({
  type: 'assistant/attempt',
  time,
  data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] },
});
const retry = (turn, step, time) => ({ type: 'llm/retry-started', time, data: { turn, step } });
const feed = (events) => events.reduce((state, event) => projection.apply(state, event), projection.init());
const view = (events) => projection.wire.view(feed(events));

test('离线价目：空闲时段按三桶金额拆分', () => {
  const result = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), {
      inputTokens: 1_000_000,
      cacheReadTokens: 2_000_000,
      outputTokens: 250_000,
    }),
  ]);
  assert.equal(result.currency, 'CNY');
  assert.equal(result.cacheReadCny, 0.1); // 2M × 0.05 / 1M
  assert.equal(result.missCny, 1.5); // 1M × 1.5 / 1M
  assert.equal(result.outputCny, 1.125); // 0.25M × 4.5 / 1M
  assert.equal(result.totalCny, 2.725);
  assert.equal(result.peakCny, 0);
  assert.equal(result.offPeakCny, 2.725);
  assert.equal(result.pricedRequests, 1);
  assert.equal(result.unpricedRequests, 0);
});

test('高峰时段金额翻倍并计入 peakCny', () => {
  const result = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T01:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.equal(result.missCny, 3);
  assert.equal(result.peakCny, 3);
  assert.equal(result.offPeakCny, 0);
});

test('2026-09-10 12:00 起 flash 使用新价目', () => {
  const before = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-10T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  const after = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-10T04:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.equal(before.missCny, 1.5);
  assert.equal(after.missCny, 1);
});

test('同一 turn/step 后到的样本替换先到的样本', () => {
  const result = view([
    header('deepseek-v4-flash'),
    attempt(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    message(1, 1, at('2026-09-09T00:00:01.000Z'), { inputTokens: 2_000_000, outputTokens: 0 }),
  ]);
  assert.equal(result.missCny, 3);
  assert.equal(result.pricedRequests, 1);
});

test('llm/retry-started 让重试的两次调用都计费', () => {
  const result = view([
    header('deepseek-v4-flash'),
    attempt(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    retry(1, 1, at('2026-09-09T00:00:01.000Z')),
    message(1, 1, at('2026-09-09T00:00:02.000Z'), { inputTokens: 2_000_000, outputTokens: 0 }),
  ]);
  assert.equal(result.missCny, 4.5);
  assert.equal(result.pricedRequests, 2);
});

test('切换模型后按各自单价计费', () => {
  const result = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    header('deepseek-v4-pro'),
    message(1, 2, at('2026-09-09T00:00:02.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.equal(result.missCny, 6); // 1.5 + 4.5
  assert.equal(result.pricedRequests, 2);
});

test('没有 request/header 的结算记为未定价', () => {
  const result = view([
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
  ]);
  assert.equal(result.totalCny, 0);
  assert.equal(result.pricedRequests, 0);
  assert.equal(result.unpricedRequests, 1);
});

test('无用量的事件不改变状态引用', () => {
  const state = projection.init();
  assert.equal(projection.apply(state, { type: 'step/start', time: 0, data: { turn: 1, step: 1 } }), state);
});

test('状态与线上视图都能通过 schema 校验', () => {
  const state = feed([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, outputTokens: 1_000 }),
  ]);
  projection.stateSchema.parse(state);
  projection.wire.viewSchema.parse(projection.wire.view(state));
});

test('视图带每轮金额与消息归属（本轮费用 pill 的数据源）', () => {
  const result = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }, 'msg-a'),
    message(2, 1, at('2026-09-09T00:00:02.000Z'), { inputTokens: 2_000_000, outputTokens: 0 }, 'msg-b'),
  ]);
  assert.equal(JSON.stringify(result.byTurn.map((row) => row.turn)), JSON.stringify([1, 2]));
  assert.equal(result.byTurn[0].missCny, 1.5);
  assert.equal(result.byTurn[0].totalCny, 1.5);
  assert.equal(result.byTurn[1].missCny, 3);
  assert.equal(result.messageTurns['msg-a'], 1);
  assert.equal(result.messageTurns['msg-b'], 2);
});

test('同一轮多步累计到同一个 byTurn 行', () => {
  const result = view([
    header('deepseek-v4-flash'),
    message(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }, 'msg-a'),
    message(1, 2, at('2026-09-09T00:00:02.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }, 'msg-b'),
  ]);
  assert.equal(result.byTurn.length, 1);
  assert.equal(result.byTurn[0].missCny, 3);
  assert.equal(result.messageTurns['msg-a'], 1);
  assert.equal(result.messageTurns['msg-b'], 1);
});

test('替换样本时 byTurn 不会重复累计', () => {
  const result = view([
    header('deepseek-v4-flash'),
    attempt(1, 1, at('2026-09-09T00:00:00.000Z'), { inputTokens: 1_000_000, outputTokens: 0 }),
    message(1, 1, at('2026-09-09T00:00:01.000Z'), { inputTokens: 2_000_000, outputTokens: 0 }, 'msg-a'),
  ]);
  assert.equal(result.byTurn.length, 1);
  assert.equal(result.byTurn[0].missCny, 3);
});
