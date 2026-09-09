/**
 * ============================================================================
 * dsh-whale-girl-pet costUsage 会话投影（宿主半侧）
 * ============================================================================
 *
 * 【职责】
 *   把会话日志折叠成费用（元），注册为 `costUsage` 投影，供浏览器半侧读取：
 *     - 输入框下方的会话费用 pill（累计总额 + 三桶）
 *     - 每条回复动作行里的"本轮费用"pill（按 turn 查 byTurn）
 *
 * 【口径】
 *   与 lib/usage.js 完全同源：同一张价目表、同一套事件取用、同一条
 *   `llm/retry-started` 语义（重试的两次调用都计费）。因此 pill 上的金额
 *   与任务完成气泡、余额按钮里的"今日花费"永远一致。
 *
 *   折叠事件与官方 tokenUsage 投影相同（assistant/message 与 assistant/attempt
 *   的 usage，同 turn/step 后到替换先到），所以费用拆出来的三桶与统计行里的
 *   token 数也同源。
 *
 * @module dsh-whale-girl-pet/cost-projection
 */
import { z } from 'zod';
import { bucketsFromUsage, costOfBuckets, rateAt, usageOfEvent } from './usage.js';

/** 计价货币（与 lib/usage.js 的元口径一致）。 */
const CURRENCY = 'CNY';

/** 金额统一保留 4 位小数。 */
const round = (n) => Math.round(n * 1e4) / 1e4;

/** 三个计费桶 + 峰谷拆分，单位元。 */
const moneySchema = {
  cacheReadCny: z.number().nonnegative(),
  missCny: z.number().nonnegative(),
  outputCny: z.number().nonnegative(),
  peakCny: z.number().nonnegative(),
  offPeakCny: z.number().nonnegative(),
};

const totalsSchema = z.object({
  ...moneySchema,
  pricedRequests: z.number().int().nonnegative(),
  unpricedRequests: z.number().int().nonnegative(),
}).strict();

const sampleSchema = z.object({ ...moneySchema, priced: z.boolean() }).strict();

const stateSchema = z.object({
  route: z.object({ provider: z.string(), model: z.string() }).strict().nullable(),
  totals: totalsSchema,
  /** 每个 turn 的累计（键是 turn 号的字符串形式）。 */
  byTurn: z.record(z.string(), totalsSchema),
  /** 已结算 assistant 消息 id → 它所属的 turn（供动作行按 messageId 查本轮费用）。 */
  messageTurns: z.record(z.string(), z.number().int().nonnegative()),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    sample: sampleSchema,
  }).strict().nullable(),
}).strict();

/** 视图里的单轮金额行。 */
const turnRowSchema = z.object({
  turn: z.number().int().nonnegative(),
  ...moneySchema,
  totalCny: z.number().nonnegative(),
}).strict();

/** 线上视图：累计金额 + 币种 + 请求计数 + 每轮金额 + 消息归属。 */
const viewSchema = totalsSchema.extend({
  currency: z.string().length(3),
  totalCny: z.number().nonnegative(),
  byTurn: z.array(turnRowSchema),
  messageTurns: z.record(z.string(), z.number().int().nonnegative()),
}).strict();

/** 零金额桶。 */
function zeroMoney() {
  return { cacheReadCny: 0, missCny: 0, outputCny: 0, peakCny: 0, offPeakCny: 0 };
}

/** 零累计。 */
function zeroTotals() {
  return { ...zeroMoney(), pricedRequests: 0, unpricedRequests: 0 };
}

/**
 * 把样本的金额字段加进（或从）一份金额记录里。
 * @param current - 当前金额。
 * @param sample - 样本。
 * @param direction - 1 加入，-1 移除。
 * @returns 调整后的金额。
 */
function adjustMoney(current, sample, direction) {
  return {
    cacheReadCny: current.cacheReadCny + direction * sample.cacheReadCny,
    missCny: current.missCny + direction * sample.missCny,
    outputCny: current.outputCny + direction * sample.outputCny,
    peakCny: current.peakCny + direction * sample.peakCny,
    offPeakCny: current.offPeakCny + direction * sample.offPeakCny,
  };
}

/**
 * 把样本加进（或从）累计里，含请求计数。
 * @param totals - 当前累计。
 * @param sample - 样本。
 * @param direction - 1 加入，-1 移除。
 * @returns 调整后的累计。
 */
function adjustTotals(totals, sample, direction) {
  return {
    ...adjustMoney(totals, sample, direction),
    pricedRequests: totals.pricedRequests + direction * (sample.priced ? 1 : 0),
    unpricedRequests: totals.unpricedRequests + direction * (sample.priced ? 0 : 1),
  };
}

/**
 * 把样本加进（或从）某一轮的累计里。
 * @param byTurn - 当前每轮累计。
 * @param turn - turn 号。
 * @param sample - 样本。
 * @param direction - 1 加入，-1 移除。
 * @returns 调整后的每轮累计。
 */
function adjustTurn(byTurn, turn, sample, direction) {
  const key = String(turn);
  const current = byTurn[key] ?? zeroTotals();
  return { ...byTurn, [key]: adjustTotals(current, sample, direction) };
}

/**
 * 按路由与事件时刻给一次用量定价。
 * @param route - 当前生效的 provider/model。
 * @param usage - provider 上报的 usage。
 * @param time - 结算事件时刻（UTC 毫秒）。
 * @returns 一个已定价样本。
 */
function sampleFor(route, usage, time) {
  const rate = rateAt(route.model, time);
  const cost = costOfBuckets(bucketsFromUsage(usage), rate);
  const peak = rate.regime === 'peak';
  return {
    cacheReadCny: cost.hit,
    missCny: cost.miss,
    outputCny: cost.out,
    peakCny: peak ? cost.total : 0,
    offPeakCny: peak ? 0 : cost.total,
    priced: true,
  };
}

/**
 * 折叠一条事件。
 * @param state - 当前状态。
 * @param event - 一条会话事件。
 * @returns 下一个状态。
 */
function applyEvent(state, event) {
  if (event.type === 'request/header') {
    const call = event.data.header.config;
    return { ...state, route: { provider: call.provider, model: call.model } };
  }
  if (event.type === 'llm/retry-started') {
    // 重试是另一次真实计费调用：关闭替换槽，让重试样本累加。
    return state.last !== null && state.last.turn === event.data.turn && state.last.step === event.data.step
      ? { ...state, last: null }
      : state;
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state;

  const { turn, step } = event.data;
  // 消息归属：动作行按 messageId 查本轮费用，所以即使这条消息没有 usage 也要记录。
  const messageId = event.type === 'assistant/message' && event.data.message ? event.data.message.id : undefined;
  const next = messageId === undefined
    ? state
    : { ...state, messageTurns: { ...state.messageTurns, [String(messageId)]: turn } };

  const usage = usageOfEvent(event);
  if (usage === undefined) return next;
  const previous = next.last !== null && next.last.turn === turn && next.last.step === step
    ? next.last.sample
    : undefined;
  const sample = next.route === null
    ? { ...zeroMoney(), priced: false }
    : sampleFor(next.route, usage, event.time);
  const base = previous === undefined ? next.totals : adjustTotals(next.totals, previous, -1);
  const byTurn = previous === undefined ? next.byTurn : adjustTurn(next.byTurn, turn, previous, -1);
  return {
    ...next,
    totals: adjustTotals(base, sample, 1),
    byTurn: adjustTurn(byTurn, turn, sample, 1),
    last: { turn, step, sample },
  };
}

/**
 * 构建 costUsage 投影单元。
 * @returns 投影定义（注册到 ctx.sessionProjections）。
 */
export function createCostUsageProjection() {
  return {
    key: 'costUsage',
    stateVersion: 2,
    stateSchema,
    init: () => ({ route: null, totals: zeroTotals(), byTurn: {}, messageTurns: {}, last: null }),
    apply: applyEvent,
    wire: {
      viewSchema,
      view: (state) => {
        const totals = state.totals;
        const byTurn = Object.entries(state.byTurn)
          .map(([turn, value]) => ({
            turn: Number(turn),
            cacheReadCny: round(value.cacheReadCny),
            missCny: round(value.missCny),
            outputCny: round(value.outputCny),
            peakCny: round(value.peakCny),
            offPeakCny: round(value.offPeakCny),
            totalCny: round(value.cacheReadCny + value.missCny + value.outputCny),
          }))
          .sort((left, right) => left.turn - right.turn);
        return {
          currency: CURRENCY,
          cacheReadCny: round(totals.cacheReadCny),
          missCny: round(totals.missCny),
          outputCny: round(totals.outputCny),
          totalCny: round(totals.cacheReadCny + totals.missCny + totals.outputCny),
          peakCny: round(totals.peakCny),
          offPeakCny: round(totals.offPeakCny),
          pricedRequests: totals.pricedRequests,
          unpricedRequests: totals.unpricedRequests,
          byTurn,
          messageTurns: state.messageTurns,
        };
      },
    },
  };
}
