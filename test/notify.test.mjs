/**
 * dsh-whale-girl-pet 完成提示三件套测试：
 *   1) 标签页角标（favicon 红点 + 标题 `(N) ` 计数）
 *   2) 回来汇总气泡（后台累计 → 回前台一次交代）
 *   3) 提示音（WebAudio 合成，无音频素材）
 *
 * 【这一组测试守的是什么】
 *   · 只在"抢到 done 事件的那个标签页处于后台"时提示——前台时宠物气泡已在眼前；
 *   · 多标签页不会重复提示，依据是宿主队列读走即清空（queue.splice）；
 *   · 三个开关都必须在设置面板里可见，且都必须真的接上配置（否则开关写了不生效）；
 *   · 提示音不引入音频素材，且音量必须被夹到 0..1（schema 上界是 1，越界会让保存失败）。
 *
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HOST_SOURCE = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8');
const CLIENT_SOURCE = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------
// 1. 宿主侧：配置字段 + 结构化完成事件
// ---------------------------------------------------------------------------
test('宿主配置：提示相关字段都必须是 volatile（否则不进设置表单、也写不回）', () => {
  for (const line of [
    'notifyBadge: Schema.boolean().default(true).volatile(),',
    'notifySummary: Schema.boolean().default(true).volatile(),',
    'notifySound: Schema.boolean().default(true).volatile(),',
    'notifySoundVolume: Schema.number().min(0).max(100).default(25).volatile(),',
    "notifySoundMode: Schema.string().default('each').volatile(),",
  ]) {
    assert.ok(HOST_SOURCE.includes(line), 'Config 里缺少：' + line);
  }
});

test('宿主事件：done 必须带上结构化数值，客户端才能不解析中文文本求和', () => {
  // push() 是白名单拷贝，新字段不登记就会被丢掉
  assert.ok(HOST_SOURCE.includes('if (item.durSec !== undefined) entry.durSec = item.durSec;'), 'push 必须透传 durSec');
  assert.ok(HOST_SOURCE.includes('if (item.tokens !== undefined) entry.tokens = item.tokens;'), 'push 必须透传 tokens');
  assert.ok(HOST_SOURCE.includes('if (item.costCny !== undefined) entry.costCny = item.costCny;'), 'push 必须透传 costCny');
  // 回合结束那条 done 要真的带上它们
  assert.ok(HOST_SOURCE.includes('summary.durSec = durSec;'), '完成后必须回填 durSec');
  assert.ok(HOST_SOURCE.includes('summary.tokens = usage.total;'), '完成后必须回填 tokens');
  assert.ok(HOST_SOURCE.includes('summary.costCny = usage.costCny;'), '完成后必须回填 costCny');
});

test('多标签页不重复提示的依据：状态路由必须"读走即清空"', () => {
  // 三个提示都由"抢到这条 done 的那个标签页"负责，抢不到的自然什么都不做。
  // 哪天这里改成不清空（广播式），重复提示就会回来——所以钉住它。
  assert.ok(
    HOST_SOURCE.includes('const items = queue.splice(0, queue.length);'),
    '宿主队列必须读走即清空，否则多个标签页会各自收到同一条 done',
  );
});

// ---------------------------------------------------------------------------
// 2. 客户端：触发条件与三个开关的接线
// ---------------------------------------------------------------------------
test('只在后台提示：前台时直接返回，且三个动作各自受开关控制', () => {
  assert.ok(
    CLIENT_SOURCE.includes("if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;"),
    'onTaskDone 必须只在这个标签页处于后台时才继续',
  );
  assert.ok(CLIENT_SOURCE.includes("if (settingOn(s, 'notifyBadge')) tabBadge.bump();"), '角标必须接 notifyBadge');
  assert.ok(CLIENT_SOURCE.includes("if (settingOn(s, 'notifySummary')) doneSummary.add(item);"), '汇总必须接 notifySummary');
  assert.ok(CLIENT_SOURCE.includes("if (settingOn(s, 'notifySound')) {"), '提示音必须接 notifySound');
  // 音量口径：设置里是 0..100，播放前才换算成 0..1
  assert.ok(
    CLIENT_SOURCE.includes('const pct = Math.max(0, Math.min(100, Number.isFinite(s.notifySoundVolume) ? s.notifySoundVolume : 25));'),
    '音量必须按 0..100 读取并夹紧（缺省 25）',
  );
  assert.ok(CLIENT_SOURCE.includes('playChime(item.ok !== false, pct / 100);'), '播放前必须换算成 0..1');
  // 接线点必须在 done 分支里，并把权威 running 一起带进去（'all' 模式靠它）
  assert.ok(
    CLIENT_SOURCE.includes("else if (item.type === 'done') { playNotice(item.ok, item); onTaskDone(item, data.running === true); }"),
    'done 事件必须同时驱动动画/气泡与提示三件套，并带上 running',
  );
});

test('响铃时机：每个都响 / 全部完成后才响（可切换）', () => {
  assert.ok(
    CLIENT_SOURCE.includes("if ((s.notifySoundMode === 'all' ? 'all' : 'each') === 'all' && runningNow) return;"),
    'all 模式必须在"还有任务在跑"时不响',
  );
  assert.ok(CLIENT_SOURCE.includes("['each', '每个任务完成'], ['all', '全部完成后']"), '设置面板必须给出两种时机');
  assert.ok(CLIENT_SOURCE.includes("path: ['notifySoundMode']"), '切换必须写回 notifySoundMode');
  // 判定依据必须是宿主同一次响应里现算的 running，而不是本地猜测
  assert.ok(CLIENT_SOURCE.includes('data.running === true'), 'all 模式必须以宿主返回的 running 为准');
  assert.ok(HOST_SOURCE.includes('running: anyAgentRunning(ctx)'), '宿主必须在 state 响应里带上 running');
});

test('回来汇总：无论开关如何都要 take() 一次，避免后台累计永远攒着', () => {
  assert.ok(CLIENT_SOURCE.includes('const sum = doneSummary.take();'), '回前台必须取走累计');
  assert.ok(CLIENT_SOURCE.includes("if (!settingOn(settingsRef.current, 'notifySummary')) return;"), '汇总气泡受开关控制');
  assert.ok(
    CLIENT_SOURCE.includes("document.addEventListener('visibilitychange', onReturn);") &&
    CLIENT_SOURCE.includes("window.addEventListener('focus', onReturn);"),
    'visibilitychange 与 window focus 都要触发"回来"处理',
  );
  // 取走之后必须清零（否则下次回来会重复汇报旧账）
  assert.ok(
    /take\(\) \{\s*const out = \{ count, durSec, tokens, costCny: Math\.round\(costCny \* 100\) \/ 100, hasUsage \};\s*count = 0;/.test(CLIENT_SOURCE),
    'take() 必须清零累计器',
  );
});

test('标签页角标：标题要和 DSH 抢写，且必须能还原', () => {
  // DSH 的 DocumentTitle 会整体重写 document.title，只改一次会被覆盖
  assert.ok(CLIENT_SOURCE.includes('new MutationObserver('), '必须用 MutationObserver 盯住 <title>');
  assert.ok(
    CLIENT_SOURCE.includes('observer.observe(title, { childList: true, characterData: true, subtree: true });'),
    '必须观察 title 的文本变化（document.title 写入就是替换文本节点）',
  );
  assert.ok(
    CLIENT_SOURCE.includes("const stripPrefix = (text) => String(text || '').replace(/^\\(\\d+\\)\\s*/, '');"),
    '必须能识别并剥掉自己加的 (N) 前缀',
  );
  assert.ok(CLIENT_SOURCE.includes('restoreIcon();'), '清零时必须把 favicon 还原');
  // 原 href 必须先存后还原，否则会把"已经带角标的图"再叠一次
  assert.ok(
    CLIENT_SOURCE.includes('if (originals === null) originals = links.map((link) => link.getAttribute(\'href\'));'),
    '必须记住原始 favicon href',
  );
  assert.ok(
    CLIENT_SOURCE.includes('if (originals[i] !== undefined && originals[i] !== null) link.setAttribute(\'href\', originals[i]);'),
    '还原时必须写回原始 href',
  );
});

test('提示音：合成音 + 自定义音频共用 AudioContext，不引入打包素材', () => {
  assert.ok(CLIENT_SOURCE.includes('window.AudioContext || window.webkitAudioContext'), '必须用 WebAudio');
  assert.ok(CLIENT_SOURCE.includes('audio.createOscillator()'), '内置音必须是现场合成的振荡器');
  // 不能悄悄依赖音频文件：本包 assets/ 里只有 webm/gif/png
  assert.ok(!/new Audio\(/.test(CLIENT_SOURCE), '不得改用 <audio> 元素');
  assert.ok(!/\.(mp3|wav|ogg)['"]/.test(CLIENT_SOURCE), '不得引用 mp3/wav/ogg 素材');
  // 夹紧：schema 上界是 100，播放侧一律 0..1
  assert.ok(
    CLIENT_SOURCE.includes('const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.25));'),
    '音量必须夹到 0..1',
  );
  assert.ok(CLIENT_SOURCE.includes('if (v <= 0) return false;'), '音量为 0 时不发声');
  // 自动播放策略：第一次用户手势里解锁
  assert.ok(CLIENT_SOURCE.includes("window.addEventListener('pointerdown', unlockAudio, true);"), '必须在用户手势里解锁音频');
});

test('自定义提示音：上传 → 解码 → 播放，失败回退合成音', () => {
  assert.ok(CLIENT_SOURCE.includes("const KEY = 'whalePet.customSound';"), '自定义音频必须持久化（localStorage）');
  assert.ok(CLIENT_SOURCE.includes('reader.readAsDataURL(file)'), '必须用 FileReader 读取用户文件');
  assert.ok(CLIENT_SOURCE.includes('audio.decodeAudioData('), '必须解码成 AudioBuffer 才能复用音量增益');
  assert.ok(CLIENT_SOURCE.includes('audio.createBufferSource()'), '自定义音频必须用 BufferSource 播放');
  assert.ok(CLIENT_SOURCE.includes('const MAX_BYTES = 1024 * 1024;'), '必须有体积上限（localStorage 会膨胀 1/3）');
  assert.ok(CLIENT_SOURCE.includes("info = previous;"), '解不出来时必须回滚，不能留下一个"设了却没声音"的配置');
  // 回退链：自定义播不了就回到合成音
  assert.ok(
    /function playChime\(ok, volume\) \{\s*if \(customSound\.play\(volume\)\) return;\s*chime\.play\(ok, volume\);/.test(CLIENT_SOURCE),
    'playChime 必须优先自定义音频、失败回退合成音',
  );
  // 设置面板入口：文件选择 + 试听 + 清除
  assert.ok(CLIENT_SOURCE.includes("accept: 'audio/*'"), '设置面板必须给出音频文件入口');
  assert.ok(CLIENT_SOURCE.includes("}, '试听'),"), '必须有试听按钮');
  assert.ok(CLIENT_SOURCE.includes('}, \'清除\') : null),'), '必须有清除按钮（回到内置合成音）');
  assert.ok(CLIENT_SOURCE.includes('const [soundState, setSoundState] = useState(() => customSound.state());'), '上传/清除后必须重渲染');
});

test('合成提示音是四个音的短句：成功逐音升高、失败逐音降低', () => {
  const okBlock = CLIENT_SOURCE.match(/const NOTES_OK = \[([\s\S]*?)\];/);
  const failBlock = CLIENT_SOURCE.match(/const NOTES_FAIL = \[([\s\S]*?)\];/);
  assert.ok(okBlock && failBlock, '必须能定位两张音符表');
  const freqs = (block) => [...block[1].matchAll(/\[\s*([\d.]+)\s*,/g)].map((m) => Number(m[1]));
  const ok = freqs(okBlock);
  const fail = freqs(failBlock);
  assert.equal(ok.length, 4, '成功提示音必须是 4 个音');
  assert.equal(fail.length, 4, '失败提示音必须是 4 个音');
  for (let i = 1; i < ok.length; i += 1) assert.ok(ok[i] > ok[i - 1], '成功音必须一个比一个高');
  for (let i = 1; i < fail.length; i += 1) assert.ok(fail[i] < fail[i - 1], '失败音必须一个比一个低');
  // 播放必须遍历音符表，而不是又写死两声
  assert.ok(
    CLIENT_SOURCE.includes('for (const [freq, delay, dur, peak] of (ok ? NOTES_OK : NOTES_FAIL))'),
    '播放必须遍历四音表',
  );
});

// ---------------------------------------------------------------------------
// 3. 设置面板：分组 + 不漏开关
// ---------------------------------------------------------------------------
test('设置面板：四个分页 + 新开关可见 + 每个配置项都能在面板里找到', () => {
  for (const entry of ["['notify', '完成提醒']", "['timing', '定时与关怀']", "['pet', '宠物与外观']", "['cost', '费用与看板']"]) {
    assert.ok(CLIENT_SOURCE.includes(entry), '设置面板缺少分页：' + entry);
  }
  assert.ok(CLIENT_SOURCE.includes("const [tab, setTab] = useState('notify');"), '默认必须落在完成提醒页');
  for (const key of ['notifySound', 'notifySoundVolume', 'notifySoundMode', 'notifyBadge', 'notifySummary']) {
    assert.ok(CLIENT_SOURCE.includes("'" + key + "'"), '设置面板里找不到开关：' + key);
  }
  // 强不变式：Config 里每个可写字段都必须在面板出现（size/position 由 DSH 原生表单负责，豁免）
  const exempt = new Set(['size', 'position']);
  const fields = [...HOST_SOURCE.matchAll(/^\s{2}(\w+): Schema\./gm)].map((m) => m[1]);
  assert.ok(fields.length >= 15, 'Config 字段解析异常，只找到 ' + fields.length + ' 个');
  for (const field of fields) {
    if (exempt.has(field)) continue;
    assert.ok(CLIENT_SOURCE.includes("'" + field + "'"), '配置项没出现在设置面板里：' + field);
  }
});

// ---------------------------------------------------------------------------
// 4. 纯函数行为：真实执行 fmtDuration（抠源码 → 临时 ESM 模块 → import）
// ---------------------------------------------------------------------------
test('fmtDuration：秒数格式化成「x分y秒」，不足一分钟只给秒', async () => {
  const start = CLIENT_SOURCE.indexOf('function fmtDuration(sec) {');
  assert.notEqual(start, -1, 'client.js 里必须存在 fmtDuration');
  const open = CLIENT_SOURCE.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < CLIENT_SOURCE.length; i += 1) {
    if (CLIENT_SOURCE[i] === '{') depth += 1;
    else if (CLIENT_SOURCE[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, 'fmtDuration 花括号不配平');
  const dir = mkdtempSync(join(tmpdir(), 'wg-duration-'));
  const file = join(dir, 'duration.mjs');
  writeFileSync(file, `export ${CLIENT_SOURCE.slice(start, end)}\n`, 'utf8');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.fmtDuration(0), '0秒');
  assert.equal(mod.fmtDuration(45), '45秒');
  assert.equal(mod.fmtDuration(59.4), '59秒');
  assert.equal(mod.fmtDuration(60), '1分0秒');
  assert.equal(mod.fmtDuration(90), '1分30秒');
  assert.equal(mod.fmtDuration(3600), '60分0秒');
  assert.equal(mod.fmtDuration(-5), '0秒');
});
