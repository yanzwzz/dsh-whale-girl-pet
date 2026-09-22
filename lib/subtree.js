/**
 * ============================================================================
 * dsh-whale-girl-pet 子会话费用汇总（纯逻辑，无外部依赖）
 * ============================================================================
 *
 * 【职责】
 *   把"某会话的全部后代会话"的费用合计出来，供浏览器半侧的费用 pill 叠加。
 *
 * 【为什么需要它（关键背景）】
 *   DSH 的会话投影（session projection）只折叠**本条会话自己的日志**。
 *   子代理（subagent）是独立会话（header.origin === 'subagent'，
 *   header.parentSession 指向父会话），它们的事件永远不会出现在父会话的日志里，
 *   所以 `costUsage` 投影给出的"本会话费用"天然漏掉子代理的开销。
 *
 *   宿主半侧的分时段账本（lib/usage-ledger.js）折叠了**所有**会话并保留了
 *   按会话的累计（`ledger.sessionCost(id)`），所以这里只需要：
 *     1. 由会话 header 建出父子树；
 *     2. 收集全部后代；
 *     3. 把每个后代的账本累计加起来。
 *
 * 【按轮归集（byTurn）】
 *   会话级 pill 只需要总数；"本轮费用" pill 还要求把子代理的开销归到
 *   **派发它的那一轮**。归集口径：用子会话的 `header.createdAt` 落在父会话
 *   哪个 turn 的时间窗里（turn 的时间窗 = 该 turn 全部事件的 min/max 时间）。
 *   取不到时间窗时不做按轮归集（返回空表），总数仍然正确。
 *
 * @module dsh-whale-girl-pet/subtree
 */

/** 零会话累计（与账本 sessionCost 同形）。 */
export function zeroLedgerCost() {
  return {
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    hit: 0,
    miss: 0,
    out: 0,
    peak: 0,
    offPeak: 0,
    calls: 0,
  };
}

/** 账本会话累计里参与求和的数字字段。 */
const COST_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output', 'hit', 'miss', 'out', 'peak', 'offPeak', 'calls'];

/**
 * 累加一份账本会话累计（坏值按 0 处理）。
 * @param target - 目标累计（会被就地修改）。
 * @param source - 账本 sessionCost 的结果。
 * @returns target。
 */
export function addLedgerCost(target, source) {
  for (const key of COST_KEYS) target[key] += Number(source && source[key]) || 0;
  return target;
}

/** 四舍五入到 4 位小数（元）。 */
function round4(value) {
  return Math.round((Number(value) || 0) * 1e4) / 1e4;
}

/**
 * 账本会话累计 → 可 JSON 化的响应片段。
 * @param cost - {@link zeroLedgerCost} 形状的累计。
 * @returns `{ tokens, costCny, costHitCny, costMissCny, costOutCny, costPeakCny, costOffCny, calls }`
 */
export function ledgerCostView(cost) {
  const total = cost.hit + cost.miss + cost.out;
  return {
    tokens: {
      input: cost.input,
      cacheRead: cost.cacheRead,
      cacheWrite: cost.cacheWrite,
      output: cost.output,
      total: cost.input + cost.cacheRead + cost.cacheWrite + cost.output,
    },
    costCny: round4(total),
    costHitCny: round4(cost.hit),
    costMissCny: round4(cost.miss),
    costOutCny: round4(cost.out),
    costPeakCny: round4(cost.peak),
    costOffCny: round4(cost.offPeak),
    calls: cost.calls,
  };
}

/**
 * 取一条会话快照里的 header。
 * @param value - 在线 Session 对象或落盘 snapshot。
 * @returns header，或 undefined（形状不对）。
 */
export function headerOf(value) {
  if (value === null || value === undefined || typeof value !== 'object') return undefined;
  const header = value.header;
  if (header === null || header === undefined || typeof header !== 'object') return undefined;
  if (typeof header.id !== 'string' || header.id.length === 0) return undefined;
  return header;
}

/**
 * 由一批会话 header 建出血统表。
 *
 * 重复 id 只认第一个（在线那份要排在落盘那份前面，见 lib/index.js 的取数顺序）；
 * 没有 parentSession 的 header（根会话）只记录创建时刻，不进 children。
 *
 * @param headers - 会话 header 列表（可含 undefined / 坏值）。
 * @returns `{ children, created }`：parent id → 子 id 列表；session id → createdAt。
 */
export function buildLineage(headers) {
  const children = new Map();
  const created = new Map();
  const seen = new Set();
  for (const value of headers) {
    const header = value !== null && value !== undefined && typeof value === 'object' && typeof value.id === 'string'
      ? value
      : headerOf(value);
    if (header === undefined || header === null || seen.has(header.id)) continue;
    seen.add(header.id);
    created.set(header.id, Number(header.createdAt) || 0);
    const parent = header.parentSession;
    if (typeof parent !== 'string' || parent.length === 0) continue;
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [header.id]);
    else list.push(header.id);
  }
  return { children, created };
}

/**
 * 广度优先收集全部后代会话 id（visited 防御环形血统）。
 * @param children - {@link buildLineage} 的 children。
 * @param rootId - 根会话 id。
 * @returns 后代 id 列表（不含根自己）。
 */
export function descendantIds(children, rootId) {
  const descendants = [];
  const visited = new Set([rootId]);
  const queue = [...(children.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    descendants.push(id);
    const next = children.get(id);
    if (Array.isArray(next)) queue.push(...next);
  }
  return descendants;
}

/**
 * 某会话自己每个 turn 的时间窗（该 turn 全部事件的 min/max 时间）。
 * @param events - 会话事件快照。
 * @returns Map<turn, { turn, start, end }>
 */
export function turnWindowsOf(events) {
  const windows = new Map();
  if (!Array.isArray(events)) return windows;
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    const data = event.data;
    const turn = data && typeof data.turn === 'number' ? data.turn : undefined;
    const time = typeof event.time === 'number' ? event.time : undefined;
    if (turn === undefined || time === undefined) continue;
    const current = windows.get(turn);
    if (current === undefined) windows.set(turn, { turn, start: time, end: time });
    else {
      if (time < current.start) current.start = time;
      if (time > current.end) current.end = time;
    }
  }
  return windows;
}

/**
 * 子会话创建时刻落在哪个父 turn。
 * 优先取包含该时刻的时间窗；否则取"开始时间不晚于它"的最后一个 turn；
 * 再否则（创建早于所有 turn）取最早的 turn。
 * @param windows - {@link turnWindowsOf} 的结果（Map）。
 * @param createdAt - 子会话创建时刻（UTC 毫秒）。
 * @returns turn 号，或 undefined（没有任何时间窗）。
 */
export function turnAt(windows, createdAt) {
  let fallback;
  let first;
  for (const window of windows.values()) {
    if (window.start <= createdAt && createdAt <= window.end) return window.turn;
    if (window.start <= createdAt && (fallback === undefined || window.start > fallback.start)) fallback = window;
    if (first === undefined || window.start < first.start) first = window;
  }
  if (fallback !== undefined) return fallback.turn;
  return first === undefined ? undefined : first.turn;
}

/**
 * 汇总某会话的全部后代费用。
 * @param options - 汇总输入。
 * @param options.headers - 所有已知会话的 header（在线 + 落盘）。
 * @param options.rootSessionId - 根会话 id。
 * @param options.sessionCost - 取某会话账本累计的函数：`(id) => cost | undefined`。
 * @param options.rootEvents - 根会话的事件快照（用于按轮归集；可缺省）。
 * @returns 可 JSON 化的响应：总数、按轮归集、逐会话明细。
 */
export function subtreeCost(options) {
  const headers = Array.isArray(options.headers) ? options.headers : [];
  const rootSessionId = String(options.rootSessionId ?? '');
  const sessionCost = typeof options.sessionCost === 'function' ? options.sessionCost : () => undefined;
  const { children, created } = buildLineage(headers);
  const descendants = descendantIds(children, rootSessionId);

  const windows = turnWindowsOf(options.rootEvents);

  const totals = zeroLedgerCost();
  const byId = {};
  const rawByTurn = new Map();
  for (const id of descendants) {
    const cost = sessionCost(id);
    if (cost === undefined || cost === null) continue;
    byId[id] = ledgerCostView(cost);
    addLedgerCost(totals, cost);
    if (windows.size === 0) continue;
    const turn = turnAt(windows, created.get(id) || 0);
    if (turn === undefined) continue;
    const bucket = rawByTurn.get(turn) ?? zeroLedgerCost();
    addLedgerCost(bucket, cost);
    rawByTurn.set(turn, bucket);
  }

  const byTurn = {};
  for (const [turn, cost] of rawByTurn) byTurn[String(turn)] = ledgerCostView(cost);
  return {
    ok: true,
    sessionId: rootSessionId,
    descendants: { count: descendants.length, ...ledgerCostView(totals) },
    byTurn,
    sessions: byId,
  };
}
