/**
 * ============================================================================
 * dsh-whale-girl-pet 分时段用量账本（纯逻辑，无外部依赖）
 * ============================================================================
 *
 * 【职责】
 *   把"每次计费调用"折进**时间桶**，供桌宠的气泡看板（点击后弹出的
 *   「分时段花费」面板）读取：
 *     - 今日 24 个**北京小时**桶：每小时的花费 / token / 调用次数 + 峰谷标记
 *     - 近 N 天（默认 7 天）的**北京日**桶：每天花费 / token / 调用次数
 *
 * 【和 lib/usage.js 的关系】
 *   价目表、峰谷判定、三桶计费、事件取用**全部复用** lib/usage.js
 *   （rateAt / costOfBuckets / bucketsFromUsage / usageOfEvent）。
 *   所以看板上的金额与任务完成气泡、余额按钮、费用 pill 永远同口径。
 *   区别只在"聚合维度"：usage.js 按会话/任务汇总，账本按时间桶汇总。
 *
 * 【为什么不用 sessionProjections】
 *   投影是**按会话**的（每会话一份 state + view），而看板要的是
 *   "所有会话、跨重启、按小时"的全局视图。所以这里是一个宿主侧的独立
 *   账本：实时事件走 ctx.on('session/event') 增量折叠，历史由
 *   lib/index.js 用 ctx.sessionPersistence 补扫（见 scanFrom）。
 *
 * 【去重与替换（关键）】
 *   一次计费调用在 DSH 的事件流里可能被写多条（流式 usage 与最终 usage），
 *   "后到替换先到"是官方 tokenUsage 投影的口径。这里用 **occurrence key**
 *   表达同一条调用：
 *       sessionId|turn|step|事件自带的调用身份
 *   调用身份取自事件本身（message.id / 事件 seq + usage chunk 下标），
 *   **不是**按到达顺序计数——所以"实时总线"和"历史补扫"两条路径对同一条
 *   事件算出的 key 完全相同，无论谁先谁后都只会算一次。
 *   同一 key 再次出现 → 先把上一次的金额/token 从各桶里减掉，再加新的。
 *   重试会产出新的 message id / 新的 attempt，所以两次重试各自独立累加，
 *   与官方"重试按两次调用计费"一致。
 *
 * 【时间口径】
 *   全部按**北京时间（UTC+8）**切桶，与价目表的峰谷时段定义一致：
 *   高峰 = 周一至周五 9:00-12:00、14:00-18:00，其余（含周末全天）空闲。
 *
 * @module dsh-whale-girl-pet/usage-ledger
 */
import { bucketsFromUsage, costOfBuckets, isPeakBeijing, rateAt, usageOfEvent } from './usage.js';

/** 北京时间相对 UTC 的偏移（毫秒）。 */
const BJ_OFFSET_MS = 8 * 3600e3;

/** 一天 / 一小时的毫秒数。 */
const DAY_MS = 864e5;
const HOUR_MS = 3600e3;

/** 保留窗口的默认天数（今日 + 前 6 天）。 */
export const DEFAULT_WINDOW_DAYS = 7;

/** 单次 fold 能接受的最大时间偏差（毫秒）——防止把明显错的时间戳当成"历史"。 */
const MAX_FUTURE_SKEW_MS = 5 * 60e3;

const round = (n) => Math.round(n * 1e4) / 1e4;

/** 零金额桶。 */
function zeroCost() {
  return { hit: 0, miss: 0, out: 0 };
}

/**
 * 一个时间桶的完整字段（内部用）。
 * @param hourIndex - 该桶起始时刻的"北京小时序号"（floor((time+8h)/1h)）
 * @returns 空桶。
 */
function emptyBucket(hourIndex) {
  return {
    hourIndex,
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
    models: new Set(),
  };
}

/**
 * 给桶加上（或减去）一份样本。
 * @param bucket - 目标桶。
 * @param sample - {@link sampleFrom} 的结果。
 * @param direction - 1 加入，-1 移除。
 */
function addToBucket(bucket, sample, direction) {
  bucket.input += direction * sample.input;
  bucket.cacheRead += direction * sample.cacheRead;
  bucket.cacheWrite += direction * sample.cacheWrite;
  bucket.output += direction * sample.output;
  bucket.hit += direction * sample.hit;
  bucket.miss += direction * sample.miss;
  bucket.out += direction * sample.out;
  bucket.peak += direction * sample.peak;
  bucket.offPeak += direction * sample.offPeak;
  bucket.calls += direction * 1;
  if (direction > 0 && sample.model) bucket.models.add(sample.model);
}

/**
 * 把一份样本换算成"从桶里加/减"所需的数字（不含归属桶信息）。
 * @param buckets - token 四桶（{@link bucketsFromUsage}）。
 * @param rate - {@link rateAt} 的结果。
 * @param model - 当前事件所属模型。
 * @param peak - 是否高峰计价。
 * @returns 样本。
 */
function applySample(buckets, rate, model, peak) {
  const cost = costOfBuckets(buckets, rate);
  return {
    input: buckets.input,
    cacheRead: buckets.cacheRead,
    cacheWrite: buckets.cacheWrite,
    output: buckets.output,
    hit: cost.hit,
    miss: cost.miss,
    out: cost.out,
    peak: peak ? cost.total : 0,
    offPeak: peak ? 0 : cost.total,
    model,
  };
}

/**
 * 取一条事件的 usage，并给出**跨路径稳定**的调用身份。
 *
 * 【为什么不用"第几次尝试"计数】
 *   计数依赖事件到达顺序：同一条 `assistant/attempt` 若先经实时总线到达、
 *   之后又被历史补扫读到，两条路径算出的 occurrence 可能不同，
 *   于是同一次调用被加两遍。所以调用身份直接取自事件本身：
 *     - `assistant/message`：用 message.id（最终样本，重试会产出新的 message id）
 *     - `assistant/attempt`：用事件 seq 或时间戳 + 该 attempt 里最后一条
 *       usage chunk 在 stream 中的下标（重试是另一次真实调用，各自独立）
 *   这样"同一条事件"永远映射到同一个 key，"后到替换先到"天然幂等。
 *
 * @param event - 一条会话事件。
 * @returns `{ usage, identity }`，取不到 usage 时 usage 为 undefined。
 */
function usageIdentityOf(event) {
  const usage = usageOfEvent(event);
  if (usage === undefined) return { usage: undefined, identity: '' };
  if (event.type === 'assistant/message') {
    const id = event.data && event.data.message ? event.data.message.id : undefined;
    if (id !== undefined && id !== null && String(id).length > 0) return { usage, identity: 'm:' + String(id) };
  }
  // 回退：事件 seq 最稳定；没有 seq 时用时间戳 + usage 的 totalTokens
  let chunkIndex = -1;
  const stream = event.data ? event.data.stream : undefined;
  if (Array.isArray(stream)) {
    for (let index = stream.length - 1; index >= 0; index -= 1) {
      const record = stream[index];
      if (record && record.type === 'chunk' && record.chunk && record.chunk.type === 'usage') {
        chunkIndex = index;
        break;
      }
    }
  }
  const base = typeof event.seq === 'number'
    ? 's:' + String(event.seq)
    : 't:' + String(event.time) + ':' + String(Number(usage.totalTokens) || 0);
  return { usage, identity: base + '#' + String(chunkIndex) };
}

/** 从归属信息里取出 token/cost 数字（丢掉归属字段本身）。 */
function sampleNumbers(sample) {
  return {
    input: sample.input,
    cacheRead: sample.cacheRead,
    cacheWrite: sample.cacheWrite,
    output: sample.output,
    hit: sample.hit,
    miss: sample.miss,
    out: sample.out,
    peak: sample.peak,
    offPeak: sample.offPeak,
  };
}

/** 北京小时序号（跨日单调递增，便于做"最近 24 小时"的连续轴）。 */
export function hourIndexOf(timeMs) {
  return Math.floor((timeMs + BJ_OFFSET_MS) / HOUR_MS);
}

/** 北京日序号（跨月/年单调递增）。 */
export function dayIndexOf(timeMs) {
  return Math.floor((timeMs + BJ_OFFSET_MS) / DAY_MS);
}

/** 北京日序号 → `YYYY-MM-DD`。 */
export function dayKeyOf(dayIndex) {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

/** 该时刻所属北京日的起始时刻（毫秒）。 */
export function beijingDayStartMs(timeMs) {
  return dayIndexOf(timeMs) * DAY_MS - BJ_OFFSET_MS;
}

/** 把快照里的一个桶导成可 JSON 化的行（内部桶带 Set，必须转掉）。 */
function exportBucket(bucket) {
  const totalIn = bucket.input + bucket.cacheRead + bucket.cacheWrite;
  const cost = bucket.hit + bucket.miss + bucket.out;
  return {
    tokens: {
      input: bucket.input,
      cacheRead: bucket.cacheRead,
      cacheWrite: bucket.cacheWrite,
      output: bucket.output,
      inputTotal: totalIn,
      total: totalIn + bucket.output,
    },
    /**
     * 缓存命中率（prompt 侧）：cacheRead / (input + cacheWrite + cacheRead)。
     * 与官方 pill 的"缓存命中率"同口径；没有 prompt 侧用量时为 null（前端隐藏该行）。
     */
    cacheHitPercent: totalIn > 0 ? Math.round((bucket.cacheRead / totalIn) * 1000) / 10 : null,
    costCny: round(cost),
    costHitCny: round(bucket.hit),
    costMissCny: round(bucket.miss),
    costOutCny: round(bucket.out),
    costPeakCny: round(bucket.peak),
    costOffPeakCny: round(bucket.offPeak),
    calls: bucket.calls,
    models: [...bucket.models].slice(0, 6),
  };
}

/** 累加两个内部桶（用于把 24 个小时合成总计）。 */
function mergeBuckets(target, source) {
  target.input += source.input;
  target.cacheRead += source.cacheRead;
  target.cacheWrite += source.cacheWrite;
  target.output += source.output;
  target.hit += source.hit;
  target.miss += source.miss;
  target.out += source.out;
  target.peak += source.peak;
  target.offPeak += source.offPeak;
  target.calls += source.calls;
  for (const model of source.models) target.models.add(model);
  return target;
}

/**
 * 创建一个分时段账本。
 *
 * @param options - 配置。
 * @param options.windowDays - 保留并展示的天数（含今日），默认 7。
 * @param options.maxOccurrences - occurrence 表的硬上限，超出时淘汰最旧的（防御性）。
 * @param options.now - 取当前时间的函数（测试可注入）。
 * @returns 账本实例。
 */
export function createUsageLedger(options = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(options.windowDays) || DEFAULT_WINDOW_DAYS));
  const maxOccurrences = Math.max(1000, Number(options.maxOccurrences) || 200000);
  /** 每会话保留的"已见 seq"上限（有界防御，超出后退化水位语义）。 */
  const maxSeenSeqs = Math.max(256, Number(options.maxSeenSeqs) || 20000);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  /** 实时折叠期间的排队（历史补扫时先缓冲，扫完按顺序回放）。 */
  let queued = null;

  /** sessionId → { lastSeq, model } */
  const sessions = new Map();
  /** 北京小时序号 → 内部桶 */
  const hours = new Map();
  /** 北京日序号 → 内部桶 */
  const days = new Map();
  /** occurrence key → { sample（纯数字）, hourIndex, dayIndex }，插入序即时间序 */
  const occurrences = new Map();

  let counted = 0;
  let skipped = 0;
  const scan = {
    status: 'idle',
    startedAt: 0,
    finishedAt: 0,
    ms: 0,
    sessions: 0,
    events: 0,
    failed: 0,
    error: null,
  };

  /** 取（或建）一个桶。 */
  function bucketOf(map, index) {
    let bucket = map.get(index);
    if (bucket === undefined) {
      bucket = emptyBucket(index);
      map.set(index, bucket);
    }
    return bucket;
  }

  /** 清理超出保留窗口的桶。 */
  function prune() {
    const cutoff = dayIndexOf(now()) - (windowDays - 1);
    for (const index of [...days.keys()]) {
      if (index < cutoff) days.delete(index);
    }
    const hourCutoff = (cutoff + 1) * 24;
    for (const index of [...hours.keys()]) {
      if (index < hourCutoff) hours.delete(index);
    }
  }

  /**
   * seq 去重：只有**确实见过**的 seq 才丢弃。
   *
   * 【为什么不用"单调水位"】
   *   水位（seq <= lastSeq 就丢）在到达顺序有跳跃时会误杀真正的新事件——
   *   例如插件在会话进行中才挂载，第一条实时事件就是 seq=200，而补扫随后
   *   读到 100（未见过的真实事件）会被水位丢掉。这里改成"精确见过集合 +
   *   溢出时退化水位"：集合有界，溢出后只对更旧的部分退回水位语义。
   *
   * @param state - 该会话的状态。
   * @param seq - 事件 seq（非数字则不做去重）。
   * @returns `true` 表示这条事件应当被计数。
   */
  function seen(state, seq) {
    if (typeof seq !== 'number' || !Number.isFinite(seq)) return true;
    if (state.recent.has(seq)) return false;
    // 曾经因为集合溢出而整体丢弃过旧区间：那段只保留水位语义
    if (state.droppedSeq !== undefined && seq <= state.droppedSeq) return false;
    state.recent.add(seq);
    if (typeof seq === 'number' && (state.maxSeq === undefined || seq > state.maxSeq)) state.maxSeq = seq;
    if (state.recent.size > maxSeenSeqs) {
      // 有界防御：丢一半最旧的，记下丢到的水位
      const sorted = [...state.recent].sort((left, right) => left - right);
      const keep = sorted.slice(-Math.floor(maxSeenSeqs / 2));
      state.droppedSeq = typeof state.droppedSeq === 'number'
        ? Math.max(state.droppedSeq, keep[0])
        : keep[0];
      state.recent = new Set(keep);
    }
    return true;
  }

  /** 取（或建）某会话的状态。 */
  function stateOf(sessionId) {
    let state = sessions.get(sessionId);
    if (state === undefined) {
      state = { recent: new Set(), maxSeq: undefined, droppedSeq: undefined, model: '' };
      sessions.set(sessionId, state);
    }
    return state;
  }

  /**
   * 把一条事件折进账本。
   * @param sessionId - 会话 id。
   * @param event - 一条会话事件。
   * @returns `true` 表示这条事件带来了一次新的计费调用。
   */
  function ingest(sessionId, event) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
    if (event === null || typeof event !== 'object') return false;
    const state = stateOf(sessionId);

    // 1) 路由元数据：更新当前模型（即使这条事件本身不计费也要更新）
    if (event.type === 'request/header') {
      const model = event.data && event.data.header && event.data.header.config
        ? event.data.header.config.model
        : '';
      if (model) state.model = String(model);
      return false;
    }
    if (event.type === 'request/context') {
      const model = event.data ? event.data.model : '';
      if (model) state.model = String(model);
      return false;
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt' && event.type !== 'assistant/chunk') {
      return false;
    }

    // 2) 取 usage + 稳定的调用身份
    const { usage, identity } = usageIdentityOf(event);
    if (usage === undefined) return false;

    const time = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : now();
    if (time > now() + MAX_FUTURE_SKEW_MS) return false; // 时间戳明显异常，别污染"今日"
    const todayStart = beijingDayStartMs(now());
    const cutoff = todayStart - (windowDays - 1) * DAY_MS;
    if (time < cutoff) return false; // 超出保留窗口

    // 3) 归属：occurrence key + 时间桶
    const { turn, step } = event.data || {};
    const key = sessionId + '|' + String(turn) + '|' + String(step) + '|' + identity;
    const hourIndex = hourIndexOf(time);
    const dayIndex = dayIndexOf(time);

    const previous = occurrences.get(key);
    if (previous !== undefined) {
      // 同一次调用的重复样本：先整体撤销上一次，再加新的（替换语义）
      const prevHour = hours.get(previous.hourIndex);
      const prevDay = days.get(previous.dayIndex);
      if (prevHour !== undefined) addToBucket(prevHour, previous.sample, -1);
      if (prevDay !== undefined) addToBucket(prevDay, previous.sample, -1);
      occurrences.delete(key);
      counted -= 1;
    }

    const rate = rateAt(state.model, time);
    const sample = applySample(bucketsFromUsage(usage), rate, state.model, rate.regime === 'peak');
    addToBucket(bucketOf(hours, hourIndex), sample, 1);
    addToBucket(bucketOf(days, dayIndex), sample, 1);
    occurrences.set(key, {
      sample: sampleNumbers(sample),
      hourIndex,
      dayIndex,
    });
    counted += 1;

    // 防御性上限：淘汰最旧的 occurrence（Map 保持插入序）
    if (occurrences.size > maxOccurrences) {
      const oldest = occurrences.keys().next();
      if (!oldest.done) {
        const stale = occurrences.get(oldest.value);
        const staleHour = hours.get(stale.hourIndex);
        const staleDay = days.get(stale.dayIndex);
        if (staleHour !== undefined) addToBucket(staleHour, stale.sample, -1);
        if (staleDay !== undefined) addToBucket(staleDay, stale.sample, -1);
        occurrences.delete(oldest.value);
        counted -= 1;
      }
    }
    return true;
  }

  /**
   * 实时事件入口（供 `ctx.on('session/event')`）：带 seq 去重。
   * 补扫期间先排队，扫完按原顺序回放，保证 occurrence 计数器的推进顺序与
   * 真实时间一致（否则"重试"会把两条样本折成一条）。
   * @param session - 会话对象（至少要有 id）。
   * @param event - 一条会话事件。
   * @returns `true` 表示这条事件被计入。
   */
  function fold(session, event) {
    if (event === null || typeof event !== 'object') return false;
    const id = session === null || typeof session !== 'object' ? '' : String(session.id || '');
    if (id.length === 0) return false;
    if (queued !== null) {
      // 历史补扫进行中：先排队（保持到达顺序），扫完统一回放
      queued.push([id, event]);
      return false;
    }
    const state = stateOf(id);
    if (!seen(state, event.seq)) return false;
    const ok = ingest(id, event);
    if (!ok) skipped += 1;
    return ok;
  }

  /**
   * 历史补扫：从 `ctx.sessionPersistence` 逐会话读回已落盘事件，
   * 补齐"进程启动之前 / 更早会话"的用量。
   *
   * 期间到达的实时事件进队列，扫完回放；每条事件用 seq 水位与 occurrence
   * key 双重去重，所以顺序反过来也不会重复计数。
   *
   * @param persistence - `ctx.sessionPersistence`（缺失时直接跳过）。
   * @param options - `readChunk` 每批读取事件数。
   * @returns 扫描统计（同时可从 {@link snapshot} 的 scan 字段读到）。
   */
  async function scanFrom(persistence, options = {}) {
    if (scan.status === 'running') return scan;
    if (persistence === undefined || persistence === null
      || typeof persistence.list !== 'function' || typeof persistence.open !== 'function') {
      scan.status = 'unavailable';
      return scan;
    }
    const readChunk = Math.max(200, Number(options.readChunk) || 2000);
    scan.status = 'running';
    scan.startedAt = now();
    scan.error = null;
    queued = [];

    try {
      const snapshots = await persistence.list();

      for (const snapshot of snapshots) {
        const header = snapshot && snapshot.header ? snapshot.header : undefined;
        const id = header ? String(header.id || '') : '';
        if (id.length === 0) continue;
        let handle;
        try {
          handle = await persistence.open(id, 'read');
        } catch (error) {
          scan.failed += 1;
          if (scan.error === null) scan.error = String(error && error.message ? error.message : error);
          continue;
        }
        try {
          scan.sessions += 1;
          // 补扫与实时共用同一套 seq 去重（精确见过集合），
          // 所以"先实时后补扫"和"先补扫后实时"都不会重复计数
          const state = stateOf(id);
          let offset = 0;
          for (;;) {
            const slice = await handle.read(offset, readChunk);
            const events = slice && Array.isArray(slice.events) ? slice.events : [];
            if (events.length === 0) break;
            for (const event of events) {
              if (event === null || typeof event !== 'object') continue;
              scan.events += 1;
              if (!seen(state, event.seq)) continue; // 实时路径已计入
              ingest(id, event);
            }
            offset += events.length;
            if (events.length < readChunk) break;
            // 让出事件循环：历史补扫不阻塞会话处理
            await new Promise((resolve) => { setImmediate(resolve); });
          }
        } catch (error) {
          scan.failed += 1;
          if (scan.error === null) scan.error = String(error && error.message ? error.message : error);
        } finally {
          try {
            await handle.close();
          } catch {
            // 关闭失败不影响已折叠的数据
          }
        }
      }
      scan.status = 'done';
    } catch (error) {
      scan.status = 'failed';
      scan.error = String(error && error.message ? error.message : error);
    } finally {
      const buffered = queued;
      queued = null;
      for (const [id, event] of buffered) {
        const state = stateOf(id);
        if (!seen(state, event.seq)) continue;
        ingest(id, event);
      }
      scan.ms = now() - scan.startedAt;
      scan.finishedAt = now();
      prune();
    }
    return scan;
  }

  /**
   * 生成看板数据快照（可 JSON 化）。
   * @param options - `hours` 与 `days` 覆盖展示长度。
   * @returns 快照。
   */
  function snapshot(options = {}) {
    prune();
    const nowMs = now();
    const hourCount = Math.max(1, Math.min(24, Number(options.hours) || 24));
    const dayCount = Math.max(1, Math.min(90, Number(options.days) || windowDays));

    const currentHour = hourIndexOf(nowMs);
    const currentDay = dayIndexOf(nowMs);

    // 小时轴：最近 hourCount 个小时（含当前这个未走完的小时）
    const hourRows = [];
    const hourTotal = emptyBucket(0);
    for (let index = currentHour - hourCount + 1; index <= currentHour; index += 1) {
      const bucket = hours.get(index);
      const isCurrent = index === currentHour;
      if (bucket !== undefined) mergeBuckets(hourTotal, bucket);
      hourRows.push({
        index,
        hour: ((index % 24) + 24) % 24,
        day: dayKeyOf(Math.floor(index / 24)),
        current: isCurrent,
        // 该小时是否属于高峰计价时段（用小时起点判定，与 isPeakBeijing 同规则）
        peak: isPeakBeijing(index * HOUR_MS - BJ_OFFSET_MS),
        ...(bucket === undefined
          ? exportBucket(emptyBucket(index))
          : exportBucket(bucket)),
      });
    }

    // 日轴：最近 dayCount 天
    const dayRows = [];
    const dayTotal = emptyBucket(0);
    for (let index = currentDay - dayCount + 1; index <= currentDay; index += 1) {
      const bucket = days.get(index);
      if (bucket !== undefined) mergeBuckets(dayTotal, bucket);
      dayRows.push({
        index,
        date: dayKeyOf(index),
        current: index === currentDay,
        // 当天是否命中过高峰计价（用于日趋势图的峰谷图例）
        peak: bucket !== undefined && bucket.peak > 0,
        ...(bucket === undefined ? exportBucket(emptyBucket(index)) : exportBucket(bucket)),
      });
    }

    return {
      ok: true,
      now: nowMs,
      timeZone: 'Asia/Shanghai',
      windowDays,
      hours: hourRows,
      days: dayRows,
      totals: {
        today: exportBucket(days.get(currentDay) ?? emptyBucket(0)),
        last24h: exportBucket(hourTotal),
        window: exportBucket(dayTotal),
      },
      calls: counted,
      scan: { ...scan },
    };
  }

  return {
    fold,
    ingest,
    scanFrom,
    snapshot,
    /** 测试/诊断用：当前计入的调用数。 */
    get size() { return counted; },
    /** 测试/诊断用：被忽略的事件数（不含正常的路由元数据）。 */
    get skipped() { return skipped; },
    windowDays,
  };
}
