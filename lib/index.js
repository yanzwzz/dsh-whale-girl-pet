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
// 本 fork：设置面板（DSH 设置 → 桌宠配置，持久化到 settings.yaml 用户层）
import Schema from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';

// 插件行 id（与 cordis.patch.yml 一致）
const name = 'pet';
/** 需要注入的服务：webServer（Web 服务器路由注册表）、settings（配置命名空间） */
const inject = ['webServer', 'settings'];

/** settings namespace（settings.yaml 用户层 section 名）。 */
const NS = settingsNamespace('whale-pet');

/** 桌宠可配置项（设置面板可改，重启不丢）。 */
export const Config = Schema.object({
  pomodoro: Schema.boolean().default(true),
  pomodoroMinutes: Schema.number().min(5).max(120).default(25),
  lateNight: Schema.boolean().default(true),
  chatter: Schema.boolean().default(true),
  longTaskMinutes: Schema.number().min(1).max(60).default(10),
  city: Schema.string().default(''),
  size: Schema.number().min(40).max(400).default(260),
  position: Schema.string().default('bottom-right'),
  // 本 fork 新增：漫游开关（关掉后宠物不乱跑，只在角落/当前位置待着，拖拽仍可用）
  roam: Schema.boolean().default(true),
  // 本 fork 新增：按钮组位置（☁️/💰/🍪 放在宠物左侧还是右侧；left / right）
  buttonSide: Schema.string().default('left'),
});

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
 * 宿主插件主体：注册 `/pet` 前缀路由。
 * @param ctx    - 插件上下文；ctx.webServer 是 Web 服务器服务
 * @param config - 本行的配置（来自 patch 树）
 */
function apply(ctx, config) {
  // 两个资源根：
  // - thumbRoot：插件包内 assets/thumb/（360×360 播放变体，随包发布，一定存在）
  // - fullRoot ：$DSH_HOME/pet-assets/（原始母版，需手动下载，可能不存在）
  const thumbRoot = join(PACKAGE_ROOT, 'assets', 'thumb');
  const fullRoot = config.fullRoot ?? join(resolveDshHome(), 'pet-assets');

  // 本 fork：注册设置命名空间（schema 默认 → patch base → settings.yaml 用户层）
  ctx.settings.register(NS, Config, { base: config });
  const resolveConfig = () => {
    const resolved = ctx.settings.get(NS);
    return resolved && typeof resolved === 'object' ? resolved : config;
  };

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
      if (taskSince > 0) {
        // 完成气泡排版：多行结构化信息（用时 / 消耗 / 花费），客户端左对齐展示
        const durSec = Math.round((now - taskSince) / 1000);
        const durStr = durSec >= 60 ? Math.floor(durSec / 60) + '分' + (durSec % 60) + '秒' : durSec + '秒';
        const lines = ['用时 ' + durStr];
        const usage = computeTaskUsage(ctx, taskSince);
        if (usage && usage.ok && usage.total > 0) {
          lines.push('消耗 ' + fmtTokens(usage.total) + ' tokens');
          lines.push('花费 ' + (usage.costCny > 0 && usage.costCny < 0.01 ? '<¥0.01' : '≈¥' + usage.costCny.toFixed(2)));
        }
        message = lines.join('\n');
      }
      push({ type: 'done', ok: true, title: '任务完成啦！', message });
    }
  });

  // 2) 后台任务完成
  const jobs = ctx.get('jobs');
  if (jobs !== undefined) {
    ctx.effect(() => jobs.onJobDone((snapshot) => {
      if (!snapshot) return;
      const label = snapshot.label || snapshot.id || '后台任务';
      if (snapshot.status === 'completed') {
        push({ type: 'done', ok: true, title: '后台任务完成！', message: '「' + label + '」搞定啦～' });
      } else if (snapshot.status === 'killed') {
        push({ type: 'done', ok: false, title: '后台任务被取消', message: '「' + label + '」被取消了～' });
      } else {
        push({ type: 'done', ok: false, title: '后台任务出错了', message: '「' + label + '」翻车了' + (snapshot.detail ? '：' + String(snapshot.detail) : '') });
      }
    }));
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
    ctx.effect(() => {
      const dispose = timer.interval(() => {
        const minutes = Number(resolveConfig().longTaskMinutes) || 10;
        if (runningSince > 0 && !longTaskReminded && Date.now() - runningSince >= minutes * 60000) {
          longTaskReminded = true;
          push({ type: 'done', ok: true, title: '还没完呢…', message: '都干了 ' + minutes + ' 分钟了，还没完呢' });
        }
      }, 30000);
      return dispose;
    });
  }

  // 轮询接口：GET /api/whale-pet/state → 取走排队中的状态/通知 + 当前设置
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
      res.end(JSON.stringify({ items, settings: resolveConfig() }));
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
      const usage = computeTodayUsage(ctx);
      res.writeHead(out.ok ? 200 : 502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ...out, usage }));
    },
  }), 'dsh-whale-pet: /api/whale-balance route');

  // 本 fork 新增：天气查询（GET /api/whale-pet/weather，wttr.in 免费接口）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/whale-pet/weather',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const shell = ctx.get('shell');
      if (shell === undefined) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'shell 服务不可用' }));
        return;
      }
      const city = String((resolveConfig().city) || '').replace(/[^\w\u4e00-\u9fa5 \-]/g, '').slice(0, 40);
      // 天气策略（统一走 wttr.in j1 三日 JSON，主打明日预报）：
      // - 设置了城市：直接显示用户配置的城市名（保证中文）；
      // - 自动定位：bigdatacloud 反查简体中文地名（zh-Hans）；
      // - 明日天气取 weather[1]：最高/最低温 + 午后（12/15 点）天气码，描述由本地 WMO 码表映射为中文。
      // [Console]::OutputEncoding 强制 UTF-8：Windows PowerShell 5.1 重定向输出默认 GBK，中文会乱码。
      const command = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n'
        + '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n'
        + '$ErrorActionPreference = \'Stop\'\n'
        + 'function WmoIcon([int]$code) {\n'
        + '  if ($code -eq 0) { return \'☀️\' }\n'
        + '  elseif ($code -le 2) { return \'⛅\' }\n'
        + '  elseif ($code -eq 3) { return \'☁️\' }\n'
        + '  elseif ($code -eq 45 -or $code -eq 48) { return \'🌫️\' }\n'
        + '  elseif ($code -ge 51 -and $code -le 57) { return \'🌦️\' }\n'
        + '  elseif ($code -ge 61 -and $code -le 67) { return \'🌧️\' }\n'
        + '  elseif ($code -ge 71 -and $code -le 77) { return \'❄️\' }\n'
        + '  elseif ($code -ge 80 -and $code -le 82) { return \'🌧️\' }\n'
        + '  elseif ($code -ge 85 -and $code -le 86) { return \'🌨️\' }\n'
        + '  elseif ($code -ge 95) { return \'⛈️\' }\n'
        + '  return \'🌤\'\n'
        + '}\n'
        + 'function WmoDesc([int]$code) {\n'
        + '  if ($code -eq 0) { return \'晴\' }\n'
        + '  elseif ($code -eq 1) { return \'大致晴朗\' }\n'
        + '  elseif ($code -eq 2) { return \'局部多云\' }\n'
        + '  elseif ($code -eq 3) { return \'阴\' }\n'
        + '  elseif ($code -eq 45 -or $code -eq 48) { return \'雾\' }\n'
        + '  elseif ($code -ge 51 -and $code -le 57) { return \'毛毛雨\' }\n'
        + '  elseif ($code -eq 61 -or $code -eq 66 -or $code -eq 67) { return \'小雨\' }\n'
        + '  elseif ($code -eq 63) { return \'中雨\' }\n'
        + '  elseif ($code -eq 65) { return \'大雨\' }\n'
        + '  elseif ($code -ge 71 -and $code -le 77) { return \'雪\' }\n'
        + '  elseif ($code -eq 80) { return \'阵雨\' }\n'
        + '  elseif ($code -eq 81 -or $code -eq 82) { return \'强阵雨\' }\n'
        + '  elseif ($code -ge 85 -and $code -le 86) { return \'阵雪\' }\n'
        + '  elseif ($code -ge 95) { return \'雷雨\' }\n'
        + '  return \'多云\'\n'
        + '}\n'
        + 'try {\n'
        + '  $base = \'https://wttr.in/\'\n'
        + '  if ($env:WB_CITY) { $base = $base + [uri]::EscapeDataString($env:WB_CITY) }\n'
        + '  $w = Invoke-RestMethod -Uri ($base + \'?format=j1&lang=zh\') -Headers @{ \'User-Agent\' = \'curl/8\' } -TimeoutSec 15 -UseBasicParsing\n'
        + '  if (-not $w -or -not $w.current_condition -or $w.current_condition.Count -lt 1) {\n'
        + '    [pscustomobject]@{ ok = $false; error = \'wttr.in 响应格式未知\' } | ConvertTo-Json -Compress\n'
        + '    exit 0\n'
        + '  }\n'
        + '  $c = $w.current_condition[0]\n'
        + '  $a = $w.nearest_area[0]\n'
        + '  if ($env:WB_CITY) {\n'
        + '    $cityName = $env:WB_CITY\n'
        + '  } else {\n'
        + '    $g = Invoke-RestMethod -Uri (\'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=\' + $a.latitude + \'&longitude=\' + $a.longitude + \'&localityLanguage=zh-Hans\') -Headers @{ \'User-Agent\' = \'dsh-whale-pet\' } -TimeoutSec 15 -UseBasicParsing\n'
        + '    if ($g.city) { $cityName = [string]$g.city } elseif ($g.locality) { $cityName = [string]$g.locality } else { $cityName = [string]$g.principalSubdivision }\n'
        + '  }\n'
        + '  if (-not $w.weather -or $w.weather.Count -lt 2) {\n'
        + '    [pscustomobject]@{ ok = $false; error = \'没有拿到明日预报数据\' } | ConvertTo-Json -Compress\n'
        + '    exit 0\n'
        + '  }\n'
        + '  $tmr = $w.weather[1]\n'
        + '  $hi = [int]$tmr.maxtempC; $lo = [int]$tmr.mintempC\n'
        + '  $code = 0\n'
        + '  foreach ($h in $tmr.hourly) {\n'
        + '    if ($h.time -eq \'1200\' -or $h.time -eq \'1500\') { $code = [int]$h.weatherCode; break }\n'
        + '  }\n'
        + '  if ($code -eq 0) {\n'
        + '    $dayH = $tmr.hourly | Where-Object { $_.time -in \'600\',\'900\',\'1200\',\'1500\',\'1800\' } | Select-Object -First 1\n'
        + '    if ($dayH) { $code = [int]$dayH.weatherCode }\n'
        + '  }\n'
        + '  $desc = (WmoDesc $code)\n'
        + '  [pscustomobject]@{ ok = $true; city = $cityName; icon = (WmoIcon ([int]$c.weatherCode)); temp = ([string]$c.temp_C + \'°C\'); tomorrowIcon = (WmoIcon $code); tomorrowLow = $lo; tomorrowHigh = $hi; tomorrowDesc = $desc } | ConvertTo-Json -Compress\n'
        + '} catch {\n'
        + '  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress\n'
        + '}\n';
      try {
        const policy = resolvePolicy(ctx);
        const reqSpec = { command, timeoutMs: 25000, stdoutMaxBytes: 65536, env: { WB_CITY: city } };
        if (policy !== undefined) reqSpec.sandboxPolicy = policy;
        const result = await shell.run(shell.resolve(reqSpec));
        const text = result && result.stdout ? String(result.stdout.text || '') : '';
        if (result && result.exitCode !== 0) {
          const errText = result.stderr ? String(result.stderr.text || '') : '';
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: redact('执行失败（退出码 ' + String(result.exitCode) + '）' + (errText ? '：' + errText.slice(0, 200) : '')) }));
          return;
        }
        let data;
        try { data = JSON.parse(text); } catch { data = { ok: false, error: '天气响应解析失败' }; }
        res.writeHead(data && data.ok ? 200 : 502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      } catch (error) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: redact(String(error && error.message ? error.message : error)) }));
      }
    },
  }), 'dsh-whale-pet: /api/whale-pet/weather route');

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
          await ctx.settings.mutate(NS, ops);
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
// 本 fork 新增：DeepSeek 账户余额查询（GET /api/whale-balance）
// 复用本机 DEEPSEEK_API_KEY 凭据，经 PowerShell 调用官方余额接口。
// ============================================================================

/** 错误信息脱敏：绝不把 sk- 开头的密钥带出去。 */
function redact(value) {
  return String(value).replace(/sk-[A-Za-z0-9]{6,}/gi, 'sk-***');
}

/**
 * 解析本会话沙箱策略（网络需要 danger-full-access 级别的进程）。
 *
 * 修复说明：天气（wttr.in）与余额（api.deepseek.com）查询都是只读网络
 * GET，无文件副作用，必须拿到不受限的网络访问。原实现按
 * `agents.roots()[0].session`（注册顺序的第一个根会话）解析模式，而该
 * 会话往往没有权限覆盖，落到部署默认 read-only —— Windows ACL 受限
 * token + ConstrainedLanguage 下 PowerShell 无法设置 TLS 1.2，
 * Invoke-RestMethod 以旧协议握手失败，表现为"基础连接已经关闭: 接收时
 * 发生错误"。这里直接强制 danger-full-access，与注释原意一致。
 */
function resolvePolicy(ctx) {
  const sp = ctx.get('sandboxPolicy');
  if (sp === undefined) return undefined;
  return sp.resolve({ mode: 'danger-full-access' });
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

  const shell = ctx.get('shell');
  if (shell === undefined) return { ok: false, error: 'shell 服务不可用，无法发起查询' };

  const safe = String(apiKey).replace(/[^A-Za-z0-9._\-]/g, '');
  if (!safe) return { ok: false, error: 'API Key 格式异常' };

  const command = '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n'
    + '$ErrorActionPreference = \'Stop\'\n'
    + 'try {\n'
    + '  $r = Invoke-RestMethod -Uri \'https://api.deepseek.com/user/balance\' -Headers @{ Authorization = (\'Bearer \' + $env:DSH_BAL_KEY); Accept = \'application/json\' } -TimeoutSec 15 -UseBasicParsing\n'
    + '  if ($r -and $r.balance_infos -and $r.balance_infos.Count -gt 0) {\n'
    + '    $b = $r.balance_infos[0]\n'
    + '    [pscustomobject]@{ ok = $true; currency = [string]$b.currency; total = [string]$b.total_balance; granted = [string]$b.granted_balance; topped = [string]$b.topped_up_balance } | ConvertTo-Json -Compress\n'
    + '  } else {\n'
    + '    [pscustomobject]@{ ok = $false; error = \'账户余额不可用或响应格式未知\' } | ConvertTo-Json -Compress\n'
    + '  }\n'
    + '} catch {\n'
    + '  $msg = $_.Exception.Message\n'
    + '  if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg = $msg + \' | \' + $_.ErrorDetails.Message }\n'
    + '  [pscustomobject]@{ ok = $false; error = ($msg + \' (PS \' + $PSVersionTable.PSEdition + \' \' + $PSVersionTable.PSVersion + \')\') } | ConvertTo-Json -Compress\n'
    + '}\n';

  let result;
  try {
    const req = { command, timeoutMs: 25000, stdoutMaxBytes: 65536, env: { DSH_BAL_KEY: safe } };
    const policy = resolvePolicy(ctx);
    if (policy !== undefined) req.sandboxPolicy = policy;
    result = await shell.run(shell.resolve(req));
  } catch (error) {
    return { ok: false, error: redact('查询请求失败：' + String(error && error.message ? error.message : error)) };
  }

  const text = result && result.stdout ? String(result.stdout.text || '') : '';
  if (result && result.exitCode !== 0) {
    const errText = result.stderr ? String(result.stderr.text || '') : '';
    return { ok: false, error: redact('执行失败（退出码 ' + String(result.exitCode) + '）' + (errText ? '：' + errText.slice(0, 300) : '')) };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: redact('余额响应解析失败：' + (text ? text.slice(0, 200) : '空响应')) };
  }
  if (data && data.ok === true) {
    return {
      ok: true,
      currency: String(data.currency || 'CNY'),
      total: String(data.total || '0'),
      granted: String(data.granted || '0'),
      topped: String(data.topped || '0'),
    };
  }
  return { ok: false, error: redact(data && data.error ? String(data.error) : '账户余额不可用或响应格式未知') };
}

// ============================================================================
// 本 fork 新增：今日 Token 消耗与今日花费统计（本地会话事件回放，无需联网）
// ----------------------------------------------------------------------------
// 数据来源：所有在线会话（含子代理会话）的 assistant/chunk(usage) 与
// assistant/message.usage 事件。去重口径与官方 token-meter 完全一致：
// 同一步（turn,step）内后到的样本替换先到的样本，不会重复计数。
// 价格：DeepSeek 官方价目（元/百万 tokens），2026-08-17 起实行峰谷定价
// （北京时间 9:00-12:00、14:00-18:00 为高峰，价格为闲时两倍）。
// 每条用量按其事件时间戳定价，所以跨峰谷的一天也能算出准确费用。
// ============================================================================

/** 峰谷定价生效时刻：2026-08-17 00:00 北京时间 = 2026-08-16 16:00 UTC。 */
const NEW_PRICING_AT = Date.UTC(2026, 7, 16, 16, 0, 0);

/** 平峰价格（生效日前）：hit=缓存命中输入，miss=缓存未命中输入/缓存写入，out=输出。 */
const FLAT_PRICES = {
  pro: { hit: 0.025, miss: 3, out: 6 },
  flash: { hit: 0.02, miss: 1, out: 2 },
};

/** 峰谷价格：peak=高峰时段，off=空闲时段。 */
const TIERED_PRICES = {
  pro: { peak: { hit: 0.3, miss: 9, out: 27 }, off: { hit: 0.15, miss: 4.5, out: 13.5 } },
  flash: { peak: { hit: 0.1, miss: 3, out: 9 }, off: { hit: 0.05, miss: 1.5, out: 4.5 } },
};

/** 北京时间是否处于高峰时段（9:00-12:00、14:00-18:00）。 */
function isPeakBeijing(timeMs) {
  const bj = new Date(timeMs + 8 * 3600e3);
  const t = bj.getUTCHours() + bj.getUTCMinutes() / 60;
  return (t >= 9 && t < 12) || (t >= 14 && t < 18);
}

/** 模型名 → 价目档位：含 flash 走 flash 价，其余（v4-pro / 默认）走 pro 价。 */
function tierOfModel(model) {
  return String(model || '').toLowerCase().includes('flash') ? 'flash' : 'pro';
}

/** 某时刻某模型适用的单价（元/百万 tokens）与计费区间（flat/peak/off）。 */
function rateAt(model, timeMs) {
  const tier = tierOfModel(model);
  if (timeMs < NEW_PRICING_AT) {
    return { tier, regime: 'flat', hit: FLAT_PRICES[tier].hit, miss: FLAT_PRICES[tier].miss, out: FLAT_PRICES[tier].out };
  }
  const peak = isPeakBeijing(timeMs);
  const rate = TIERED_PRICES[tier][peak ? 'peak' : 'off'];
  return { tier, regime: peak ? 'peak' : 'off', hit: rate.hit, miss: rate.miss, out: rate.out };
}

/** 汇总单个会话从 todayStartMs 起的 token 与花费（同 turn/step 后到替换先到）。 */
function foldTodayUsage(events, todayStartMs) {
  const last = new Map();
  const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const regimes = { flat: 0, peak: 0, off: 0 };
  const models = new Set();
  let currentModel = '';
  for (const ev of events) {
    if (!ev || typeof ev.type !== 'string') continue;
    // 路由元数据：记录当前生效的模型名，供后续用量事件定价
    if (ev.type === 'request/context') {
      if (ev.data) {
        currentModel = String(ev.data.model || '');
        if (currentModel) models.add(currentModel);
      }
      continue;
    }
    let usage;
    let turn;
    let step;
    if (ev.type === 'assistant/chunk' && ev.data && ev.data.chunk && ev.data.chunk.type === 'usage') {
      ({ turn, step } = ev.data);
      usage = ev.data.chunk.usage;
    } else if (ev.type === 'assistant/message' && ev.data && ev.data.usage) {
      ({ turn, step, usage } = ev.data);
    }
    if (usage === undefined) continue;
    const time = typeof ev.time === 'number' ? ev.time : Date.now();
    const isToday = time >= todayStartMs;
    const key = String(turn) + ':' + String(step);
    const buckets = {
      input: Number(usage.inputTokens) || 0,
      cacheRead: Number(usage.cacheReadTokens) || 0,
      cacheWrite: Number(usage.cacheWriteTokens) || 0,
      output: Number(usage.outputTokens) || 0,
    };
    const rate = rateAt(currentModel, time);
    // 计费口径：缓存写入按"未命中"单价计（对应官方 prompt_cache_miss_tokens）
    const cost = ((buckets.input + buckets.cacheWrite) * rate.miss + buckets.cacheRead * rate.hit + buckets.output * rate.out) / 1e6;
    const prev = last.get(key);
    if (prev !== undefined && prev.counted) {
      totals.input -= prev.input;
      totals.cacheRead -= prev.cacheRead;
      totals.cacheWrite -= prev.cacheWrite;
      totals.output -= prev.output;
      regimes[prev.regime] -= prev.cost;
    }
    last.set(key, { ...buckets, cost, regime: rate.regime, counted: isToday });
    if (isToday) {
      totals.input += buckets.input;
      totals.cacheRead += buckets.cacheRead;
      totals.cacheWrite += buckets.cacheWrite;
      totals.output += buckets.output;
      regimes[rate.regime] += cost;
    }
  }
  return { totals, regimes, models };
}

/** 汇总所有在线会话（含子代理会话）的今日用量，返回可 JSON 化的结果。 */
function computeTodayUsage(ctx) {
  try {
    const sessions = ctx.get('sessions');
    if (sessions === undefined || typeof sessions.list !== 'function') {
      return { ok: false, error: '会话服务不可用' };
    }
    // "今天"按北京时间（UTC+8）0 点切分
    const bjOffset = 8 * 3600e3;
    const todayStartMs = Math.floor((Date.now() + bjOffset) / 864e5) * 864e5 - bjOffset;
    const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    const regimes = { flat: 0, peak: 0, off: 0 };
    const models = new Set();
    let sessionCount = 0;
    for (const session of sessions.list()) {
      const events = session && session.events;
      if (!Array.isArray(events)) continue;
      sessionCount += 1;
      const fold = foldTodayUsage(events, todayStartMs);
      totals.input += fold.totals.input;
      totals.cacheRead += fold.totals.cacheRead;
      totals.cacheWrite += fold.totals.cacheWrite;
      totals.output += fold.totals.output;
      regimes.flat += fold.regimes.flat;
      regimes.peak += fold.regimes.peak;
      regimes.off += fold.regimes.off;
      for (const model of fold.models) models.add(model);
    }
    const modelList = [...models];
    const tier = modelList.length > 0 && modelList.every((m) => tierOfModel(m) === 'flash') ? 'flash' : 'pro';
    const round = (n) => Math.round(n * 1e4) / 1e4;
    return {
      ok: true,
      date: new Date(todayStartMs + bjOffset).toISOString().slice(0, 10),
      tokens: { ...totals, total: totals.input + totals.cacheRead + totals.cacheWrite + totals.output },
      costCny: round(regimes.flat + regimes.peak + regimes.off),
      costFlatCny: round(regimes.flat),
      costPeakCny: round(regimes.peak),
      costOffCny: round(regimes.off),
      tier,
      sessions: sessionCount,
      models: modelList.slice(0, 8),
    };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

/** token 数人性化显示：1234567 → 1.23M，12345 → 12.3k。 */
function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

/** 汇总一次任务（自 sinceMs 以来所有在线会话，含子代理）的用量与花费。 */
function computeTaskUsage(ctx, sinceMs) {
  try {
    const sessions = ctx.get('sessions');
    if (sessions === undefined || typeof sessions.list !== 'function') {
      return { ok: false, error: '会话服务不可用' };
    }
    const totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    let cost = 0;
    for (const session of sessions.list()) {
      const events = session && session.events;
      if (!Array.isArray(events)) continue;
      // 复用 foldTodayUsage：它按传入时间戳过滤 + 同 turn/step 去重 + 按事件时间定价
      const fold = foldTodayUsage(events, sinceMs);
      totals.input += fold.totals.input;
      totals.cacheRead += fold.totals.cacheRead;
      totals.cacheWrite += fold.totals.cacheWrite;
      totals.output += fold.totals.output;
      cost += fold.regimes.flat + fold.regimes.peak + fold.regimes.off;
    }
    const total = totals.input + totals.cacheRead + totals.cacheWrite + totals.output;
    if (total <= 0) return { ok: false, total: 0 };
    return {
      ok: true,
      tokens: { ...totals },
      total,
      costCny: Math.round(cost * 1e4) / 1e4,
    };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

// 导出插件三件套（Cordis Loader 需要）
export { apply, inject, name };
