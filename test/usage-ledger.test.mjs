/**
 * dsh-whale-girl-pet 分时段账本单测（宿主半侧，气泡看板的数据源）。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beijingDayStartMs,
  createUsageLedger,
  dayIndexOf,
  dayKeyOf,
  hourIndexOf,
} from '../lib/usage-ledger.js';
import { bucketsFromUsage, costOfBuckets, rateAt } from '../lib/usage.js';

/** 用同一套价目内核算出期望金额——避免在测试里重复硬编码价目表。 */
const expectedCost = (model, timeMs, usage) => costOfBuckets(bucketsFromUsage(usage), rateAt(model, timeMs));
const money = (value) => Math.round(value * 1e4) / 1e4;

const at = (text) => Date.parse(text);
/**
 * 固定时钟 = 北京时间 2026-09-09（周三）20:00。
 * 【重要】所有断言里的时间都是 UTC 写法，换算成北京时间要 +8 小时：
 *   02:00Z → 北京 10:00（高峰，周三）
 *   04:00Z → 北京 12:00（空闲，高峰 9:00-12:00 不含 12:00）
 *   04:30Z → 北京 12:30（空闲）
 *   12:00Z → 北京 20:00（空闲，"今天"就是 09-09）
 */
const NOW = at('2026-09-09T12:00:00.000Z');
const fixedNow = () => NOW;
/** 北京时间 10:00（高峰）。 */
const PEAK = at('2026-09-09T02:00:00.000Z');
/** 北京时间 12:00（空闲）。 */
const OFF = at('2026-09-09T04:00:00.000Z');

// 每条真实事件都有唯一的 seq。用递增分配器，避免测试自己踩到 seq 水位去重。
let seqCounter = 0;
const nextSeq = () => (seqCounter += 1);

const header = (model, time = NOW) => ({
  type: 'request/header',
  seq: nextSeq(),
  time,
  data: { header: { config: { provider: 'deepseek-official', model } } },
});
const message = (turn, step, time, usage, id = `msg-${turn}-${step}`) => ({
  type: 'assistant/message',
  seq: nextSeq(),
  time,
  data: { turn, step, usage, message: { id } },
});
const attempt = (turn, step, time, usage) => ({
  type: 'assistant/attempt',
  seq: nextSeq(),
  time,
  data: { turn, step, stream: [{ type: 'chunk', chunk: { type: 'usage', usage } }] },
});

const newLedger = (options = {}) => createUsageLedger({ now: fixedNow, ...options });

test('时间轴换算：小时序号 / 日序号 / 日键都按北京时间', () => {
  // 北京时间 2026-09-09 08:00 = UTC 00:00
  const t = at('2026-09-09T00:00:00.000Z');
  assert.equal(hourIndexOf(t), hourIndexOf(t + 3599e3));
  assert.equal(hourIndexOf(t + 3600e3), hourIndexOf(t) + 1);
  assert.equal(dayKeyOf(dayIndexOf(t)), '2026-09-09');
  assert.equal(new Date(beijingDayStartMs(t) + 8 * 3600e3).toISOString(), '2026-09-09T00:00:00.000Z');
});

test('单次调用落进对应的小时桶与日桶，金额与 usage.js 同口径', () => {
  const ledger = newLedger();
  const time = PEAK; // 北京 10:00 → 高峰
  const usage = {
    inputTokens: 1_000_000,
    cacheReadTokens: 2_000_000,
    outputTokens: 250_000,
  };
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 's1' }, message(1, 1, time, usage));

  // 期望金额由 usage.js 的同一套价目/峰谷规则算出（不硬编码价目表）
  const cost = expectedCost('deepseek-v4-flash', time, usage);
  assert.equal(cost.regime, 'peak', '北京 10:00 应为高峰计价');

  const data = ledger.snapshot();
  const row = data.hours.find((item) => item.index === hourIndexOf(time));
  assert.ok(row, '应存在对应小时桶');
  assert.equal(row.peak, true, '北京 10:00 属于高峰时段');
  assert.equal(row.calls, 1);
  assert.equal(money(row.costHitCny), money(cost.hit));
  assert.equal(money(row.costMissCny), money(cost.miss));
  assert.equal(money(row.costOutCny), money(cost.out));
  assert.equal(money(row.costCny), money(cost.total));
  assert.equal(money(row.costPeakCny), money(cost.total), '高峰计价的金额计入 costPeakCny');
  assert.equal(row.costOffPeakCny, 0);
  assert.equal(row.tokens.cacheRead, 2_000_000);
  assert.equal(row.tokens.total, 3_250_000);

  const day = data.days.find((item) => item.date === dayKeyOf(dayIndexOf(time)));
  assert.equal(money(day.costCny), money(cost.total), '日桶与小时桶金额一致');
});

test('空闲时段按空闲价，峰谷金额分别落桶', () => {
  const ledger = newLedger();
  const time = at('2026-09-09T04:30:00.000Z'); // 北京 12:30 → 午休（空闲）
  const usage = { inputTokens: 1_000_000 };
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 's1' }, message(1, 1, time, usage));
  const cost = expectedCost('deepseek-v4-flash', time, usage);
  assert.equal(cost.regime, 'off');
  const data = ledger.snapshot();
  const row = data.hours.find((item) => item.index === hourIndexOf(time));
  assert.equal(row.peak, false);
  assert.equal(money(row.costMissCny), money(cost.miss));
  assert.equal(money(row.costOffPeakCny), money(cost.total));
  assert.equal(row.costPeakCny, 0);

  // 高峰样本落在同一小时轴的另一格，且计入 costPeakCny
  const peakTime = PEAK;
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', peakTime));
  ledger.fold({ id: 's1' }, message(1, 2, peakTime, usage));
  const peakRow = ledger.snapshot().hours.find((item) => item.index === hourIndexOf(peakTime));
  assert.equal(peakRow.peak, true);
  assert.equal(money(peakRow.costPeakCny), money(expectedCost('deepseek-v4-flash', peakTime, usage).total));
});

test('同一条上报重复到达（同 seq、同 message.id）→ 只算一次', () => {
  const ledger = newLedger();
  const time = OFF; // 北京 12:00（空闲）
  const event = message(1, 1, time, { inputTokens: 1_000_000 }, 'msg-a');
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 's1' }, event);
  ledger.fold({ id: 's1' }, event); // 同一条事件再送一次（实时 + 补扫的典型重复）
  const row = ledger.snapshot().hours.find((item) => item.index === hourIndexOf(time));
  assert.ok(row);
  assert.equal(row.calls, 1, '同一次调用只算一次');
  assert.equal(money(row.costMissCny), money(expectedCost('deepseek-v4-flash', time, { inputTokens: 1_000_000 }).miss));
});

test('同一条 message 的两次上报（不同 seq）→ 后到替换先到', () => {
  const ledger = newLedger();
  const time = OFF;
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  // 先到的样本只有 output，后来的样本带全量（同 message.id → 同一次调用）
  ledger.fold({ id: 's1' }, message(1, 1, time, { outputTokens: 1000 }, 'msg-a'));
  ledger.fold({ id: 's1' }, message(1, 1, time, { inputTokens: 1_000_000 }, 'msg-a'));
  const row = ledger.snapshot().hours.find((item) => item.index === hourIndexOf(time));
  assert.equal(row.calls, 1, '同一次调用只算一次');
  assert.equal(row.tokens.output, 0, '旧样本已被撤销');
  assert.equal(money(row.costMissCny), money(expectedCost('deepseek-v4-flash', time, { inputTokens: 1_000_000 }).miss));
});

test('乱序到达：后到的更大 seq 不能把更小的"新"事件误当重复丢掉', () => {
  const ledger = newLedger();
  const time = OFF;
  // 插件在会话进行中才挂载：第一条实时事件就是 seq=200
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 's1' }, {
    type: 'assistant/message',
    seq: 200,
    time,
    data: { turn: 5, step: 1, usage: { inputTokens: 1_000_000 }, message: { id: 'late' } },
  });
  // 补扫随后读到会话开头真正没见过的 seq=10
  ledger.ingest('s1', {
    type: 'assistant/message',
    seq: 10,
    time,
    data: { turn: 1, step: 1, usage: { inputTokens: 500_000 }, message: { id: 'early' } },
  });
  const row = ledger.snapshot().hours.find((item) => item.index === hourIndexOf(time));
  assert.ok(row);
  assert.equal(row.calls, 2, '两条不同调用都要计入');
  assert.equal(row.tokens.input, 1_500_000);
});

test('重试：两次 attempt 各自独立累加（与官方「重试按两次调用计费」一致）', () => {
  const ledger = newLedger();
  const time = OFF;
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 's1' }, attempt(1, 1, time, { inputTokens: 1_000_000 }));
  ledger.fold({ id: 's1' }, { type: 'llm/retry-started', seq: nextSeq(), time, data: { turn: 1, step: 1 } });
  ledger.fold({ id: 's1' }, attempt(1, 1, time + 1000, { inputTokens: 1_000_000 }));
  const data = ledger.snapshot();
  const row = data.hours.find((item) => item.index === hourIndexOf(time));
  assert.equal(row.calls, 2);
  assert.equal(row.tokens.input, 2_000_000);
});

test('实时路径与历史补扫对同一条事件幂等（跨路径不重复计数）', () => {
  const time = OFF;
  const events = [
    { type: 'assistant/attempt', seq: 30, time, data: { turn: 2, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1_000_000 } } }] } },
    { type: 'assistant/message', seq: 31, time, data: { turn: 2, step: 1, usage: { inputTokens: 1_000_000 }, message: { id: 'x' } } },
  ];
  const ledger = newLedger();
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  for (const event of events) ledger.fold({ id: 's1' }, event);
  // 补扫再喂一遍同样的事件（同 seq、同 message.id）→ 靠 occurrence key 幂等
  for (const event of events) ledger.ingest('s1', event);
  const row = ledger.snapshot().hours.find((item) => item.index === hourIndexOf(time));
  assert.equal(row.calls, 2, 'attempt 与 message 各一次');
  assert.equal(row.tokens.input, 2_000_000, '两条调用的 input 不会翻倍');
});

test('seq 水位：补扫读到的已计入事件不会与实时折叠重复', async () => {
  const ledger = newLedger();
  const time = OFF;
  const log = [
    header('deepseek-v4-flash', time),
    attempt(1, 1, time, { inputTokens: 1_000_000 }),
  ];
  // 实时路径先收到（真实场景：进程内事件先到，补扫随后）
  ledger.fold({ id: 's1' }, log[0]);
  ledger.fold({ id: 's1' }, log[1]);
  // 补扫再从 seq 1 读回同样的事件
  const persistence = {
    async list() { return [{ header: { id: 's1' } }]; },
    async open() {
      return {
        async read(offset, length) {
          return { eventState: 'detached', events: log.slice(offset, offset + length) };
        },
        async close() {},
      };
    },
  };
  const scan = await ledger.scanFrom(persistence, { readChunk: 10 });
  assert.equal(scan.status, 'done');
  assert.equal(scan.events, 2, '补扫确实读到了这两条');
  const row = ledger.snapshot().hours.find((item) => item.index === hourIndexOf(time));
  assert.equal(row.calls, 1, '同一条调用只计一次');
  assert.equal(row.tokens.input, 1_000_000);
});

test('补扫期间的实时事件先排队，扫完按顺序回放', async () => {
  const time = at('2026-09-09T04:00:00.000Z');
  const log = [header('deepseek-v4-flash', time), message(1, 1, time, { inputTokens: 500_000 }, 'h1')];
  let releaseList;
  const listGate = new Promise((resolve) => { releaseList = resolve; });
  const persistence = {
    async list() { await listGate; return [{ header: { id: 's1' } }]; },
    async open() {
      return {
        async read(offset, length) {
          return { eventState: 'detached', events: log.slice(offset, offset + length) };
        },
        async close() {},
      };
    },
  };
  const ledger = newLedger();
  const scanning = ledger.scanFrom(persistence, { readChunk: 10 });
  // 扫描尚未列出会话时，实时事件到达 → 应进入队列而不是直接折叠
  ledger.fold({ id: 'live' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 'live' }, message(1, 1, time, { inputTokens: 250_000 }, 'l1'));
  assert.equal(ledger.size, 0, '扫描期间实时事件不直接计入');
  releaseList();
  await scanning;
  assert.equal(ledger.size, 2, '扫完后队列被回放');
  const data = ledger.snapshot();
  const row = data.hours.find((item) => item.index === hourIndexOf(time));
  assert.equal(row.calls, 2);
  assert.equal(row.tokens.input, 750_000);
  assert.equal(data.scan.status, 'done');
});

test('历史补扫 scanFrom：逐会话读回事件并补齐时间桶', async () => {
  const time = at('2026-09-09T02:00:00.000Z'); // 今天北京 10:00（高峰，在 24 小时轴内）
  const log = [
    header('deepseek-v4-flash', time),
    message(1, 1, time, { inputTokens: 1_000_000, outputTokens: 100_000 }, 'hist-1'),
  ];
  const opened = [];
  const persistence = {
    async list() {
      return [
        { header: { id: 'hist-session' } },
        { header: { id: 'broken-session' } },
      ];
    },
    async open(id) {
      opened.push(id);
      if (id === 'broken-session') throw new Error('boom');
      return {
        async read(offset, length) {
          return { eventState: 'detached', events: log.slice(offset, offset + length) };
        },
        async close() {},
      };
    },
  };
  const ledger = newLedger();
  const scan = await ledger.scanFrom(persistence, { readChunk: 10 });
  assert.equal(scan.status, 'done');
  assert.equal(scan.sessions, 1, '坏会话计入 failed，不阻断其余会话');
  assert.equal(scan.failed, 1);
  assert.deepEqual(opened, ['hist-session', 'broken-session']);

  const data = ledger.snapshot();
  const row = data.hours.find((item) => item.index === hourIndexOf(time));
  assert.ok(row, '历史小时桶应出现（在 24 小时轴内）');
  assert.equal(row.peak, true);
  const cost = expectedCost('deepseek-v4-flash', time, { inputTokens: 1_000_000, outputTokens: 100_000 });
  assert.equal(money(row.costCny), money(cost.total));
  const day = data.days.find((item) => item.date === dayKeyOf(dayIndexOf(time)));
  assert.equal(money(day.costCny), money(cost.total));
  assert.equal(data.scan.status, 'done');
});

test('scanFrom：持久化服务不可用时退化为仅实时统计，不抛错', async () => {
  const ledger = newLedger();
  const scan = await ledger.scanFrom(undefined);
  assert.equal(scan.status, 'unavailable');
  assert.equal(ledger.snapshot().ok, true);
});

test('保留窗口：超出 windowDays 的事件被丢弃', () => {
  const ledger = newLedger({ windowDays: 3 });
  const stale = at('2026-09-01T04:00:00.000Z'); // 8 天前
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', stale));
  ledger.fold({ id: 's1' }, message(1, 1, stale, { inputTokens: 1_000_000 }, 'old'));
  assert.equal(ledger.size, 0);
  assert.equal(ledger.snapshot().days.every((row) => row.calls === 0), true);
});

test('快照：携带缓存命中率（prompt 侧口径）与日趋势的 peak 标记', () => {
  const ledger = newLedger();
  const time = OFF; // 北京 12:00（空闲）
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', time));
  ledger.fold({ id: 's1' }, message(1, 1, time, {
    inputTokens: 1_000_000,
    cacheReadTokens: 9_000_000,
    outputTokens: 50_000,
  }, 'hit-rate'));
  const data = ledger.snapshot();
  // 命中率 = cacheRead / (input + cacheWrite + cacheRead) = 9M / 10M
  assert.equal(data.totals.today.cacheHitPercent, 90);
  assert.equal(data.totals.last24h.cacheHitPercent, 90);
  assert.equal(data.totals.window.cacheHitPercent, 90);
  const today = data.days[data.days.length - 1];
  assert.equal(today.peak, false, '空闲时段落桶的当天 peak 应为 false');
  const hour = data.hours.find((row) => row.index === hourIndexOf(time));
  assert.equal(hour.cacheHitPercent, 90, '小时行也带命中率');
});

test('快照：没有任何 prompt 侧用量时命中率为 null（前端隐藏该行）', () => {
  const ledger = newLedger();
  const data = ledger.snapshot();
  assert.equal(data.totals.today.cacheHitPercent, null);
  assert.equal(data.totals.window.cacheHitPercent, null);
});

test('快照：24 小时轴连续、当前小时标记、峰谷标记与北京时间一致', () => {
  const ledger = newLedger();
  const data = ledger.snapshot();
  assert.equal(data.hours.length, 24);
  assert.equal(data.days.length, 7);
  assert.equal(data.hours[23].current, true, '最后一格是当前小时');
  assert.equal(data.days[6].current, true);
  // 北京时间 20:00（周三）：空闲时段
  assert.equal(data.hours[23].peak, false);
  assert.equal(data.hours[23].hour, 20);
  for (let index = 1; index < data.hours.length; index += 1) {
    assert.equal(data.hours[index].index, data.hours[index - 1].index + 1, '小时序号连续');
  }
  // 峰谷标记：北京 10:00 属于高峰
  const peakHour = data.hours.find((row) => row.hour === 10);
  assert.equal(peakHour.peak, true);
});

test('快照：总计口径（last24h / today / window）', () => {
  const ledger = newLedger();
  const usage = { inputTokens: 1_000_000 };
  ledger.fold({ id: 's1' }, header('deepseek-v4-flash', OFF));
  ledger.fold({ id: 's1' }, message(1, 1, OFF, usage, 'a'));
  const cost = expectedCost('deepseek-v4-flash', OFF, usage);
  const data = ledger.snapshot();
  assert.equal(money(data.totals.last24h.costCny), money(cost.total));
  assert.equal(money(data.totals.today.costCny), money(cost.total));
  assert.equal(money(data.totals.window.costCny), money(cost.total));
  assert.equal(data.totals.window.calls, 1);
  assert.equal(data.totals.today.calls, 1);
});

test('窗口覆盖参数：hours / days 可调', () => {
  const ledger = newLedger();
  assert.equal(ledger.snapshot({ hours: 6 }).hours.length, 6);
  assert.equal(ledger.snapshot({ days: 2 }).days.length, 2);
});

test('无 usage 的事件、未知会话、坏数据都不炸', () => {
  const ledger = newLedger();
  assert.equal(ledger.fold(null, null), false);
  assert.equal(ledger.fold({ id: 's1' }, null), false);
  assert.equal(ledger.fold({}, header('deepseek-v4-flash')), false);
  assert.equal(ledger.fold({ id: 's1' }, { type: 'tool/call', seq: nextSeq(), time: NOW, data: {} }), false);
  assert.equal(ledger.fold({ id: 's1' }, { type: 'assistant/message', seq: nextSeq(), time: NOW, data: { turn: 1, step: 1 } }), false);
  assert.equal(ledger.fold({ id: '' }, message(1, 1, NOW, { inputTokens: 5 })), false);
  assert.equal(ledger.snapshot().calls, 0);
});
