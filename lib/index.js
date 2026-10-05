/**
 * ============================================================================
 * dsh-pet 宿主半侧（host half）—— 宠物插件的"后端"部分
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件运行在 DSH 的 Node 服务端（不是浏览器）。它的唯一职责是：
 *   在 DSH 的 Web 服务器上注册一个 `/pet/` 前缀的 HTTP 路由，
 *   把插件包里的动画 WebM 文件流式返回给浏览器。
 *
 * 【为什么需要它】
 *   DSH 的 `/plugins/` 路由只服务"客户端 JS bundle"，不服务视频等静态资源。
 *   所以浏览器半侧（lib/client.js）要播放动画，必须有一个专门的路由来取文件。
 *   这正是 DSH 官方提供的扩展点：`ctx.webServer.register()`。
 *
 * 【路由结构】
 *   /pet/thumb/<动画名>.webm   → 读插件包内 assets/thumb/（360×360 播放变体）
 *   /pet/full/<动画名>.webm    → 读 $DSH_HOME/pet-assets/（原始 1200×1200，需先下载）
 *
 * 【安全性】
 *   路径做了"防穿越"校验（resolveAsset）：请求里的路径规范化后必须仍在
 *   assets 根目录内，否则返回 400。防止 /pet/../../etc/passwd 这类攻击。
 *
 * ============================================================================
 */
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
// 官方 API：解析 DSH 主目录（$DSH_HOME，默认 ~/.dsh）——full 资源存放位置
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
// 本 fork：设置面板（DSH 设置 → 桌宠配置）。
// 【DSH ≥0.1.7 的重要变化】dsh-settings 不再导出 SettingsProvider/register()/get()，
// 改成 SettingsForms：表单按 **profile 里这条插件行的 id** 生成，字段必须是 schema 里
// 标了 `.volatile()` 的（否则不进表单、也不能写），写回走 ctx.settings.mutate(entryId, ops)。
// 所以本插件：Config 逐字段 .volatile()，读值走 liveConfig(ctx, config)，
// 条目 id 由 entryIdOf(ctx) 从 loader entry 取（见下面三个函数）。
import Schema from '@deepseek-ai/schemastery';
// 本 fork：用量与计费（价格表 + 事件折叠 + 三桶费用）。抽成独立模块，便于单测。
import { computeTaskUsage, computeTodayUsage, taskSummaryLines } from './usage.js';
// 本 fork：whalePetCost 投影（浏览器半侧费用 pill 读取，与上面同一套计费内核）
import { createCostUsageProjection } from './cost-projection.js';
// 本 fork：分时段用量账本（气泡看板「分时段花费」的数据源）
import { createUsageLedger, DEFAULT_WINDOW_DAYS } from './usage-ledger.js';
// 本 fork：子会话费用汇总（纯逻辑：会话树 + 后代费用合计，供费用 pill 叠加）
import { headerOf, subtreeCost } from './subtree.js';
// 本 fork：天气响应整形（纯函数：WMO 码表 + 明日天气选取）
import { nearestAreaName, nearestCoords, shapeWeather } from './weather.js';
// 本 fork：余额响应整形（纯函数）
import { shapeBalance } from './balance.js';

// 插件行 id（与 cordis.patch.yml 一致）
const name = 'pet';
/** 需要注入的服务：
 *  - webServer：注册 /pet 与 /api/whale-pet/* 路由；
 *  - settings：配置表单读写（0.1.7 起按 profile 插件条目寻址）；
 *  - sessionProjections：注册 whalePetCost 费用投影（费用 pill）；
 *  - sessions：会话表 + 会话树（子会话费用汇总用）；
 *  - sessionPersistence：历史补扫（把已落盘会话补进账本）与血统补全。
 *  全部在 dsh-base / dsh-web-app 里都有；任何一个缺失插件就不激活（inject 是硬依赖）。 */
const inject = ['webServer', 'settings', 'sessionProjections', 'sessions', 'sessionPersistence'];

/** 本插件在 profile 配置树里的条目 id 缺省值（与 cordis.patch.yml 一致）；运行时用 entryIdOf() 取真值。 */
const NS = 'pet';

/** 桌宠可配置项（设置面板可改，立即生效）。
 *  DSH 0.1.7 的 settings 服务只把 schema 里标了 `.volatile()` 的字段放进表单，
 *  也只有这些字段能被 `ctx.settings.mutate()` 写回，所以这里逐字段标记。
 *  volatile 字段在 loader 里是"就地更新"的引用（不会重挂插件），配合下面的
 *  `liveConfig()` 读 `ctx.fiber.config` 即可拿到最新值。 */
export const Config = Schema.object({
  pomodoro: Schema.boolean().default(true).volatile(),
  pomodoroMinutes: Schema.number().min(5).max(120).default(25).volatile(),
  lateNight: Schema.boolean().default(true).volatile(),
  chatter: Schema.boolean().default(true).volatile(),
  longTaskMinutes: Schema.number().min(1).max(60).default(10).volatile(),
  city: Schema.string().default('').volatile(),
  size: Schema.number().min(40).max(400).default(260).volatile(),
  position: Schema.string().default('bottom-right').volatile(),
  // 本 fork 新增：漫游开关（关掉后宠物不乱跑，只在角落/当前位置待着，拖拽仍可用）
  roam: Schema.boolean().default(true).volatile(),
  // 本 fork 新增：按钮组位置（☁️/💰/🍪 放在宠物左侧还是右侧；left / right）
  buttonSide: Schema.string().default('left').volatile(),
  // 本 fork 新增：气泡看板——分时段花费面板
  // dashboardHistory: 启动时补扫已落盘会话（含重启前的用量），关掉则只统计本次运行
  dashboardHistory: Schema.boolean().default(true).volatile(),
  // dashboardWindowDays: 保留并展示的日趋势长度（今日 + 之前 N-1 天）
  dashboardWindowDays: Schema.number().min(1).max(30).default(7).volatile(),
  // ============================================================================
  // 费用显示开关（与 dsh-cost-meter 这类计费插件功能重合，可逐处关闭）
  // ----------------------------------------------------------------------------
  // 五个开关各自对应一个"显示费用"的位置，默认全开（行为与旧版一致）：
  //   costPillSession 输入框下方的「会话费用」pill（composer dock）
  //   costPillTurn    每条回复动作行里的「本轮费用」pill
  //   costInBubble    任务完成气泡里的花费明细（保留"用时/消耗"，只去掉花费与三桶）
  //   costBalanceButton 💰 按钮（余额 + 今日花费气泡）
  //   costDashboard   📊 分时段花费看板
  // 关掉某个位置只影响该处显示，数据与后台统计照常（费用投影、账本、路由都不变）。
  // 全部写入同一份 Config 是为了让它们出现在「设置 → 桌宠配置」面板里。
  // ============================================================================
  costPillSession: Schema.boolean().default(true).volatile(),
  costPillTurn: Schema.boolean().default(true).volatile(),
  costInBubble: Schema.boolean().default(true).volatile(),
  costBalanceButton: Schema.boolean().default(true).volatile(),
  costDashboard: Schema.boolean().default(true).volatile(),
  // ============================================================================
  // 本 fork 新增：任务完成提示（标签页角标 / 回来汇总 / 提示音）
  // ----------------------------------------------------------------------------
  //   notifyBadge   后台完成任务时给 favicon 打红点、标题加 (N) 计数，切回前台自动清
  //   notifySummary 后台完成的任务先累计，切回前台时用宠物气泡一次性汇总交代
  //   notifySound   后台完成时响一声提示音（默认是 WebAudio 合成音，用户也可上传自定义音频）
  //   notifySoundVolume 提示音音量 0..100（默认 25，避免吓人）
  //   notifySoundMode   'each' 每个任务完成都响 / 'all' 只有当前没有任务在跑时才响
  //
  // 三者都只由"抢到该 done 事件的那个标签页"触发，且只在它处于后台时生效：
  // 宿主的事件队列是读走即清空的（queue.splice），所以多标签页下天然不会重复提示；
  // 前台时不提示是因为宠物气泡/动画本来就已经在眼前了。
  // 'all' 的判定依据是同一次响应的 running 字段（宿主每次轮询都从 agent 注册表
  // 现算的权威事实），所以"最后一个任务结束"这一拍就能准确识别。
  // ============================================================================
  notifyBadge: Schema.boolean().default(true).volatile(),
  notifySummary: Schema.boolean().default(true).volatile(),
  notifySound: Schema.boolean().default(true).volatile(),
  notifySoundVolume: Schema.number().min(0).max(100).default(60).volatile(),
  notifySoundMode: Schema.string().default('each').volatile(),
});

/**
 * 本插件在 profile 配置树里的条目 id。
 *
 * DSH 0.1.7 起，设置表单不再由插件"注册命名空间"，而是按 **profile 里这条插件行
 * 的 id** 生成（`SettingsForms.describe()` 用 `entry.options.id` 做 ns），
 * `ctx.settings.update/replace/mutate` 也都按它寻址。
 *
 * @param ctx - 插件上下文。
 * @returns 条目 id；取不到时退回 bundle patch 里写死的 `pet`。
 */
function entryIdOf(ctx) {
  try {
    const entry = ctx && ctx.fiber ? ctx.fiber.entry : undefined;
    const id = entry && entry.options ? entry.options.id : undefined;
    if (typeof id === 'string' && id.length > 0) return id;
  } catch {
    // 老版本/测试替身没有 fiber.entry：退回默认值
  }
  return NS;
}

/**
 * cosmokit 的 volatile 引用协议：写入用 `Symbol.for('cosmokit.volatile.write')`，
 * 读取只有 `.get()`（**没有** `.set()`），所以必须按符号探测，且 `Symbol.for`
 * 跨 ESM/CJS 副本也成立（与 cosmokit 的 isVolatile 同一套判定）。
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/**
 * 把配置里的 volatile 引用递归解包成普通值。
 *
 * volatile 是**逐字段**包装的（`Schema.string().volatile()` → 该字段是
 * `{ get() }` 引用），所以根对象本身是普通对象、字段才是引用，必须深度遍历。
 * 复刻 dsh-settings 内部 `plainConfig()` 的口径。
 *
 * @param value - 任意配置值。
 * @returns 解包后的普通对象/数组/标量。
 */
function plainConfig(value) {
  let current = value;
  for (let depth = 0; depth < 16; depth += 1) {
    if (current === null || typeof current !== 'object') return current;
    if (VOLATILE_WRITE in current) {
      current = current.get();
      continue;
    }
    if (Array.isArray(current)) return current.map(plainConfig);
    return Object.fromEntries(Object.entries(current).map(([key, child]) => [key, plainConfig(child)]));
  }
  return current;
}

/**
 * 当前生效的配置（普通对象）。
 *
 * volatile 字段由 loader 在**原地**更新引用（不重挂插件），所以优先读
 * `ctx.fiber.config` 才能拿到设置面板刚写入的新值；拿不到时退回 `apply()` 收到的
 * `config` 快照。两者都按 {@link plainConfig} 递归解包。
 *
 * @param ctx - 插件上下文。
 * @param fallback - `apply(ctx, config)` 收到的配置。
 * @returns 普通对象形式的配置。
 */
function liveConfig(ctx, fallback) {
  let raw = fallback;
  try {
    const fiber = ctx && ctx.fiber ? ctx.fiber : undefined;
    if (fiber && fiber.config !== null && typeof fiber.config === 'object') raw = fiber.config;
  } catch {
    raw = fallback;
  }
  const value = plainConfig(raw);
  return value !== null && typeof value === 'object' ? value : (fallback || {});
}

/** 读取请求体（有上限）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** 本包目录（src 和安装后都适用——import.meta.url 指向 lib/，上一级即包根） */
const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** 路由前缀：/pet/thumb/<name>.webm、/pet/full/<name>.webm */
const ROUTE_PREFIX = '/pet';

/** 不同扩展名对应的 Content-Type 映射 */
const MIME = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/**
 * 规范化并校验请求路径，确保它在 assets 根目录内（防路径穿越）。
 * @param root - assets 根目录（绝对路径）
 * @param rel  - 解码后的、路由前缀之后的路径片段
 * @returns 规范化后的绝对文件路径；非法（穿越）时返回 undefined
 */
function resolveAsset(root, rel) {
  if (rel.length === 0) return undefined;
  // join + normalize 得到规范化路径（处理 ..、./、多余分隔符）
  const candidate = normalize(join(root, rel));
  // 根目录带分隔符的前缀，用于判断候选路径是否真的在根目录内
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  // 候选路径必须等于根目录或以"根目录/"开头，否则是穿越（如 ../lib/index.js）
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  return candidate;
}

/**
 * 宿主插件入口。
 *
 * 【为什么要包一层】
 *   DSH 的 loader 只要 `apply()` 抛错，就判定这条 entry "did not activate"，
 *   表现是**桌宠整个消失**（连浏览器半侧都不挂）。而 DSH 每个 alpha 版都可能
 *   删/改一个服务方法——0.1.7 就同时删了 `settings.register/get` 与
 *   `jobs.onJobDone`，还把 `shell.run` 改成了 `shell.execute`。所以这里兜一层：
 *   真出现意料之外的抛错，也记一条 warn 而不是让桌宠从页面上消失。
 *
 * @param ctx - 插件上下文。
 * @param config - 本行的配置（来自 patch 树）。
 */
function apply(ctx, config) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    warnSkip(ctx, '插件装配', error);
  }
}

/**
 * 装配一段"可选功能"：失败只跳过这一段，其余功能照常。
 * @param ctx - 插件上下文。
 * @param label - 功能名（日志用）。
 * @param fn - 装配函数。
 * @returns fn 的返回值；失败时 undefined。
 */
function safe(ctx, label, fn) {
  try {
    return fn();
  } catch (error) {
    warnSkip(ctx, label, error);
    return undefined;
  }
}

/**
 * 记一条"这段功能装配失败已跳过"的警告（日志本身失败也不能再抛）。
 * @param ctx - 插件上下文。
 * @param label - 功能名。
 * @param error - 捕获到的错误。
 */
function warnSkip(ctx, label, error) {
  try {
    const message = error !== null && error !== undefined && error.message !== undefined
      ? error.message
      : String(error);
    if (ctx !== undefined && ctx !== null && ctx.logger !== undefined
      && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn('dsh-whale-pet: ' + label + ' 装配失败，已跳过该功能：' + String(message));
    }
  } catch {
    // 连日志都失败就静默
  }
}

/**
 * 宿主插件主体：注册 `/pet` 前缀路由。
 * @param ctx    - 插件上下文；ctx.webServer 是 Web 服务器服务
 * @param config - 本行的配置（来自 patch 树）
 */
function applyInner(ctx, config) {
  // 设置（DSH ≥0.1.7 的 profile 表单模型）：
  //   - 不再有 ctx.settings.register()/get()：schema 由 loader 用导出的 Config 解析，
  //     生效值就是本行配置（schema 默认 → bundle patch → profile 覆盖），
  //     由 liveConfig() 从 ctx.fiber.config 实时读取（volatile 字段就地更新）；
  //   - 设置页与写回按 **profile 里这条插件行的 id** 寻址（本 bundle patch 写的是 id: pet）。
  // 定义在资源根之前：下面算 fullRoot 时就要读配置。
  const ENTRY_ID = entryIdOf(ctx);
  const resolveConfig = () => liveConfig(ctx, config);

  // 两个资源根：
  // - thumbRoot：插件包内 assets/thumb/（360×360 播放变体，随包发布，一定存在）
  // - fullRoot ：$DSH_HOME/pet-assets/（原始母版，需手动下载，可能不存在）
  const thumbRoot = join(PACKAGE_ROOT, 'assets', 'thumb');
  const fullRoot = resolveConfig().fullRoot ?? join(resolveDshHome(), 'pet-assets');

  // 本 fork：注册 whalePetCost 投影（输入框下方费用 pill 读取；与气泡/余额共用 lib/usage.js）
  safe(ctx, 'whalePetCost 投影', () => ctx.sessionProjections.register(createCostUsageProjection()));

  // ============================================================================
  // 本 fork 新增：分时段用量账本（气泡看板 /api/whale-pet/usage 的数据源）
  // ----------------------------------------------------------------------------
  // 实时：ctx.on('session/event') 增量折叠（O(1) 每条事件，不轮询、不写盘）
  // 历史：启动时用 ctx.sessionPersistence 逐会话读回已落盘事件补扫一遍，
  //       让"重启前的今天早上"也留在小时桶里。
  // 去重：两条路径共用"每会话已见 seq 集合 + occurrence key"，所以无论
  //       谁先谁后都不会重复计数（见 lib/usage-ledger.js 的 seen()）。
  // 失败：历史补扫只是锦上添花——列表/读取失败会记进 scan 统计并由前端
  //       提示，同时退化为"仅本次运行实时统计"，不影响桌宠其他功能。
  // ============================================================================
  const ledger = createUsageLedger({
    windowDays: Number(resolveConfig().dashboardWindowDays) || DEFAULT_WINDOW_DAYS,
  });
  safe(ctx, '用量账本实时折叠', () => ctx.on('session/event', (session, event) => { ledger.fold(session, event); }));

  // 历史补扫：启动时跑一次；若启动时关了 dashboardHistory、之后在设置面板打开，
  // 由下面需要它的路由按需补跑一次（volatile 设置不会重挂插件，所以必须懒触发）。
  let historyScanStarted = false;
  const ensureHistoryScan = () => {
    if (historyScanStarted) return;
    if (resolveConfig().dashboardHistory === false) return;
    const service = ctx.get('sessionPersistence');
    if (service === undefined) return;
    historyScanStarted = true;
    ledger.scanFrom(service).catch(() => {});
  };
  if (resolveConfig().dashboardHistory !== false) {
    // 延后一拍：别和宿主启动的关键路径抢时间；失败也只是退化为实时统计
    const boot = setTimeout(() => { ensureHistoryScan(); }, 1500);
    if (typeof boot.unref === 'function') boot.unref();
    ctx.effect(() => () => { clearTimeout(boot); }, 'dsh-whale-pet: dashboard history scan');
  }

  // ctx.effect 包裹：插件卸载时自动注销路由（官方生命周期管理）
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',     // 前缀路由：匹配 /pet 以及 /pet/xxx
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // 去掉 /pet/ 前缀并 URL 解码（中文文件名是编码后的）
      const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
      // 第一段是 scope：thumb 或 full
      const [scope, ...nameParts] = rest.split('/');
      if (scope !== 'thumb' && scope !== 'full') {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('dsh-pet: expected /pet/{thumb|full}/<file>');
        return;
      }
      // 剩余部分是文件名（可能含空格/中文，原样保留）
      const fileName = nameParts.join('/');
      const root = scope === 'thumb' ? thumbRoot : fullRoot;
      // 防穿越校验
      const file = resolveAsset(root, fileName);
      if (file === undefined) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('dsh-pet: invalid path');
        return;
      }
      // 文件不存在：full 未下载 vs thumb 缺失给不同提示
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(scope === 'full'
          ? `dsh-pet: original asset not downloaded yet — run the fetch-assets script to populate ${fullRoot}`
          : 'dsh-pet: asset not found');
        return;
      }
      // 按扩展名定 Content-Type，附 Content-Length（浏览器可显示进度）
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      const contentType = MIME[ext] ?? 'application/octet-stream';
      const { size } = await stat(file);
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': size,
        // 缓存 1 小时：动画是静态文件，重复播放直接命中缓存
        'cache-control': 'public, max-age=3600',
      });
      // 流式返回（大文件不占内存）
      const stream = createReadStream(file);
      stream.on('error', () => {
        res.destroy();
      });
      stream.pipe(res);
    },
  }), 'dsh-pet: /pet asset route');

  // ============================================================================
  // 本 fork 新增：任务状态镜像 —— 监听 Agent 任务事件，供浏览器轮询
  // ============================================================================
  const queue = [];
  const MAX = 60;
  let seq = 0;
  let lastAgentIdleAt = 0;

  const push = (item) => {
    seq += 1;
    const entry = { id: 'wp-' + seq, at: Date.now(), type: item.type };
    if (item.mood !== undefined) entry.mood = item.mood;
    if (item.ok !== undefined) entry.ok = item.ok;
    if (item.name !== undefined) entry.name = item.name;
    if (item.title !== undefined) entry.title = item.title;
    if (item.message !== undefined) entry.message = item.message;
    // 本 fork 新增：完成类事件的结构化数值（客户端「回来汇总」直接求和，
    // 不必去解析气泡里的多行中文文本；后台任务/子代理那几条没有这些字段）
    if (item.durSec !== undefined) entry.durSec = item.durSec;
    if (item.tokens !== undefined) entry.tokens = item.tokens;
    if (item.costCny !== undefined) entry.costCny = item.costCny;
    queue.push(entry);
    if (queue.length > MAX) queue.shift();
  };

  // 1) 回合状态：running → 工作（敲键盘），idle → 待机 + 完成提醒（4 秒冷却）
  //    本 fork：任务结束时统计本次任务（自开工以来所有会话，含子代理）的
  //    token 消耗与花费，附在完成气泡里。
  ctx.on('agent/status', (payload) => {
    if (!payload) return;
    if (payload.status === 'running') {
      runningSince = Date.now();
      longTaskReminded = false;
      push({ type: 'mood', mood: 'working' });
    } else if (payload.status === 'idle') {
      const taskSince = runningSince;
      runningSince = 0;
      push({ type: 'mood', mood: 'idle' });
      const now = Date.now();
      if (now - lastAgentIdleAt < 4000) return;
      lastAgentIdleAt = now;
      let message = '这一轮任务已经搞定啦～';
      // 本 fork 新增：随 done 事件带上结构化数值，供客户端「回来汇总」精确求和
      const summary = {};
      if (taskSince > 0) {
        // 完成气泡排版：多行结构化信息（用时 / 消耗 / 花费 + 命中·未命中·输出三桶），客户端左对齐展示
        const durSec = Math.round((now - taskSince) / 1000);
        const durStr = durSec >= 60 ? Math.floor(durSec / 60) + '分' + (durSec % 60) + '秒' : durSec + '秒';
        const usage = computeTaskUsage(ctx, taskSince);
        // 费用显示开关 costInBubble：关掉后气泡只留「用时 / 消耗」，不再出花费与三桶
        message = taskSummaryLines(durStr, usage, {
          withCost: resolveConfig().costInBubble !== false,
        }).join('\n');
        summary.durSec = durSec;
        if (usage && usage.ok) {
          summary.tokens = usage.total;
          summary.costCny = usage.costCny;
        }
      }
      push(Object.assign({ type: 'done', ok: true, title: '任务完成啦！', message }, summary));
    }
  });

  // 2) 后台任务完成
  // 【DSH ≥0.1.7 的破坏性变更】jobs 服务**删除了 `onJobDone(cb)`**，改成事件流：
  //   ctx.jobs.events.subscribe(filter, listener) → 'settled' 事件带 job 投影
  //   （JobView.status: running | stopping | completed | killed | failed，
  //     cause: producer | kill | teardown；detail 是终止原因）。
  // 两条路径都留：优先用事件流，老版本退回 onJobDone；都没有就静默跳过。
  const jobs = ctx.get('jobs');
  if (jobs !== undefined) {
    const onJobSettled = (job) => {
      if (!job) return;
      const label = job.label || job.id || '后台任务';
      if (job.status === 'completed') {
        push({ type: 'done', ok: true, title: '后台任务完成！', message: '「' + label + '」搞定啦～' });
      } else if (job.status === 'killed') {
        push({ type: 'done', ok: false, title: '后台任务被取消', message: '「' + label + '」被取消了～' });
      } else {
        push({ type: 'done', ok: false, title: '后台任务出错了', message: '「' + label + '」翻车了' + (job.detail ? '：' + String(job.detail) : '') });
      }
    };
    safe(ctx, '后台任务通知', () => ctx.effect(() => {
      const events = jobs.events;
      if (events !== undefined && events !== null && typeof events.subscribe === 'function') {
        return events.subscribe({ owners: 'all' }, (event) => {
          if (!event || event.type !== 'settled') return;
          // 组合卸载时的结算不是"任务完成"，别打扰用户
          if (event.cause === 'teardown') return;
          onJobSettled(event.job);
        });
      }
      if (typeof jobs.onJobDone === 'function') {
        return jobs.onJobDone((snapshot) => onJobSettled(snapshot));
      }
      return undefined;
    }, 'dsh-whale-pet: job completion notices'));
  }

  // 3) 子代理结束
  ctx.on('subagent/end', (info) => {
    if (!info) return;
    const who = info.provider || '子代理';
    if (info.stopReason === 'completed') {
      push({ type: 'done', ok: true, title: '子任务完成！', message: '「' + who + '」的活儿干完啦～' });
    } else {
      push({ type: 'done', ok: info.stopReason === 'aborted', title: info.stopReason === 'aborted' ? '子任务被中止' : '子任务出错了', message: '「' + who + '」结束了（' + String(info.stopReason) + '）' });
    }
  });

  // 4) 工作流结束
  ctx.on('workflow/end', (info, result) => {
    if (!info) return;
    const wfName = (info.meta && info.meta.name) || String(info.id || '工作流');
    const ok = result && result.stopReason === 'completed';
    push({
      type: 'done',
      ok: !!ok,
      title: ok ? '流程任务完成！' : '流程任务结束',
      message: ok ? '「' + wfName + '」工作流跑完啦～' : '「' + wfName + '」结束了（' + String(result && result.stopReason) + '）',
    });
  });

  // 5) 工具活动：让打字气泡显示真实工作内容
  ctx.on('tools/result', (exec) => {
    if (exec && typeof exec.name === 'string' && exec.name) {
      push({ type: 'activity', name: String(exec.name) });
    }
  });

  // 6) 会话出错：炸毛 + 红色气泡
  ctx.on('agent/error', (payload) => {
    if (!payload) return;
    const errMsg = payload.error && payload.error.message ? String(payload.error.message) : String(payload.error);
    push({ type: 'done', ok: false, title: '出错了！', message: '第 ' + String(payload.turn || '?') + ' 轮翻车了：' + errMsg.slice(0, 120) });
  });

  // 7) 目标状态：达成 → 庆祝；受阻 → 红色提醒
  ctx.on('goal/changed', (payload) => {
    if (!payload || !payload.change) return;
    const op = payload.change.operation;
    if (op === 'complete') {
      push({ type: 'done', ok: true, title: '目标达成！', message: '大目标完成，撒花～' });
    } else if (op === 'block') {
      push({ type: 'done', ok: false, title: '目标受阻', message: '目标卡住了…去看看？' });
    }
  });

  // 8) 长任务提醒：工作超过 N 分钟（可在设置面板调）→ 敲桌子吐槽一次
  let runningSince = 0;
  let longTaskReminded = false;
  const timer = ctx.get('timer');
  if (timer !== undefined) {
    safe(ctx, '长任务提醒', () => ctx.effect(() => {
      const dispose = timer.interval(() => {
        const minutes = Number(resolveConfig().longTaskMinutes) || 10;
        if (runningSince > 0 && !longTaskReminded && Date.now() - runningSince >= minutes * 60000) {
          longTaskReminded = true;
          push({ type: 'done', ok: true, title: '还没完呢…', message: '都干了 ' + minutes + ' 分钟了，还没完呢' });
        }
      }, 30000);
      return dispose;
    }, 'dsh-whale-pet: long task reminder'));
  }

  // 轮询接口：GET /api/whale-pet/state → 取走排队中的状态/通知 + 当前设置 + 权威工作状态
  //
  // 【为什么带一个 running 字段】状态转移原来是"边沿事件"驱动的：agent/status
  // 发一次 idle，客户端就复位。事件只要漏一条（被别的消费者抢走、插件晚挂载、
  // 宿主重启期间的窗口），桌宠就会永远卡在"工作中"——手动点停止后不回到待机
  // 就是这种卡死。这里每次轮询都带上从 agent 注册表读出的**权威事实**，
  // 客户端据此自愈：事件丢了最多 800ms 后也会被纠正。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-pet/state',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const items = queue.splice(0, queue.length);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ items, settings: resolveConfig(), running: anyAgentRunning(ctx) }));
    },
  }), 'dsh-whale-pet: /api/whale-pet/state route');

  // 本 fork 新增：余额查询路由（同源，GET /api/whale-balance）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-balance',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const out = await queryBalance(ctx);
      // 本 fork 新增：同一响应附上"今日 token 消耗 + 今日花费"（本地统计，不依赖余额接口）
      // 走分时段账本：覆盖所有会话（含子代理）并含历史补扫，重启后也算得准。
      // 【费用显示开关 costBalanceButton】关掉 💰 按钮后客户端不会再请求本路由，
      // 这里也跳过今日用量的计算（少做一次全量折叠），响应只留余额部分。
      const balanceUsage = resolveConfig().costBalanceButton === false ? undefined : computeTodayUsage(ctx, ledger);
      res.writeHead(out.ok ? 200 : 502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(balanceUsage === undefined ? out : { ...out, usage: balanceUsage }));
    },
  }), 'dsh-whale-pet: /api/whale-balance route');

  // 本 fork 新增：天气查询（GET /api/whale-pet/weather，wttr.in 免费接口）
  //
  // 【issue #2】旧实现把「取数 + 整形」整段写成 Windows PowerShell 脚本交给
  // `ctx.get('shell')` 执行，而 DSH 在 Linux/macOS 上的 shell 服务是 bash -c，
  // 于是第一行 `[Console]::OutputEncoding` 就报「未找到命令」，天气与余额按钮
  // 在非 Windows 上必然失败。现在改成宿主 Node 直接 fetch（整形在 lib/weather.js），
  // 既跨平台，也不再需要为「网络」申请 danger-full-access 沙箱策略。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-pet/weather',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const data = await queryWeather(resolveConfig().city);
      res.writeHead(data && data.ok ? 200 : 502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    },
  }), 'dsh-whale-pet: /api/whale-pet/weather route');

  // 本 fork 新增：分时段用量看板（GET /api/whale-pet/usage，气泡看板读取）
  //   ?days=1..30  覆盖窗口长度（默认取设置里的 dashboardWindowDays）
  //   ?hours=1..24 覆盖小时轴长度
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-pet/usage',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parse = (name, min, max) => {
        const raw = Number(url.searchParams.get(name));
        return Number.isFinite(raw) && raw >= min && raw <= max ? Math.floor(raw) : undefined;
      };
      const hours = parse('hours', 1, 24);
      const days = parse('days', 1, 30) ?? Number(resolveConfig().dashboardWindowDays) ?? DEFAULT_WINDOW_DAYS;
      ensureHistoryScan();
      let data;
      try {
        data = ledger.snapshot({ hours, days });
      } catch (error) {
        data = { ok: false, error: String(error && error.message ? error.message : error) };
      }
      res.writeHead(data.ok ? 200 : 500, {
        'content-type': 'application/json; charset=utf-8',
        // 实时数据：绝不缓存
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(data));
    },
  }), 'dsh-whale-pet: /api/whale-pet/usage route');

  // 会话血统缓存：`conversation.chat.assistant-actions` 是**每条回复一个**槽位条目，
  // 每个费用 pill 都在轮询 /api/whale-pet/subtree-cost。没有缓存的话，
  // 每次请求都会 sessionPersistence.list() 扫一遍磁盘，N 个回合就是 N 倍开销。
  // 5 秒 TTL + 并发合并后，全局最多 5 秒一次扫描。
  const lineageCache = { at: 0, value: null, pending: null };
  const cachedHeaders = async () => {
    const now = Date.now();
    if (lineageCache.value !== null && now - lineageCache.at < 5000) return lineageCache.value;
    if (lineageCache.pending === null) {
      lineageCache.pending = sessionHeaders(ctx)
        .then((headers) => {
          lineageCache.value = headers;
          lineageCache.at = Date.now();
          return headers;
        })
        .finally(() => { lineageCache.pending = null; });
    }
    return lineageCache.pending;
  };

  // 本 fork 新增：子会话（subagent）费用汇总（GET /api/whale-pet/subtree-cost?session=<id>）
  //
  // 【为什么必须由宿主算】
  //   浏览器半侧的费用 pill 读的是 `whalePetCost` 会话投影，而投影只折叠**本条会话
  //   自己的日志**；子代理是独立会话（origin: 'subagent'），所以"本会话费用"天然
  //   漏掉它们的开销。宿主侧的账本折叠了所有会话并按会话 id 记了累计，因此由宿主
  //   按会话树汇总后返回给 pill 叠加。
  //
  // 返回：
  //   descendants —— 全部后代会话的合计（金额 / token / 调用数）
  //   byTurn      —— 按"子会话创建时父会话所处的 turn"归集的金额（本轮费用 pill 用）
  //   sessions    —— 各后代会话的明细（诊断用）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-pet/subtree-cost',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const sessionId = String(url.searchParams.get('session') || '');
      if (sessionId.length === 0) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'missing session' }));
        return;
      }
      let data;
      try {
        data = await subtreeCostOf(ctx, ledger, sessionId, await cachedHeaders());
      } catch (error) {
        data = { ok: false, error: redact(String(error && error.message ? error.message : error)) };
      }
      res.writeHead(data.ok ? 200 : 500, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(data));
    },
  }), 'dsh-whale-pet: /api/whale-pet/subtree-cost route');

  // 本 fork 新增：设置读写 API（GET/POST /api/whale-pet/settings）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-pet/settings',
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ value: resolveConfig(), writable: ctx.settings.writable }));
          return;
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const parsed = JSON.parse(body);
          const ops = parsed && Array.isArray(parsed.ops) ? parsed.ops : [];
          await ctx.settings.mutate(ENTRY_ID, ops);
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
      }
    },
  }), 'dsh-whale-pet: settings routes');
}

// ============================================================================
// 本 fork 新增：会话树取数 + 子会话费用汇总
// 纯聚合逻辑在 lib/subtree.js（零依赖、可单测），这里只负责从 ctx 取数据。
// ============================================================================

/**
 * 收集所有已知会话的 header：先在线会话（含正在跑的子代理），再补已落盘会话。
 * 两份都要——子代理结束后会从在线集合消失，只有落盘那份还留着 parentSession。
 * 顺序即优先级：lib/subtree.js 的 buildLineage 对重复 id 只认第一个。
 * @param ctx - 插件上下文。
 * @returns header 列表。
 */
async function sessionHeaders(ctx) {
  const headers = [];
  try {
    const sessions = ctx.get('sessions');
    if (sessions !== undefined && typeof sessions.list === 'function') {
      const list = sessions.list();
      if (Array.isArray(list)) for (const session of list) headers.push(headerOf(session));
    }
  } catch {
    // 在线集合取不到就只靠落盘那份
  }
  try {
    const persistence = ctx.get('sessionPersistence');
    if (persistence !== undefined && typeof persistence.list === 'function') {
      const snapshots = await persistence.list();
      if (Array.isArray(snapshots)) for (const snapshot of snapshots) headers.push(headerOf(snapshot));
    }
  } catch {
    // 落盘列表读失败不影响在线那份
  }
  return headers;
}

/**
 * 汇总某会话的后代费用：取数（在线 + 落盘 header、根会话事件）+ 纯聚合。
 * @param ctx - 插件上下文。
 * @param ledger - 分时段账本（提供按会话的累计）。
 * @param sessionId - 根会话 id。
 * @param headers - 已取好的会话 header 列表（走缓存时传入；缺省则现取）。
 * @returns 可 JSON 化的响应。
 */
async function subtreeCostOf(ctx, ledger, sessionId, headers) {
  const rows = Array.isArray(headers) ? headers : await sessionHeaders(ctx);
  let rootEvents;
  try {
    const sessions = ctx.get('sessions');
    const root = sessions !== undefined && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined;
    rootEvents = root !== undefined && root !== null && typeof root.snapshotEvents === 'function'
      ? root.snapshotEvents()
      : undefined;
  } catch {
    rootEvents = undefined;
  }
  const sessionCost = ledger !== undefined && ledger !== null && typeof ledger.sessionCost === 'function'
    ? (id) => ledger.sessionCost(id)
    : undefined;
  return subtreeCost({ headers: rows, rootSessionId: sessionId, sessionCost, rootEvents });
}

// ============================================================================
// 本 fork 新增：天气 / 余额查询的宿主侧实现（Node 直连，不再经过 shell）
//
// 【issue #2】旧实现把这两段写成 Windows PowerShell 脚本交给 `ctx.get('shell')`
// 执行：DSH 在 Linux/macOS 上的 shell 服务是 `bash -c`，脚本第一行就语法错误，
// 所以天气与余额按钮实际上只在 Windows 可用。宿主半侧本身就跑在 Node 里
// （engines 要求 ^22.19.0 || >=24.0.0），全局 fetch 可用——直连既跨平台，又能把
// 真实的 HTTP 状态带回给用户；顺带不再需要为「网络」申请 danger-full-access
// 沙箱策略。整形逻辑放在 lib/weather.js 与 lib/balance.js（纯函数、可单测）。
// ============================================================================

/** 对外请求超时（毫秒）。与旧 PowerShell 脚本的 -TimeoutSec 15 保持一致。 */
const FETCH_TIMEOUT_MS = 15000;

/**
 * 查询明日天气（宿主 Node 直连 wttr.in，不再经过 shell）。
 *
 * 取值逻辑与旧脚本逐条对齐（见 lib/weather.js）：
 *   1) 设置里填了城市 → 直接显示它（保证中文）；
 *   2) 没填 → 用 wttr 返回的最近站点经纬度反查简体中文地名，查不到退回站点名；
 *   3) 明日天气取 weather[1]，天气码优先 12:00/15:00，兜底白天最早一段。
 * 本函数不抛异常（任何失败都返回 { ok:false, error }），所以路由里不需要 try/catch。
 *
 * @param rawCity - 设置里配置的城市名（空 = 自动定位）。由 applyInner 里的
 *   `resolveConfig().city` 传进来——`resolveConfig` 是 applyInner 的闭包变量，
 *   模块作用域拿不到（曾经因此报过 `resolveConfig is not defined`）。
 * @returns { ok:true, city, icon, temp, tomorrowIcon, tomorrowLow, tomorrowHigh, tomorrowDesc } 或 { ok:false, error }。
 */
async function queryWeather(rawCity) {
  try {
    // 城市名先按白名单清洗（字母数字/下划线/中文/空格/连字符），再交给 URL 编码
    const city = String(rawCity || '').replace(/[^\w\u4e00-\u9fa5 \-]/g, '').slice(0, 40);
    // 没配城市时不拼路径：wttr.in 会按请求来源自动定位（与旧脚本一致）
    const url = 'https://wttr.in/' + (city ? encodeURIComponent(city) : '') + '?format=j1&lang=zh';
    const res = await fetch(url, {
      headers: { 'user-agent': 'curl/8', accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: redact('wttr.in 请求失败（HTTP ' + String(res.status) + '）') };
    const json = await res.json();
    const cityName = city || await reverseGeocodeCity(json);
    return shapeWeather(json, cityName);
  } catch (error) {
    return { ok: false, error: redact('天气查询失败：' + String(error && error.message ? error.message : error)) };
  }
}

/**
 * 自动定位：用 wttr 最近站点的经纬度反查简体中文地名（bigdatacloud 免费接口）。
 *
 * 反查失败不算失败——依次退回 wttr 自带的站点名、「当前位置」。旧脚本在反查失败时
 * 整条失败，会出现「天气其实拿到了，却因为地名查不到而不显示」。
 *
 * @param json - wttr j1 JSON。
 * @returns 城市名（永不返回空串）。
 */
async function reverseGeocodeCity(json) {
  const coords = nearestCoords(json);
  if (coords !== undefined) {
    try {
      const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude='
        + encodeURIComponent(coords.latitude) + '&longitude=' + encodeURIComponent(coords.longitude)
        + '&localityLanguage=zh-Hans';
      const res = await fetch(url, {
        headers: { 'user-agent': 'dsh-whale-pet' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const geo = await res.json();
        const name = geo && (geo.city || geo.locality || geo.principalSubdivision);
        if (typeof name === 'string' && name) return name;
      }
    } catch {
      // 反查只是锦上添花：失败就往下走兜底
    }
  }
  return nearestAreaName(json) ?? '当前位置';
}

// ============================================================================
// 本 fork 新增：DeepSeek 账户余额查询（GET /api/whale-balance）
// 复用本机 DEEPSEEK_API_KEY 凭据，宿主 Node 直连官方余额接口（不再经 shell，见 issue #2）。
// ============================================================================

/** 错误信息脱敏：绝不把 sk- 开头的密钥带出去。 */
function redact(value) {
  return String(value).replace(/sk-[A-Za-z0-9]{6,}/gi, 'sk-***');
}

/**
 * 当前是否有任何 agent 正在工作（权威事实，供客户端自愈）。
 *
 * 【为什么不能只靠事件】`agent/status` 是边沿触发的：只发"变化"。少收一条
 * `idle`（队列被别的消费者抢走、插件晚挂载、宿主重启窗口）客户端就永远卡在
 * "工作中"。这个函数每次被轮询现算，所以丢事件也能在下一个周期被纠正。
 *
 * `ctx.get('agents').list()` 是在册的全部 agent（含子代理）；`status` 由
 * dsh-agent-loop 的 Agent 提供（'idle' | 'running'）。取不到就返回 undefined，
 * 客户端会退回纯事件驱动（老版本 DSH 行为不变）。
 *
 * @param ctx - 插件上下文。
 * @returns true/false，或 undefined（agents 服务不可用/形状不符）。
 */
function anyAgentRunning(ctx) {
  try {
    const agents = ctx.get('agents');
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return undefined;
    const list = agents.list();
    if (!Array.isArray(list)) return undefined;
    return list.some((agent) => agent !== null && agent !== undefined && agent.status === 'running');
  } catch {
    return undefined;
  }
}

/** 查询余额，返回可 JSON 化的 { ok, currency, total, granted, topped } 或 { ok:false, error }。 */
async function queryBalance(ctx) {
  const credentials = ctx.get('credentials');
  let apiKey = '';
  if (credentials !== undefined) {
    const candidates = ['DEEPSEEK_API_KEY', 'deepseek', 'DEEPSEEK_KEY'];
    for (let i = 0; i < candidates.length && !apiKey; i++) {
      try {
        const resolved = await credentials.resolve(candidates[i]);
        if (resolved && typeof resolved.value === 'string' && resolved.value) apiKey = resolved.value;
      } catch {
        // try next candidate
      }
    }
  }
  if (!apiKey) return { ok: false, error: '没有找到 DeepSeek API Key（DEEPSEEK_API_KEY 未配置）' };

  // 【issue #2】直连官方余额接口，不再经过 shell（Linux/macOS 上旧实现必然失败）。
  // 也不再把 key 过滤成 [A-Za-z0-9._-]：旧实现是为防 shell 注入而清洗，会破坏含其他
  // 字符的 key；现在 key 只进 HTTP 头，原样传递即可。
  let json;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { authorization: 'Bearer ' + apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { body = ''; }
      return { ok: false, error: redact('余额接口返回 HTTP ' + String(res.status) + (body ? '：' + body.slice(0, 200) : '')) };
    }
    json = await res.json();
  } catch (error) {
    return { ok: false, error: redact('查询请求失败：' + String(error && error.message ? error.message : error)) };
  }
  return shapeBalance(json);
}

// 本 fork 的用量与计费实现在 lib/usage.js（纯逻辑、可单测）：
//   computeTodayUsage / computeTaskUsage / taskSummaryLines / rateAt / foldTodayUsage

// 导出插件三件套（Cordis Loader 需要）
export { apply, inject, name };
