/**
 * dsh-whale-girl-pet 浏览器半侧 bundle 冒烟测试：
 * 在 VM 里按 __ModuleLoader__ 协议加载 lib/client.js，执行 factory，
 * 并检查 apply 注册的槽位（桌宠、设置面板、费用 pill）与文案命名空间。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));

/** 最小 react 替身：顶层只做定义，不真正渲染。 */
const react = new Proxy({}, {
  get: (_target, prop) => {
    if (prop === 'Component') return class Component {};
    if (prop === 'createElement') return () => ({});
    if (prop === 'Fragment') return 'Fragment';
    return () => {};
  },
});
const jsxRuntime = { jsx: () => ({}), jsxs: () => ({}), Fragment: 'Fragment' };
const reactDom = { createPortal: (node) => node };

/** 按 loader 协议加载 bundle 并返回 factory 的执行结果。 */
function loadClientBundle() {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const handoffs = [];
  const sandbox = { window: { __ModuleLoader__: { load: (handoff) => { handoffs.push(handoff); } } } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.equal(handoffs.length, 1, 'bundle 必须恰好注册一个模块');
  const require = (id) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === 'react-dom') return reactDom;
    throw new Error('unexpected external: ' + id);
  };
  return { handoff: handoffs[0], exports: handoffs[0].factory(require) };
}

test('client bundle 以正确 id 注册并导出插件三件套', () => {
  const { handoff, exports } = loadClientBundle();
  assert.equal(handoff.id, 'dsh-whale-girl-pet');
  assert.equal(typeof exports.apply, 'function');
  assert.equal(typeof exports.name, 'string');
  assert.equal(JSON.stringify(exports.inject), JSON.stringify(['slots', 'locale']));
});

test('apply 注册桌宠、设置面板与费用 pill，并注册费用文案', () => {
  const { exports } = loadClientBundle();
  const injected = [];
  const registered = [];
  const locales = [];
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: (ns, dicts) => { locales.push([ns, dicts]); return () => {}; } },
    slots: {
      inject: (name, factory) => {
        injected.push(name);
        // inject 的工厂是 generator（官方叠加式注册），必须迭代才会执行注册体
        const produced = factory();
        if (produced && typeof produced[Symbol.iterator] === 'function') {
          for (const _ of produced) { /* 驱动注册 */ }
        }
        return () => {};
      },
      register: (options, component) => {
        registered.push([options, component]);
        return () => {};
      },
    },
  };
  exports.apply(ctx, {});
  assert.deepEqual(injected, [
    'shell.overlay',
    'settings.section',
    'conversation.composer.dock',
    'conversation.chat.assistant-actions',
  ]);
  assert.deepEqual(locales.map(([ns]) => ns), ['whale-pet-cost']);
  const dock = registered.find(([options]) => options.name === 'conversation.composer.dock');
  assert.ok(dock, '必须注册 conversation.composer.dock 条目');
  assert.equal(JSON.stringify(dock[0]), JSON.stringify({
    name: 'conversation.composer.dock',
    id: 'whale-pet-cost',
    order: 5,
    locale: 'whale-pet-cost',
  }));
  assert.equal(typeof dock[1], 'function');
  const turnPill = registered.find(([options]) => options.name === 'conversation.chat.assistant-actions');
  assert.ok(turnPill, '必须注册 conversation.chat.assistant-actions 条目');
  assert.equal(JSON.stringify(turnPill[0]), JSON.stringify({
    name: 'conversation.chat.assistant-actions',
    id: 'whale-pet-cost-turn',
    order: 50,
    locale: 'whale-pet-cost',
  }));
  assert.equal(typeof turnPill[1], 'function');
});

test('气泡看板：词典键齐备，客户端接入 /api/whale-pet/usage', () => {
  const { exports } = loadClientBundle();
  const locales = [];
  const ctx = {
    effect: (fn) => { fn(); return () => {}; },
    locale: { register: (ns, dicts) => { locales.push([ns, dicts]); return () => {}; } },
    slots: {
      inject: (name, factory) => {
        const produced = factory();
        if (produced && typeof produced[Symbol.iterator] === 'function') for (const _ of produced) { /* drive */ }
        return () => {};
      },
      register: () => () => {},
    },
  };
  exports.apply(ctx, {});
  const dicts = locales.find(([ns]) => ns === 'whale-pet-cost');
  assert.ok(dicts, '必须注册 whale-pet-cost 词典');
  const [ns, { zh, en }] = dicts;
  assert.equal(ns, 'whale-pet-cost');
  // 中英键必须一一对应（缺键会退回键名显示，属于缺陷）
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), '中英文案键必须一致');
  for (const key of Object.keys(zh)) {
    assert.ok(key.startsWith('dash.') || key.startsWith('pill.') || key.startsWith('dialog.') || key.startsWith('turn.'), '未知的文案键：' + key);
  }
  // 看板核心键
  for (const key of ['dash.title', 'dash.tabHourly', 'dash.tabDaily', 'dash.legendPeak', 'dash.legendOff', 'dash.note']) {
    assert.equal(typeof zh[key], 'string', '缺少中文键 ' + key);
    assert.equal(typeof en[key], 'string', '缺少英文键 ' + key);
  }
  // 源码里应当指向宿主新路由（不能拼错路径，否则看板永远读不到数据）
  const source = readFileSync(CLIENT_PATH, 'utf8');
  assert.ok(source.includes("'/api/whale-pet/usage'"), '客户端必须请求 /api/whale-pet/usage');
  assert.ok(source.includes('dsh-pet-dash-panel'), '必须含看板弹窗样式类');
  // 主图：结构化 SVG 堆叠柱（旧的 dsh-pet-dash-bar 单色柱已废弃）
  assert.ok(source.includes('dsh-pet-dash-plot'), '必须含绘图区样式类');
  assert.ok(source.includes('dsh-pet-dash-seg'), '必须含堆叠分段样式类');
  assert.ok(source.includes('dsh-pet-dash-grid'), '必须含网格线样式类');
  // 均值已从图里移到汇总格：图内不应再有均值线，汇总格要有按小时/按天的均值卡
  assert.equal(source.includes('dsh-pet-dash-avg'), false, '图内均值线应已移除');
  assert.ok(source.includes("'dash.avgHour'"), '汇总格必须有"平均每小时"卡');
  assert.ok(source.includes("'dash.avgDay'"), '汇总格必须有"平均每天"卡');
  // 三桶 + 命中率 + 均值文案键
  for (const key of ['dash.bucketHit', 'dash.bucketMiss', 'dash.bucketOut', 'dash.hitRate', 'dash.avg']) {
    assert.equal(typeof zh[key], 'string', '缺少中文键 ' + key);
    assert.equal(typeof en[key], 'string', '缺少英文键 ' + key);
  }
});

test('createPortal 的容器必须经过校验（防 minified React #200 再次发生）', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  // 容器不是真实 DOM 元素时 React 会抛 minified #200，并把整个 shell.overlay
  // 条目打挂（= 桌宠直接消失）。所以每处 createPortal 的容器都必须来自
  // portalContainer()，且绝不能出现裸的 document.body。
  const calls = source.match(/createPortal\(/g) ?? [];
  assert.ok(calls.length >= 3, '应至少有三处 createPortal（看板 / 会话费用 / 本轮费用），实际 ' + calls.length);
  assert.equal(
    (source.match(/, document\.body\)/g) ?? []).length, 0,
    '不得直接传 document.body 给 createPortal',
  );
  assert.ok(
    (source.match(/portalContainer\(\)/g) ?? []).length >= 4,
    '每处 portal 都要先取 portalContainer()（1 处定义 + 3 处使用起）',
  );
  const helper = /function portalContainer\(\)[\s\S]*?\n\t\t\}/.exec(source);
  assert.ok(helper !== null, '必须存在 portalContainer()');
  assert.ok(helper[0].includes('nodeType === 1'), 'portalContainer 必须按 nodeType 校验');
  assert.ok(helper[0].includes('documentElement'), 'portalContainer 必须有 documentElement 兜底');
  // 看板必须包在错误围栏里，异常不得冒泡到桌宠
  assert.ok(source.includes('DashboardBoundary'), '看板必须有错误围栏');
  assert.ok(source.includes('getDerivedStateFromError'), '错误围栏必须实现 getDerivedStateFromError');
});

test('会话费用条目适配 DSH 0.1.6-alpha.2 的 composer dock（横向 flex 行）', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  // 官方（ui-conversation InputBar.module.css）从 0.1.6-alpha.2 起把 dock 包成
  // 横向 flex 行：.dock{display:flex;align-items:center;justify-content:center;
  // gap:12px;padding-top:4px}，官方 stats pill 与上下文占用计都在这一行里。
  // 因此本条目必须是一个「不可挤压的行内 flex 项」，由 dock 负责间距与居中。
  const rule = /'\.dsh-cost-root\{([^}]*)\}'/.exec(source);
  assert.ok(rule !== null, '必须存在 .dsh-cost-root 规则');
  const body = rule[1];
  assert.ok(body.includes('display:inline-flex'), '.dsh-cost-root 必须是行内 flex 容器');
  assert.ok(body.includes('flex:none'), '.dsh-cost-root 必须不可挤压（否则会挤扁同排的官方条目）');
  assert.ok(body.includes('align-items:center'), '.dsh-cost-root 必须按行居中');
  assert.ok(body.includes('min-width:0'), '.dsh-cost-root 必须允许内容收缩');
  // 旧布局的覆盖式定位：在横向 flex 行里会整块上移 20px，就是"歪了"的回归点
  for (const forbidden of [
    'width:100%',
    'margin:-20px',
    'justify-content:flex-end',
    '--dsh-chat-content-width',
    '--dsh-composer-side-clearance',
  ]) {
    assert.equal(body.includes(forbidden), false, '.dsh-cost-root 不得再带旧布局的 ' + forbidden);
  }
});

test('触摸屏拖拽：#4 —— 视频上必须禁用浏览器手势（touch-action:none）', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  // 桌宠的拖拽链路是 Pointer Events：pointerdown 只记起点 + setPointerCapture，
  // pointermove 超过 5px 才算拖拽，pointerup 收尾（pointercancel 也走收尾）。
  // 触屏上如果 .dsh-pet-video 没有 touch-action:none，浏览器会把这一按当成
  // 平移/缩放手势并先发 pointercancel —— 拖拽在起步前就被结束，
  // 现象就是「触摸屏上宠物拖不动」（issue #4）。
  const rule = /'\.dsh-pet-video\{([^}]*)\}'/.exec(source);
  assert.ok(rule !== null, '必须存在 .dsh-pet-video 规则');
  const body = rule[1];
  assert.ok(
    body.includes('touch-action:none'),
    '.dsh-pet-video 必须写 touch-action:none，否则触屏拖拽会被 pointercancel 打断',
  );
  // 拖拽必须始终走 Pointer Events（鼠标 / 触控 / 触控笔共用同一条路径）。
  // 【issue #3 之后】video 的事件改成原生 addEventListener + handlersRef 转发，
  // 所以这里认的是四个事件类型名，而不是 React 的 props 名（props 已不适用于
  // shadow 内的元素：合成事件跨不过 retarget）。
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.ok(source.includes(type), '拖拽必须走 Pointer Events，缺少事件 ' + type);
  }
  assert.ok(source.includes('setPointerCapture'), '按下时必须 setPointerCapture（拖出元素仍要收到 move）');
  // 看板标题/缩放手柄已有同样写法：这条不变式不能只在视频上成立
  for (const cls of ['dsh-pet-dash-head', 'dsh-pet-dash-resize']) {
    const other = new RegExp('\\.' + cls + '\\{[^}]*touch-action:none').test(source);
    assert.ok(other, '.' + cls + ' 也应保持 touch-action:none（同一套手势约定）');
  }
});

test('MPRIS 隐身：#3 —— 动画 video 必须建在 stage 的 closed shadow 里', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  // 注释里会解释为什么不能用 :host-context()，所以否定断言只看去掉注释后的代码
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // 一、两个 video 必须是手工创建 + 挂进 shadow，而不是由 React 渲染进 light DOM。
  //     KDE 的 plasma-browser-integration 用 MutationObserver 扫 document，把
  //     "正在播放且时长≥8s" 的 <video> 注册成 MPRIS 播放器（抢走全局媒体键）。
  assert.ok(code.includes('attachShadow'), '必须把 video 挂进 shadow root（否则会被 MPRIS 扫到）');
  assert.ok(code.includes("mode: 'closed'"), "shadow 必须是 closed：element.shadowRoot 也要拿到 null");
  assert.equal(code.includes("h('video'"), false, 'video 不得再由 React 渲染进 light DOM');
  assert.ok(code.includes("document.createElement('video')"), 'video 必须手工创建');
  assert.ok(code.includes('replaceChildren'), '重复挂载必须用 replaceChildren 覆盖内部节点，避免 video 堆积');
  assert.ok(code.includes('WeakMap'), 'shadow root 不可移除且 StrictMode 会跑两遍 effect：必须按舞台元素复用');

  // 二、镜像必须"按动画、按单个缓冲"生效：只有白名单动画（螃蟹走路）朝右走时才翻转。
  //     旧写法（祖先设自定义属性、shadow 内的 video 读变量）会把**所有**动画一起镜像 ——
  //     举牌这类画面带字的动画会被翻成反字，翻面瞬间正在淡出的旧帧也会被连带翻转。
  //     所以这里既锁定新的落地点，也禁止回退到"祖先变量统一镜像"。
  assert.equal(code.includes(':host-context'), false, ':host-context() 在 Firefox/Safari 从未实现，不得使用');
  assert.equal(code.includes('--dsh-pet-flip'), false, '不得再用祖先自定义属性统一镜像（会把所有动画一起翻掉）');
  assert.ok(code.includes("'.dsh-pet-video.is-flipped{transform:scaleX(-1)}'"), '镜像必须是 .dsh-pet-video.is-flipped 上的 scaleX(-1)');
  assert.ok(code.includes("const MIRRORED_WHEN_RIGHT = ['螃蟹走路']"), '镜像白名单必须只含螃蟹走路');
  assert.ok(
    /shouldMirror = \(name, dir\) => dir === 'right' && MIRRORED_WHEN_RIGHT\.includes\(name\)/.test(code),
    'shouldMirror 必须同时要求"朝右"且"在白名单里"（两个条件缺一不可）',
  );
  assert.ok(code.includes("el.classList.toggle('is-flipped', shouldMirror(next, facingRef.current))"), 'switchTo 必须按即将播放的动画设置 is-flipped');
  assert.ok(code.includes('el.dataset.anim = next'), '必须记下每个缓冲当前播的动画，朝向变化时据此重算镜像');
  const toggleSites = code.match(/classList\.toggle\('is-flipped', shouldMirror\(/g) || [];
  assert.equal(toggleSites.length, 2, 'is-flipped 只应有两处落地点（切动画 + 朝向变化），且都必须经过 shouldMirror');

  // 三、交互：React 合成事件靠 light DOM 祖先链匹配 props，而 shadow 里冒出来的
  //     pointer/click 会被 retarget 成 host —— 必须原生监听 + 转发到最新闭包
  assert.ok(code.includes('addEventListener'), 'video 交互必须用原生监听');
  assert.ok(code.includes('handlersRef.current[key]'), '原生监听必须转发到 handlersRef（否则绑在过期闭包上）');
  assert.ok(code.includes('handlersRef.current = {'), 'handlersRef 必须每次 render 刷新');

  // 四、effect 顺序：shadow 的 effect 必须先于 switchTo 的 effect 声明，
  //     否则首次挂载时 switchTo 拿到 null，宠物第一帧是空的
  const shadowAt = code.indexOf('STAGE_SHADOWS.get(stage)');
  const switchAt = code.indexOf('switchTo(anim, once);');
  assert.ok(shadowAt > 0, '必须存在建立 shadow 的 effect');
  assert.ok(switchAt > shadowAt, 'shadow 的 effect 必须声明在 switchTo 的 effect 之前（effect 按声明顺序执行）');

  // 五、单一来源：同一份 CSS 文本要给 light DOM 与 shadow 各注入一次
  assert.ok(source.includes("style.textContent = css"), 'shadow 里必须注入同一份 css 文本');
});

test('费用显示开关：五个显示位置各自受开关控制（与 dsh-cost-meter 重合时可关）', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');

  // 一、两个费用 pill 各自检查自己的开关
  assert.ok(source.includes("settingOn(settings, 'costPillSession')"), '会话费用 pill 必须检查 costPillSession');
  assert.ok(source.includes("settingOn(settings, 'costPillTurn')"), '本轮费用 pill 必须检查 costPillTurn');
  // 二、💰 余额按钮与 📊 看板（含弹层）用桌宠自己的实时设置
  assert.ok(source.includes("settingOn(settingsRef.current, 'costBalanceButton')"), '💰 按钮必须检查 costBalanceButton');
  assert.ok(source.includes("settingOn(settingsRef.current, 'costDashboard')"), '📊 看板必须检查 costDashboard');
  assert.ok(source.includes("dashOpen && settingOn(settingsRef.current, 'costDashboard')"), '看板弹层也要跟着开关关闭');

  // 三、共享设置快照：pill 是**另外注册**的槽位组件，拿不到桌宠的 settingsRef
  assert.ok(source.includes('function publishPetSettings('), '必须有模块级设置快照的发布函数');
  assert.ok(source.includes('function usePetSettings()'), 'pill 必须通过 usePetSettings 订阅');
  assert.ok(source.includes('publishPetSettings(data.settings)'), '桌宠轮询拿到 settings 后必须发布出去');
  assert.ok(source.includes("fetch('/api/whale-pet/settings')"), 'apply() 必须拉一次服务端设置做初值校准');

  // 四、开关必须在设置面板里可见（否则用户没法关）
  for (const label of [
    '会话费用 pill（输入框下方）',
    '本轮费用 pill（每条回复动作行）',
    '任务完成气泡里的花费',
    '💰 余额按钮（余额 + 今日花费）',
    '📊 分时段花费看板',
  ]) {
    assert.ok(source.includes(label), '设置面板缺少开关：' + label);
  }

  // 五、React hook 顺序不变式：开关的提前 return 必须在所有 hook 调用之后
  const pillStart = source.indexOf('function CostPill(props)');
  const pillEnd = source.indexOf('function TurnCostPill(props)');
  assert.ok(pillStart > 0 && pillEnd > pillStart, '必须能定位 CostPill / TurnCostPill');
  const pillBody = source.slice(pillStart, pillEnd);
  const lastHook = Math.max(pillBody.lastIndexOf('useCostDismiss('), pillBody.lastIndexOf('usePetSettings()'));
  const guard = pillBody.indexOf("if (!settingOn(settings, 'costPillSession')) return null;");
  assert.ok(lastHook > 0 && guard > lastHook, '开关的提前 return 必须排在所有 hook 之后（hook 数量不能随开关变化）');
});

test('镜像白名单：只有「螃蟹走路」朝右走时镜像，别的动画一律不镜像', async () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // 把白名单数组与 shouldMirror 判定式从源码里原样取出来求值 —— 测"行为"而不是"字符串"，
  // 这样"哪些动画会被镜像"是被真的跑出来的，而不是靠关键字猜的。
  const listMatch = code.match(/const MIRRORED_WHEN_RIGHT = (\[[^\]]*\]);/);
  assert.ok(listMatch, '必须能定位 MIRRORED_WHEN_RIGHT 白名单');
  const fnMatch = code.match(/const shouldMirror = (\(name, dir\) => [^;]+);/);
  assert.ok(fnMatch, '必须能定位 shouldMirror 判定式');

  // 抠出来的源码写成临时 ESM 模块再 import()：同样是"真的跑一遍"，
  // 但不使用 eval / new Function（扫描器的 DANGEROUS_DYNAMIC_EXECUTION 规则会判 high）。
  const dir = mkdtempSync(join(tmpdir(), 'wg-mirror-'));
  const file = join(dir, 'mirror.mjs');
  writeFileSync(file, [
    `export const MIRRORED_WHEN_RIGHT = ${listMatch[1]};`,
    `export const shouldMirror = ${fnMatch[1]};`,
    '',
  ].join('\n'), 'utf8');
  const mod = await import(pathToFileURL(file).href);
  const list = mod.MIRRORED_WHEN_RIGHT;
  const shouldMirror = mod.shouldMirror;

  // 一、唯一该镜像的组合：螃蟹走路 + 朝右
  assert.equal(shouldMirror('螃蟹走路', 'right'), true, '螃蟹走路朝右走必须镜像');
  // 二、其余一律不镜像
  assert.equal(shouldMirror('螃蟹走路', 'left'), false, '螃蟹走路朝左走不得镜像（左侧是原生朝向）');
  assert.equal(shouldMirror('原地漂浮踏步', 'right'), false, '原地漂浮踏步朝右走不得镜像');
  for (const name of ['待机呼吸休闲', '东张西望', '举牌不是大肥鱼', '空白举牌', '偷吃Token', '女仆屈膝礼仪', '认真工作', '被鼠标拖拽悬空反馈']) {
    assert.equal(shouldMirror(name, 'right'), false, name + ' 不在白名单里，朝右走也不得镜像');
  }
  // 三、白名单本身只该有螃蟹走路（想放行别的动画时必须同步改这条断言）
  assert.deepEqual(list, ['螃蟹走路'], '镜像白名单只应含螃蟹走路');
});

test('位置与大小：#10 —— 面板填数值 + 可视化编辑框（拖框 / 拖角 / 保存·取消）接线正确', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');

  // 一、尺寸与位置不再从客户端 config 读（那条管线是空的 → 字段永远走默认值，
  //     正是 issue #10 的"配了但不生效"），改由 usePetGeometry 订阅宿主设置。
  assert.ok(source.includes('function usePetGeometry()'), '必须有 usePetGeometry 订阅尺寸/位置/角落');
  assert.equal(source.includes('config && config.size'), false, '不得再从空的客户端 config 读尺寸');
  assert.equal(source.includes('config && config.position'), false, '不得再从空的客户端 config 读角落');
  for (const field of ["'size'", "'posX'", "'posY'", "'position'"]) {
    assert.ok(source.includes(field), '设置面板必须能改字段 ' + field);
  }

  // 二、面板入口：「拖动调整位置与大小」必须先关掉设置弹窗再开启编辑会话
  assert.ok(source.includes('function PetSettingsSection({ close })'), '设置面板必须接收 shell 给的 close');
  assert.ok(source.includes('startPetEdit()'), '面板必须调用 startPetEdit 开启编辑会话');
  assert.ok(source.includes("if (typeof close === 'function') close();"), '必须先收起设置弹窗（否则宠物被弹窗挡着没法拖）');
  assert.ok(source.includes("'拖动调整位置与大小'"), '面板必须有可视化编辑入口');
  assert.ok(source.includes("'恢复默认角落'"), '面板必须有恢复默认角落');
  assert.ok(source.includes("op: 'unset'"), '恢复默认角落必须 unset 掉 posX/posY');

  // 三、编辑框：尺寸跟 --dsh-pet-size（与舞台同值 → 框住的就是宠物本体）；
  //     四角手柄 + 触屏手势约定与 video / 看板一致
  const frame = /'\.dsh-pet-edit-frame\{([^}]*)\}'/.exec(source);
  assert.ok(frame !== null, '必须有 .dsh-pet-edit-frame 规则');
  assert.ok(frame[1].includes('var(--dsh-pet-size'), '编辑框尺寸必须跟 --dsh-pet-size 走');
  assert.ok(frame[1].includes('touch-action:none'), '编辑框必须禁用浏览器手势，否则触屏拖不动');
  for (const pos of ['nw', 'ne', 'sw', 'se']) {
    assert.ok(source.includes('dsh-pet-edit-handle-' + pos), '缺少角手柄 ' + pos);
  }
  assert.ok(source.includes('petBoxFromDrag('), '拖框移动必须走 petBoxFromDrag（夹回视口）');
  assert.ok(source.includes('petBoxFromResize('), '拖角缩放必须走 petBoxFromResize（对角固定 + 正方形）');
  assert.ok(source.includes('setPointerCapture'), '编辑框拖动必须捕获指针');

  // 四、保存 / 取消 / Esc 三个出口；保存失败不得退出编辑（草稿不能丢）
  assert.ok(source.includes('const saveEditBox = async () => {'), '必须有保存处理');
  assert.ok(source.includes('const cancelEditBox = () => {'), '必须有取消处理');
  assert.ok(source.includes("e.key === 'Escape'"), 'Esc 必须取消编辑');
  assert.ok(source.includes('if (!editing) return undefined;'), 'Esc 监听必须只在编辑期间绑定');
  assert.ok(/if \(!ok\) \{[\s\S]{0,200}return;/.test(source), '保存失败必须留在编辑模式（草稿不丢）');
  assert.ok(source.includes("{ op: 'set', path: ['posX']"), '保存必须写入 posX');
  assert.ok(source.includes("{ op: 'set', path: ['posY']"), '保存必须写入 posY');
  assert.ok(source.includes("{ op: 'set', path: ['size']"), '保存必须写入 size');

  // 四之二、工具条两个按钮必须是**文字**，而且文字必须写在 props.children 里。
  // 【为什么专门断言这个】h 是 react/jsx-runtime 的 jsx()，第三个参数是 key 而不是
  // children：写成 h('button', {...}, '保存') 时文字会被当成 key 丢掉 —— 真机表现是
  // "两个空白按钮"（先误判成字形缺失，改成文字后依旧空白，才定位到这里）。
  assert.ok(source.includes("children: editSaving ? '保存中…' : '保存',"), '保存按钮的文字必须在 props.children 里');
  assert.ok(source.includes("children: '取消',"), '取消按钮的文字必须在 props.children 里');
  assert.ok(source.includes('const EDIT_BAR_STYLE = {'), '工具条必须有内联样式常量');
  assert.ok(source.includes('EDIT_BTN_STYLE'), '按钮必须有内联样式兜底（背景/颜色不依赖注入的 CSS）');
  assert.ok(source.includes('style: Object.assign({}, EDIT_BTN_STYLE, EDIT_BTN_OK_STYLE)'), '保存按钮必须用高亮内联样式');

  // 五、编辑期间：宠物不乱跑、不抢自身拖拽/点击，按钮组收起
  //     （守卫与 hidden 共用同一行，见下面「隐藏宠物」那条测试）
  assert.ok(source.includes('if (editorRef.current || hiddenRef.current) return false;'), '编辑期间不得漫游（tryMove 直接返回 false）');
  assert.ok(source.includes('if (editorRef.current || hiddenRef.current) return;'), '编辑期间宠物体不响应自身拖拽/点击');
  assert.ok(source.includes('编辑位置/大小时收起按钮组'), '编辑时必须收起 ☁️💰🍪📊 按钮组与气泡');

  // 六、面板预填用实测外框：角落模式下也能看到"现在到底在哪"（并可一键取回）
  assert.ok(source.includes('function publishPetGeometry('), '必须有实测几何的发布函数');
  assert.ok(source.includes('publishMeasuredGeometry()'), '每次渲染后与轮询里都要发布实测外框');
  assert.ok(source.includes('petGeometry.current'), '面板必须能读到实测外框');
  assert.ok(source.includes("'取当前位置'"), '面板必须有「取当前位置」');
});

test('jsx 运行时：h() 的 children 必须写在 props 里，不得用第三个参数', () => {
  const raw = readFileSync(CLIENT_PATH, 'utf8');
  // 先把注释剥掉（注释里举了这个反例，不剥会把注释本身当成违规代码；
  // 剥法保留换行，所以报出来的行号仍是真实行号）。
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // h 是 react/jsx-runtime 的 jsx()：签名 jsx(type, props, key)。
  // 第三个参数是 **key**，不是 children —— 写成 h('button', {...}, '保存') 时
  // "保存"会被当成 key 丢掉，元素渲染出来是空的（真机上就是"两个空白按钮"）。
  // 已有的测试都用桩 react（jsx 直接返回 {}），根本看不出这种问题，所以这里扫源码：
  // 逐个 h( 调用数它顶层实参的逗号个数，≥2 即三个实参 → 报错并指出行号。
  assert.ok(raw.includes("let { jsx: h } = require('react/jsx-runtime')"), 'h 必须来自 jsx 运行时（本不变式的前提）');
  const offenders = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== 'h' || source[i + 1] !== '(') continue;
    const prev = source[i - 1];
    if (prev !== undefined && /[\w$.]/.test(prev)) continue; // push( / .h( 之类
    let depth = 0;
    let commas = 0;
    let quote = null;
    let j = i + 1;
    for (; j < source.length; j += 1) {
      const ch = source[j];
      if (quote !== null) {
        if (ch === '\\') { j += 1; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) { depth -= 1; if (depth === 0) break; }
      else if (ch === ',' && depth === 1) commas += 1;
    }
    if (commas >= 2) offenders.push(source.slice(0, i).split('\n').length);
  }
  assert.deepEqual(offenders, [], 'h() 不得带第三个实参（那是 key，children 要写进 props）：第 ' + offenders.join('、') + ' 行');
});

test('☁️💰🍪📊 按钮组跟随宠物尺寸等比缩放', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');
  const stack = /'\.wb-stack\{([^}]*)\}'/.exec(source);
  const right = /'\.wb-stack-right\{([^}]*)\}'/.exec(source);
  const btn = /'\.wb-btn\{([^}]*)\}'/.exec(source);
  assert.ok(stack !== null, '必须有 .wb-stack 规则');
  assert.ok(right !== null, '必须有 .wb-stack-right 规则');
  assert.ok(btn !== null, '必须有 .wb-btn 规则');

  // 一、单位由 --dsh-pet-size 推出，按钮宽高都用它（写死 px 就不会跟着大小走）
  assert.ok(stack[1].includes('--wb-unit:clamp('), '.wb-stack 必须定义 --wb-unit');
  assert.ok(stack[1].includes('var(--dsh-pet-size'), '--wb-unit 必须由 --dsh-pet-size 推出');
  assert.ok(btn[1].includes('width:var(--wb-unit)'), '按钮宽度必须用 --wb-unit');
  assert.ok(btn[1].includes('height:var(--wb-unit)'), '按钮高度必须用 --wb-unit');
  assert.equal(/width:\d+px/.test(btn[1]), false, '按钮不得再写死宽度（38px 就是比例不协调的根因）');

  // 二、位置、间距、emoji 字号必须一起缩放：只缩按钮不缩间距会挤成一团
  for (const prop of ['top:calc(var(--wb-unit)', 'left:calc(var(--wb-unit)', 'gap:calc(var(--wb-unit)']) {
    assert.ok(stack[1].includes(prop), '.wb-stack 缺少随单位缩放的 ' + prop);
  }
  assert.ok(right[1].includes('right:calc(var(--wb-unit)'), '右侧摆放也必须跟着缩放');
  // emoji 字号跟着缩放，但带一个可读下限（小尺寸下 5px 的图标等于看不见）
  assert.ok(btn[1].includes('font-size:max(8px,calc(var(--wb-unit)'), 'emoji 字号必须跟着缩放并保留下限');
  assert.ok(btn[1].includes('box-shadow:0 calc(var(--wb-unit)'), '投影也必须跟着缩放');

  // 三、默认尺寸下必须与旧版逐像素一致：260 × 38/260 = 38px
  const unit = /--wb-unit:clamp\((\d+)px,(.*),(\d+)px\)/.exec(stack[1]);
  assert.ok(unit !== null, '--wb-unit 必须是 clamp(下限px, …, 上限px)');
  const lower = Number(unit[1]);
  const upper = Number(unit[3]);
  const ratio = Number(/\*\s*([\d.]+)/.exec(unit[2])[1]);
  assert.ok(Math.abs(260 * ratio - 38) < 0.5, '默认 260px 必须还原成原来的 38px，实际 ' + (260 * ratio).toFixed(2));
  // 四、夹取：太小点不中、太大没必要（宠物体上限 400px）
  assert.ok(lower >= 10 && lower <= 16, '下限应在 10..16px（可点中且不至于太抢眼），实际 ' + lower);
  assert.ok(upper >= 48 && upper <= 80, '上限应在 48..80px，实际 ' + upper);
});

test('隐藏宠物（issue #10 第三点）：只收起本体，按钮与费用显示照旧', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');

  // 一、本体隐藏 = class + CSS。必须用 opacity 而不是 display:none：
  //     舞台盒子在位，旁边那组 ☁️💰🍪📊 按钮才不会跳位。
  assert.ok(source.includes("' is-hidden is-peek-' + peekSide"), '根节点必须带 is-hidden 与贴边类');
  const rule = /'\.dsh-pet-root\.is-hidden \.dsh-pet-stage\{([^}]*)\}'/.exec(source);
  assert.ok(rule !== null, '必须有 .dsh-pet-root.is-hidden .dsh-pet-stage 规则');
  assert.ok(rule[1].includes('opacity:0'), '隐藏必须用 opacity（display:none 会让按钮跳位）');
  assert.equal(rule[1].includes('display:none'), false, '不得用 display:none 隐藏舞台');
  assert.ok(rule[1].includes('pointer-events:none'), '隐藏后不得再吃掉鼠标事件（z-index 40 会挡住下面的界面）');

  // 二、动画要真的停下来，而不是"看不见还在烧 CPU"；取消隐藏要接着播
  assert.ok(source.includes('if (!hiddenRef.current) el.play()'), '隐藏时 switchTo 不得启动播放');
  assert.ok(/if \(hidden\) \{[\s\S]{0,240}stopMove\(\)/.test(source), '隐藏时必须停掉正在进行的漫游');
  assert.ok(source.includes('wasHiddenRef'), '取消隐藏时必须把前台缓冲重新播起来');

  // 三、隐藏时不漫游 / 不响应点击；**通知气泡要保留**（贴边偷看时她就在屏幕边，
  //     完成/失败/回来汇总、以及天气/余额/喂食的结果都要看得见），
  //     只压掉"工作中的打字气泡"。
  assert.ok(source.includes('if (editorRef.current || hiddenRef.current) return false;'), '隐藏时不得漫游');
  assert.ok(source.includes('if (editorRef.current || hiddenRef.current) return;'), '隐藏时不得响应点击/拖拽/双击');
  assert.equal(source.includes('if (hiddenRef.current) return;'), false, '隐藏时不得再掐掉气泡通道（通知气泡要保留）');
  assert.ok(source.includes('!editing && bubble ?'), '隐藏时完成/结果气泡必须照常渲染');
  assert.equal(source.includes('!editing && !hidden && bubble ?'), false, '通知气泡不得再被隐藏状态挡住');
  assert.ok(source.includes('!editing && !hidden && typing && !bubble ?'), '隐藏时打字气泡仍不得渲染');

  // 四、设置面板可达，且按钮组 / 两个费用 pill 不依赖宠物可见性
  assert.ok(source.includes("'隐藏宠物'"), '设置面板必须有「隐藏宠物」开关');
  assert.ok(source.includes("path: ['hidden']"), '开关必须写 hidden 字段');
  assert.ok(source.includes("'conversation.composer.dock'") && source.includes("'conversation.chat.assistant-actions'"),
    '两个费用 pill 必须照旧注册（它们是独立槽位组件，与宠物本体无关）');
});

test('隐藏后改为"贴浏览器边缘偷看"：素材合规且接线正确', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');

  // 一、素材本身：必须存在、是真 PNG、带 alpha、竖构图（人物图）
  const asset = fileURLToPath(new URL('../assets/thumb/peek-edge.png', import.meta.url));
  assert.ok(existsSync(asset), '缺少素材 assets/thumb/peek-edge.png');
  const bytes = readFileSync(asset);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '必须是合法 PNG');
  assert.equal(bytes[25], 6, '必须是带 alpha 的 PNG（colorType 6 = RGBA），否则墙/背景会一起显示出来');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width > 50 && height > 100 && height > width, '应是竖构图的人物图，实际 ' + width + 'x' + height);
  assert.ok(bytes.length < 900 * 1024, '素材别太大（当前 ' + bytes.length + ' bytes）');

  // 二、引用：走宿主既有的 /pet/thumb/ 路由（不新增路由），且只在隐藏时渲染
  assert.ok(source.includes("const PEEK_ASSET = 'peek-edge.png'"), '必须声明素材名常量');
  assert.ok(source.includes("src: '/pet/thumb/' + PEEK_ASSET"), '必须走既有的 /pet/thumb/ 路由');
  assert.ok(source.includes("hidden ? h('img'"), '只在隐藏时渲染偷看图');
  assert.ok(source.includes("path: ['hidden'], value: false"), '点她应当能叫她出来');

  // 三、贴边定位：左右由 CSS 决定，右边界镜像；按钮组让到画面内侧
  assert.ok(source.includes("const peekSide"), '必须计算贴哪一边');
  assert.ok(source.includes("is-peek-' + peekSide"), '根节点必须带贴边类');
  assert.ok(source.includes("'.dsh-pet-root.is-peek-left{left:0;right:auto;bottom:0;top:auto}'"), '左贴边规则');
  assert.ok(source.includes("'.dsh-pet-root.is-peek-right{right:0;left:auto;bottom:0;top:auto}'"), '右贴边规则');
  assert.ok(source.includes('is-peek-right .dsh-pet-peek{left:auto;right:0;transform:scaleX(-1)}'), '右贴边必须水平镜像');
  assert.ok(source.includes('is-peek-left .wb-stack{left:calc(var(--dsh-pet-size,260px) * .445 + 4px)'), '按钮要让到画面内侧挨着她');
  // 通知气泡必须**向画面内侧让开**：气泡宽 170-240px，而她贴边时头部中心只离边
  // 尺寸×.2225（260px 时约 58px），居中等于一半气泡被屏幕边切掉（真机反馈"被遮挡"）。
  assert.ok(source.includes('is-peek-left .dsh-pet-bubble{left:calc(var(--dsh-pet-size,260px) * .445 + 6px);--bubble-shift:0%}'), '左贴边时气泡要让到画面内侧');
  assert.ok(source.includes('is-peek-right .dsh-pet-bubble{left:auto;right:calc(var(--dsh-pet-size,260px) * .445 + 6px);--bubble-shift:0%}'), '右贴边时气泡也要镜像让到内侧');
  assert.equal(source.includes('dsh-pet-bubble{left:calc(var(--dsh-pet-size,260px) * .2225)}'), false, '不得再让气泡以头部中心居中（一半会跑出屏幕）');
  // 隐藏时自定义坐标必须让位给 CSS（内联样式优先级高于类）
  assert.ok(source.includes('const rootStyle = hidden'), '隐藏时根节点样式必须交给 CSS');
  // 尺寸仍跟设置走（与按钮组同一套缩放口径）
  assert.ok(source.includes('height:var(--dsh-pet-size,260px);width:calc(var(--dsh-pet-size,260px) * .445)'),
    '偷看图尺寸必须跟 --dsh-pet-size 走');
});

test('拖到屏幕边缘自动隐藏：认出左边还是右边，并把角落一起记住', () => {
  const source = readFileSync(CLIENT_PATH, 'utf8');

  // 一、阈值常量存在且在合理范围
  const margin = /const EDGE_HIDE_MARGIN = (\d+);/.exec(source);
  assert.ok(margin !== null, '必须有边缘判定阈值常量 EDGE_HIDE_MARGIN');
  assert.ok(Number(margin[1]) >= 8 && Number(margin[1]) <= 60, '阈值应在 8..60px，实际 ' + margin[1]);

  // 二、左右两侧分别判定，命中才动手
  assert.ok(source.includes('const maybeHideAtEdge = (clientX, clientY) => {'), '必须有"拖到边缘"的处理函数（要同时拿到横纵坐标）');
  assert.ok(source.includes('if (clientX <= EDGE_HIDE_MARGIN) side = '), '必须认出左边缘');
  assert.ok(source.includes('else if (clientX >= vw - EDGE_HIDE_MARGIN) side = '), '必须认出右边缘');
  assert.ok(source.includes('if (side === null) return;'), '没贴边不得乱动');
  assert.ok(source.includes('maybeHideAtEdge(dropX, dropY)'), '拖拽收尾（松手处）必须调用它');

  // 三、必须同时写 hidden / position / posY：三者都是持久化的，少写一个就会出现
  //     "拖到左上角，重启后贴在右下角"（客户端只能靠这两个字段还原边与高度）
  assert.ok(source.includes("{ op: 'set', path: ['hidden'], value: true }"), '贴边要写 hidden=true');
  assert.ok(source.includes("value: side === 'left' ? 'bottom-left' : 'bottom-right'"), '必须把对应角落一起写对');
  assert.ok(source.includes("{ op: 'set', path: ['posY'], value: clampPeekTop(clientY - size / 2, size, vh) }"), '必须把贴边高度一起记住');

  // 四、贴哪一边优先看"她刚被拖到哪"，不能被旧角落设置覆盖
  assert.ok(source.includes('if (customPos) return (customPos.rx * window.innerWidth)'), 'peekSide 必须优先用会话内的拖拽位置');
  assert.ok(source.includes('if (!geometry.custom) return corner === '), '其次才是角落设置');

  // 四之二、竖直方向也要跟随落点（不是永远贴底）
  assert.ok(source.includes('function clampPeekTop(value, size, viewHeight)'), '必须有贴边竖直位置的夹取函数');
  assert.ok(source.includes('const peekTop = !hidden'), '必须计算贴边时的竖直位置');
  assert.ok(source.includes('customPos.ry * window.innerHeight'), '竖直位置必须优先用会话内的落点高度');
  assert.ok(source.includes('geometry.hasPosY'), '设置里只写了 Y（贴边高度）时也要认');
  assert.ok(source.includes("peekTop === null ? {} : { top: peekTop + 'px', bottom: 'auto' }"), '隐藏时竖直位置要写进内联样式（横向仍交给 CSS 类）');
  assert.ok(source.includes("'.dsh-pet-root.is-peek-left{left:0;right:auto;bottom:0;top:auto}'"), '横向仍由贴边类负责');

  // 五、反向操作：也能把她从边上**拖出来**（越过阈值即取消隐藏，并跟手移动）
  const peekDrag = /const PEEK_DRAG_THRESHOLD = (\d+);/.exec(source);
  assert.ok(peekDrag !== null, '必须有拖出阈值常量 PEEK_DRAG_THRESHOLD');
  assert.ok(Number(peekDrag[1]) >= 2 && Number(peekDrag[1]) <= 20, '阈值应在 2..20px，实际 ' + peekDrag[1]);
  assert.ok(source.includes('const handlePeekMove = (e) => {'), '偷看素材必须支持拖动');
  assert.ok(source.includes("void postPetSettings([{ op: 'set', path: ['hidden'], value: false }]);"), '拖出来要取消隐藏');
  assert.ok(source.includes('rx: clampRatio(e.clientX / window.innerWidth)'), '拖出来要先把落点记进会话位置（免得先闪回旧角落）');
  assert.ok(source.includes('rootEl.style.left = clampPetX(e.clientX - size / 2, size, window.innerWidth)'), '拖动期间直写 DOM 时必须夹回视口');
  assert.ok(source.includes('if (justDraggedRef.current) return;'), '拖完不得再触发一次"叫她出来"');
  for (const binding of ['onPointerDown: handlePeekDown', 'onPointerMove: handlePeekMove', 'onPointerUp: handlePeekUp', 'onLostPointerCapture: handlePeekUp']) {
    assert.ok(source.includes(binding), '素材上要挂 ' + binding);
  }

  // 五之二、拖动的两种意图要分开：**沿边上下拖只改高度（保持隐藏）**，
  //         只有朝画面内侧横拖够远才"拽出来"。
  const pullOut = /const PEEK_PULL_OUT_DISTANCE = (\d+);/.exec(source);
  assert.ok(pullOut !== null, '必须有"拽出来"的横向阈值常量 PEEK_PULL_OUT_DISTANCE');
  assert.ok(Number(pullOut[1]) >= 16 && Number(pullOut[1]) <= 120, '阈值应在 16..120px，实际 ' + pullOut[1]);
  assert.ok(source.includes('const inward = g.side === \'left\' ? dx : -dx;'), '必须按贴边方向算"朝内"的分量');
  assert.ok(source.includes('if (!g.out && inward >= PEEK_PULL_OUT_DISTANCE)'), '只有朝内拖够远才取消隐藏');
  // 未拽出时只写 top（横向仍贴边），拽出后才写 left/top 跟手
  assert.ok(source.includes('g.top = clampPeekTop(e.clientY - size / 2, size, window.innerHeight);'), '上下拖动只改高度');
  assert.ok(/if \(g\.out\) \{[\s\S]{0,400}return;\s*\}\s*\/\/ 还没拽出来/.test(source),
    '必须是"先判断拽出、否则只沿边上下"的结构（反过来会在上下拖动时被拽出来）');
  // 松手时：拽出才提交指针落点；只上下拖则保持隐藏、把新高度写回设置
  assert.ok(/if \(out\) \{[\s\S]{0,300}return;\s*\}[\s\S]{0,600}\{ op: 'set', path: \['posY'\], value: finalTop \}/.test(source),
    '松手时只有"拽出"分支才提交指针位置；纯上下拖必须保持隐藏并写回高度');
  assert.ok(source.includes('const peekIdle = { active: false, moved: false, out: false, sx: 0, sy: 0, side: \'right\', top: null };'),
    '手势初始状态必须包含 out/side/top（自愈时整体复位）');

  // 六、真机 bug 回归：指针在窗口外松开时 pointerup 会丢，手势状态一直挂着 →
  //     鼠标**只是划过**（没有任何按键）也会被当成拖动，甚至把宠物拖到窗口外够不回来。
  assert.ok(source.includes('function clampRatio(value)'), '必须有比例夹取函数');
  assert.equal((source.match(/if \(e\.buttons === 0\)/g) || []).length >= 2, true,
    '宠物本体与偷看素材的 pointermove 都必须用"没按键"自愈挂住的手势');
  assert.ok(source.includes("forward('lostpointercapture', 'pointerup')"), 'video 收到失去捕获也要收尾');
  assert.ok(source.includes('rootEl.style.left = clampPetX(e.clientX - size / 2, size, window.innerWidth)'), '本体拖拽也要夹回视口');
});
