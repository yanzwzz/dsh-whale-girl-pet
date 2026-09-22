/**
 * dsh-whale-girl-pet 子会话费用汇总单测（纯逻辑）。
 *
 * 覆盖三件事：
 *   1. lib/subtree.js 的会话树 / 后代 / 按轮归集；
 *   2. lib/usage-ledger.js 新增的"按会话累计"（sessionCost）；
 *   3. computeTodayUsage(ctx, ledger) 走账本时**包含子会话**——这正是
 *      "内部统计的金额不包含子会话"的回归测试。
 *
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLineage,
  descendantIds,
  ledgerCostView,
  subtreeCost,
  turnAt,
  turnWindowsOf,
  zeroLedgerCost,
} from '../lib/subtree.js';
import { computeTodayUsage, costOfBuckets, bucketsFromUsage, rateAt } from '../lib/usage.js';
import { createUsageLedger } from '../lib/usage-ledger.js';

const at = (text) => Date.parse(text);
/**
 * 固定时钟 = 测试启动的真实时刻。
 *
 * 注意：`computeTodayUsage` 的**回退路径**（只扫在线会话）内部用真实
 * `Date.now()` 切"今天"，所以这里不能像别的测试那样把时钟钉在 2026-09-09
 * （那样事件会落在"今天 0 点"之前被过滤）。账本路径则用这里注入的 NOW，
 * 两条路径看到同一个时刻，断言才能对齐。
 */
const NOW = Date.now();
const money = (value) => Math.round(value * 1e4) / 1e4;

let seqCounter = 0;
const nextSeq = () => (seqCounter += 1);

const header = (model, time = NOW) => ({
  type: 'request/header',
  seq: nextSeq(),
  time,
  data: { header: { config: { provider: 'deepseek-official', model } } },
});
const message = (turn, step, time, usage, id) => ({
  type: 'assistant/message',
  seq: nextSeq(),
  time,
  data: { turn, step, usage, message: { id: id ?? `msg-${turn}-${step}` } },
});

/** flash 档在给定时刻的期望费用（避免在测试里硬编码价目表）。 */
const expectedCost = (model, timeMs, usage) =>
  costOfBuckets(bucketsFromUsage(usage), rateAt(model, timeMs)).total;

const USAGE = { inputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 500 };
const FLASH = 'deepseek-v4-flash';

const newLedger = () => createUsageLedger({ now: () => NOW });

// ============================================================================
// 会话树
// ============================================================================

test('buildLineage：按 parentSession 建父子树，重复 id 只认第一个', () => {
  const { children, created } = buildLineage([
    { id: 'root', createdAt: 1 },
    { id: 'a', parentSession: 'root', createdAt: 10 },
    { id: 'b', parentSession: 'root', createdAt: 20 },
    // 落盘那份重复出现：不能覆盖在线那份（在线在前）
    { id: 'a', parentSession: 'root', createdAt: 99 },
    { id: 'orphan', parentSession: 'missing', createdAt: 5 },
  ]);
  assert.deepEqual(children.get('root'), ['a', 'b']);
  assert.deepEqual(children.get('missing'), ['orphan']);
  assert.equal(created.get('a'), 10, '重复 id 保留第一个的 createdAt');
  assert.equal(children.get('a'), undefined);
});

test('buildLineage：容忍坏值、包装形态（{header}）与缺失 parentSession', () => {
  const { children, created } = buildLineage([
    undefined,
    null,
    { nope: true },
    { header: { id: 'wrapped', parentSession: 'p', createdAt: 7 } },
    { id: 'root' },
  ]);
  assert.deepEqual(children.get('p'), ['wrapped']);
  assert.equal(created.get('wrapped'), 7);
  assert.equal(created.has('root'), true);
});

test('descendantIds：收集全部后代（含孙代），并且不怕环形血统', () => {
  const children = new Map([
    ['root', ['a', 'b']],
    ['a', ['grand']],
    ['grand', ['root']], // 环：root 已经访问过，不能死循环
  ]);
  assert.deepEqual(descendantIds(children, 'root'), ['a', 'b', 'grand']);
  assert.deepEqual(descendantIds(children, 'nobody'), []);
});

test('turnWindowsOf / turnAt：按 turn 的事件时间取窗口，创建时刻落到对应轮', () => {
  const windows = turnWindowsOf([
    { type: 'assistant/message', time: 100, data: { turn: 1 } },
    { type: 'assistant/message', time: 200, data: { turn: 1 } },
    { type: 'assistant/message', time: 500, data: { turn: 2 } },
    { type: 'assistant/message', time: 600, data: { turn: 2 } },
  ]);
  assert.deepEqual([...windows.keys()], [1, 2]);
  assert.equal(turnAt(windows, 150), 1, '落在第 1 轮窗口内');
  assert.equal(turnAt(windows, 550), 2, '落在第 2 轮窗口内');
  assert.equal(turnAt(windows, 450), 1, '落在两轮之间 → 归到更早开始的第 1 轮');
  assert.equal(turnAt(windows, 10), 1, '早于所有轮 → 归到最早的轮');
  assert.equal(turnAt(turnWindowsOf([]), 10), undefined, '没有轮时不做归集');
});

test('subtreeCost：合计全部后代，并按"子会话创建时刻"归到父会话的轮', () => {
  const headers = [
    { id: 'root', createdAt: 0 },
    { id: 'child-1', parentSession: 'root', createdAt: 150 },   // → turn 1
    { id: 'child-2', parentSession: 'root', createdAt: 550 },   // → turn 2
    { id: 'grand', parentSession: 'child-1', createdAt: 560 },  // → 孙代，仍归 turn 2
    { id: 'unrelated', createdAt: 0 },
  ];
  const costs = {
    'child-1': { ...zeroLedgerCost(), hit: 0.1, calls: 1 },
    'child-2': { ...zeroLedgerCost(), miss: 0.2, calls: 1 },
    grand: { ...zeroLedgerCost(), out: 0.3, calls: 1 },
    unrelated: { ...zeroLedgerCost(), hit: 9, calls: 9 },
  };
  const result = subtreeCost({
    headers,
    rootSessionId: 'root',
    sessionCost: (id) => costs[id],
    rootEvents: [
      { time: 100, data: { turn: 1 } },
      { time: 200, data: { turn: 1 } },
      { time: 500, data: { turn: 2 } },
      { time: 600, data: { turn: 2 } },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 'root');
  assert.equal(result.descendants.count, 3, '不含 root 自己，也不含无关会话');
  assert.equal(result.descendants.calls, 3);
  assert.equal(result.descendants.costCny, money(0.6));
  assert.equal(result.descendants.costHitCny, money(0.1));
  assert.equal(result.descendants.costMissCny, money(0.2));
  assert.equal(result.descendants.costOutCny, money(0.3));
  assert.equal(result.descendants.tokens.total, 0, 'token 未设置时按 0');
  assert.deepEqual(Object.keys(result.byTurn).sort(), ['1', '2']);
  assert.equal(result.byTurn['1'].costCny, money(0.1));
  assert.equal(result.byTurn['2'].costCny, money(0.5));
  assert.equal(result.sessions['child-1'].costCny, money(0.1));
});

test('subtreeCost：没有子会话时是零合计，且不抛错', () => {
  const result = subtreeCost({ headers: [{ id: 'root' }], rootSessionId: 'root', sessionCost: () => undefined });
  assert.equal(result.descendants.count, 0);
  assert.equal(result.descendants.costCny, 0);
  assert.deepEqual(result.byTurn, {});
});

test('ledgerCostView：金额保留 4 位、token 汇总成 total', () => {
  const view = ledgerCostView({ ...zeroLedgerCost(), input: 10, output: 5, hit: 0.00006, calls: 2 });
  assert.equal(view.costCny, 0.0001);
  assert.equal(view.calls, 2);
  assert.deepEqual(view.tokens, { input: 10, cacheRead: 0, cacheWrite: 0, output: 5, total: 15 });
});

// ============================================================================
// 账本：按会话累计（子会话费用的数据源）
// ============================================================================

test('账本按会话累计：每个会话各记一份，互不串台', () => {
  const ledger = newLedger();
  ledger.ingest('root', header(FLASH));
  ledger.ingest('root', message(1, 1, NOW, USAGE, 'root-1'));
  ledger.ingest('child', header(FLASH));
  ledger.ingest('child', message(1, 1, NOW, USAGE, 'child-1'));

  const rootCost = ledger.sessionCost('root');
  const childCost = ledger.sessionCost('child');
  const expected = expectedCost(FLASH, NOW, USAGE);
  assert.equal(money(rootCost.hit + rootCost.miss + rootCost.out), money(expected));
  assert.equal(money(childCost.hit + childCost.miss + childCost.out), money(expected));
  assert.equal(rootCost.calls, 1);
  assert.equal(childCost.calls, 1);
  assert.equal(ledger.sessionCost('nope'), undefined);
  assert.deepEqual(ledger.sessionIds().sort(), ['child', 'root']);
});

test('账本按会话累计：同一 turn/step 的重复样本按"后到替换先到"回退，不重复计费', () => {
  const ledger = newLedger();
  ledger.ingest('child', header(FLASH));
  ledger.ingest('child', message(1, 1, NOW, USAGE, 'same'));
  ledger.ingest('child', message(1, 1, NOW, { ...USAGE, outputTokens: 1500 }, 'same'));
  const cost = ledger.sessionCost('child');
  assert.equal(cost.calls, 1, '替换而不是累加');
  assert.equal(money(cost.hit + cost.miss + cost.out), money(expectedCost(FLASH, NOW, { ...USAGE, outputTokens: 1500 })));
});

// ============================================================================
// 回归：今日用量必须包含子会话
// ============================================================================

test('computeTodayUsage：走账本时把子会话一起算进去（内部统计不再漏子代理）', () => {
  const ledger = newLedger();
  ledger.ingest('root', header(FLASH));
  ledger.ingest('root', message(1, 1, NOW, USAGE, 'root-1'));
  ledger.ingest('child', header(FLASH));
  ledger.ingest('child', message(1, 1, NOW, USAGE, 'child-1'));

  // 只扫"当前在线会话"的旧口径：子代理结束时在线集合里就没有它了
  const rootEvents = [{ type: 'request/header', time: NOW, data: { header: { config: { model: FLASH } } } },
    message(1, 1, NOW, USAGE, 'root-1')];
  const liveOnly = { get: (name) => (name === 'sessions' ? { list: () => [{ snapshotEvents: () => rootEvents }] } : undefined) };

  const withoutLedger = computeTodayUsage(liveOnly);
  const withLedger = computeTodayUsage(liveOnly, ledger);

  const one = money(expectedCost(FLASH, NOW, USAGE));
  const single = costOfBuckets(bucketsFromUsage(USAGE), rateAt(FLASH, NOW));
  assert.equal(withoutLedger.ok, true);
  assert.equal(withoutLedger.costCny, one, '旧口径只算到父会话');
  assert.equal(withLedger.source, 'ledger');
  assert.equal(withLedger.costCny, money(one * 2), '账本口径把子会话也算上');
  assert.equal(withLedger.costHitCny, money(single.hit * 2), '三桶同样含子会话');
  assert.equal(withLedger.costMissCny, money(single.miss * 2));
  assert.equal(withLedger.costOutCny, money(single.out * 2));
});

test('computeTodayUsage：没有账本时退回在线会话口径（保持向后兼容）', () => {
  const events = [
    { type: 'request/header', time: NOW, data: { header: { config: { model: FLASH } } } },
    message(1, 1, NOW, USAGE, 'only'),
  ];
  const ctx = { get: (name) => (name === 'sessions' ? { list: () => [{ snapshotEvents: () => events }] } : undefined) };
  const usage = computeTodayUsage(ctx);
  assert.equal(usage.ok, true);
  assert.equal(usage.costCny, money(expectedCost(FLASH, NOW, USAGE)));
  assert.equal(usage.sessions, 1);
  assert.equal(usage.source, undefined, '回退路径不带 source 标记');
});

test('computeTodayUsage：账本坏掉时退回在线口径，不抛错', () => {
  const events = [
    { type: 'request/header', time: NOW, data: { header: { config: { model: FLASH } } } },
    message(1, 1, NOW, USAGE, 'only'),
  ];
  const ctx = { get: (name) => (name === 'sessions' ? { list: () => [{ snapshotEvents: () => events }] } : undefined) };
  const broken = { snapshot: () => { throw new Error('boom'); } };
  const usage = computeTodayUsage(ctx, broken);
  assert.equal(usage.ok, true);
  assert.equal(usage.costCny, money(expectedCost(FLASH, NOW, USAGE)));
});
