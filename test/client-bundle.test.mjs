/**
 * dsh-whale-girl-pet 浏览器半侧 bundle 冒烟测试：
 * 在 VM 里按 __ModuleLoader__ 协议加载 lib/client.js，执行 factory，
 * 并检查 apply 注册的槽位（桌宠、设置面板、费用 pill）与文案命名空间。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  // 二、朝向镜像：跨边界的后代选择器已失效，必须走能穿透 shadow 继承的自定义属性
  assert.equal(code.includes(':host-context'), false, ':host-context() 在 Firefox/Safari 从未实现，不得使用');
  assert.ok(code.includes('\'.dsh-pet-root[data-facing="right"]{--dsh-pet-flip:-1}\''), '镜像必须由祖先设置 --dsh-pet-flip');
  assert.ok(code.includes('transform:scaleX(var(--dsh-pet-flip,1))'), 'shadow 内的 video 必须读 --dsh-pet-flip');

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
