/**
 * ============================================================================
 * dsh-pet 浏览器半侧（browser half）—— 宠物插件的"前端"部分
 * ============================================================================
 *
 * 【这个文件是什么】
 *   本文件是宠物在浏览器里运行的代码。它：
 *   1. 以官方规定的"客户端 bundle 形态"注册自己（window.__ModuleLoader__.load）
 *   2. 把宠物组件挂到 DSH 界面的 `shell.overlay` 槽位（右下角的浮动层）
 *   3. 负责宠物的所有视觉与交互：播放动画、随机行为、点击/拖拽、屏幕漫游
 *
 * 【为什么长这样（重要背景）】
 *   DSH 的浏览器插件必须是一个特殊格式的 JS 文件：
 *   - 用 `window.__ModuleLoader__.load({ id, factory })` 注册
 *   - factory 接收一个同步的 `require`，用它拿 React 和 DSH 提供的模块
 *   - **不能**自己打包 React（React 由 DSH 外壳提供，这里直接 require）
 *   - CSS 以字符串形式内联注入 <style> 标签
 *   官方插件（如 dsh-client-ui-goal）的 lib/client.js 就是这种形态，
 *   本文件是手写等价实现，零构建依赖，方便直接阅读和修改。
 *
 * 【动画文件从哪来】
 *   动画视频通过 /pet/thumb/<动画名>.webm 加载——这个路由由宿主半侧
 *   （lib/index.js）提供，把 assets/thumb/ 下的 WebM 文件发给浏览器。
 *
 * ============================================================================
 */
window.__ModuleLoader__.load({
	// 插件唯一 ID，必须与 package.json 里声明的一致
	id: 'dsh-whale-girl-pet',

	// factory：浏览器加载本 bundle 时执行，返回插件的导出
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		// ---- 从 DSH 外壳拿 React（不能自己打包） ----
		let react = require('react');
		let { useEffect, useLayoutEffect, useRef, useState } = react;
		// jsx 是 React 18 的新 JSX 转换函数，这里起个别名 h 方便书写
		let { jsx: h } = require('react/jsx-runtime');
		// 本 fork：费用明细弹层需要 portal 到 body（避免被输入框容器裁切）
		let { createPortal } = require('react-dom');

		// ---------------------------------------------------------------------------
		// 看板主图的几何常量
		// 必须定义在 css 数组之前：下面的 CSS 字符串里直接引用了绘图高度。
		// viewBox 宽度只用来表示 x 轴分配比例（1000 个单位），实际像素宽由容器决定。
		// ---------------------------------------------------------------------------
		/** 绘图区 viewBox 宽度。 */
		const DASH_VIEW_WIDTH = 1000;
		/** 绘图区高度（px）：柱体 + 网格的真实高度，Y 轴文字与柱顶数值都按它定位。 */
		const DASH_PLOT_HEIGHT = 168;
		const DASH_PLOT_BOTTOM = DASH_PLOT_HEIGHT;
		/**
		 * 柱顶数值的专属高度带（px）：数值放在绘图区**上方**而不是压在柱子上。
		 * 绘图区上沿留了 8% 顶空，最高那根的标签正好落在这条带里。
		 */
		const DASH_LABEL_ZONE = 16;
		/** 柱顶数值的行高（px）：标签底边贴柱顶，所以 top = 柱顶 y − 行高。 */
		const DASH_LABEL_LINE = 12;
		/**
		 * 看板**默认尺寸**（px）：从未拖过 / 双击头部复位时就用它。
		 * 视口更小时按 `视口 − 24` 收窄，保证任何窗口都放得下（小窗口下不会顶到边）。
		 * 720×480 的依据：列宽 720 − 38（Y 轴）− 32（内边距）≈ 650，24 根柱时
		 * 每根 ≈27px，三段堆叠仍分得清；高度按"168px 绘图区 + 头部 + 5 格汇总 +
		 * 图例 + 说明"的排布取值，内容略高时面板内部滚动而不会溢出屏幕。
		 * 注意**不要**把它取成"面板当前渲染尺寸"（见 sizeOf 的注释）。
		 */
		const DASH_DEFAULT_WIDTH = 720;
		const DASH_DEFAULT_HEIGHT = 480;
		/**
		 * 看板布局记忆的**版本号**。
		 *
		 * 凡改动"默认尺寸/默认位置"这类记忆语义，必须 +1：读到旧版本号时整份记忆
		 * 作废（等价于"没记忆过"），否则用户浏览器里的老记忆会一直盖住新默认值。
		 *   1 → 2：默认位置由"贴着 📊 按钮"改为**屏幕居中**；
		 *   2 → 3：默认尺寸改为 720×580，并修掉"实测尺寸盖住默认尺寸"的缺陷；
		 *   3 → 4：默认高度调整为 470；
		 *   4 → 5：默认高度调整为 480。
		 */
		const DASH_LAYOUT_VERSION = 5;

		// ============================================================================
		// 内联 CSS —— 注入一次，官方插件标准做法
		// ============================================================================
		// 说明：
		// - .dsh-pet-root       宠物的根容器，fixed 定位（相对视口），默认右下角
		// - .dsh-pet-stage      内部舞台，承载两个 video 的层叠
		// - .dsh-pet-video      动画视频；opacity 默认 0（隐藏），.is-front 时显示
		// - 双 video 层叠：一个显示、一个预加载，切换时交叉淡入避免闪空白
		const css = [
			// 根容器：fixed 固定定位、层级 40（在界面之上）、整体点击穿透（不挡界面操作）、禁止选中
			'.dsh-pet-root{position:fixed;z-index:40;pointer-events:none;user-select:none}',
			// 右下角默认位置（right:24px 距右缘、bottom:0 贴底）
			'.dsh-pet-root[data-corner="bottom-right"]{right:24px;bottom:0}',
			// 左下角位置
			'.dsh-pet-root[data-corner="bottom-left"]{left:24px;bottom:0}',
			// 舞台：正方形（尺寸由 --dsh-pet-size 控制，默认 260px），本身不响应鼠标
			'.dsh-pet-stage{position:relative;width:var(--dsh-pet-size,260px);height:var(--dsh-pet-size,260px);pointer-events:none}',
			// 视频：铺满舞台、保持比例、可交互（pointer-events:auto 重新开启）、抓取光标
			// opacity:0 初始隐藏，transition 做 180ms 淡入淡出
			'.dsh-pet-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:auto;cursor:grab;opacity:0;transition:opacity .18s ease;transform-origin:center}',
			// 显示中的视频（is-front 类）
			'.dsh-pet-video.is-front{opacity:1}',
			// 按住时显示"抓取中"光标
			'.dsh-pet-video:active{cursor:grabbing}',
			// 朝向镜像：facing=right 时水平翻转（人物偏右）。镜像只作用 CSS，
			// 不碰视频文件——这是"所有动画都能朝左/朝右"的实现关键
			'.dsh-pet-root[data-facing="right"] .dsh-pet-video{transform:scaleX(-1)}',
			// 无障碍：用户系统开启"减少动态效果"时关闭过渡动画
			'@media (prefers-reduced-motion: reduce){.dsh-pet-video{transition:none}}',
			// 本 fork 新增：任务通知气泡 + 工作打字气泡
			// 气泡水平偏移用 CSS 变量 --bubble-shift（居中=-50%，左侧/右侧=0），
			// 这样 pop 动画的 keyframes 也会跟随位置设置，不会把左/右位置覆盖成居中。
			'.dsh-pet-bubble{--bubble-shift:-50%;position:absolute;top:-14px;left:50%;transform:translateX(var(--bubble-shift));background:rgba(255,255,255,.97);border:1px solid #cfe4ff;border-radius:12px;padding:8px 12px;box-shadow:0 6px 18px rgba(30,60,120,.2);min-width:170px;max-width:240px;text-align:center;pointer-events:auto;cursor:pointer;color:#1c2b4a;animation:dsh-pet-pop .25s ease;z-index:2}',
			'.dsh-pet-bubble-title{font-size:13px;font-weight:700}',
			'.dsh-pet-bubble-title-fail{color:#c24040}',
			// 本 fork 新增：多行信息型气泡（余额/用量）左对齐，排版更整齐
			'.dsh-pet-bubble-lines{text-align:left}',
			'.dsh-pet-bubble-msg{font-size:12px;color:#55627c;margin-top:2px;line-height:1.45;white-space:pre-line}',
			'.dsh-pet-bubble-work{text-align:left;min-width:170px}',
			'.dsh-pet-bubble-work .dsh-pet-bubble-msg{font-family:ui-monospace,Menlo,Consolas,monospace;color:#3b6fd4}',
			'.dsh-pet-cursor{color:#4D94F5;animation:dsh-pet-blink .9s steps(1) infinite}',
			'@keyframes dsh-pet-blink{0%,55%{opacity:1}56%,100%{opacity:0}}',
			'@keyframes dsh-pet-pop{from{transform:translateX(var(--bubble-shift)) scale(.85);opacity:0}to{transform:translateX(var(--bubble-shift)) scale(1);opacity:1}}',
			'@media (prefers-color-scheme:dark){.dsh-pet-bubble{background:rgba(28,38,62,.97);border-color:#2c4574;color:#e8f0ff}.dsh-pet-bubble-msg{color:#a9b8d8}.dsh-pet-bubble-work .dsh-pet-bubble-msg{color:#9cc3ff}}',
			// 本 fork 新增：宠物身上的按钮堆（☁️/💰/🍪），位置跟随设置（左/右）
			'.wb-stack{position:absolute;top:60px;left:-52px;z-index:3;pointer-events:auto;display:flex;flex-direction:column;gap:8px;align-items:flex-start}',
			'.wb-stack-right{left:auto;right:-52px;align-items:flex-end}',
			'.wb-btn{width:38px;height:38px;border-radius:50%;border:1px solid #cfe4ff;background:rgba(255,255,255,.95);box-shadow:0 3px 12px rgba(30,60,120,.25);cursor:pointer;font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s;color:#1c2b4a}',
			'.wb-btn:hover{transform:scale(1.12)}',
			'.wb-btn:active{transform:scale(.95)}',
			'.wb-loading{opacity:.55;pointer-events:none}',
			'@media (prefers-color-scheme:dark){.wb-btn{background:rgba(28,38,62,.95);border-color:#2c4574;color:#e8f0ff}}',
			// 本 fork 新增：会话费用 pill + 明细弹层（输入框下方统计行右侧）
			// 【DSH 0.1.6-alpha.2 兼容】官方把 composer dock 包成了横向 flex 行
			// （ui-conversation 的 InputBar.module.css：.dock{display:flex;
			// align-items:center;justify-content:center;gap:12px;padding-top:4px}），
			// 并把「上下文占用」也放进这一行。旧写法（width:100% + max-width +
			// margin:-20px auto 0 + padding + justify-content:flex-end）是给旧布局
			// 做的覆盖式定位——那时 dock 直接挂在 .root 上、官方 stats 行独占一行，
			// 靠负 margin 把自己提上去和它同排。进了横向 flex 行之后，这个负
			// margin 会把自己整块上移 20px，width:100% 还会挤扁同排的官方条目，
			// 于是"歪了"。现在它就是一个普通行内 flex 项：间距与垂直居中交给
			// dock 的 gap / align-items，与官方 stats pill、上下文计自然同排。
			// （旧版 DSH 下它会退化成自己居中一行，不再和官方行重叠，同样可用。）
			'.dsh-cost-root{display:inline-flex;flex:none;align-items:center;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));pointer-events:none}',
			'.dsh-cost-anchor{display:inline-flex;min-width:0;pointer-events:auto}',
			'.dsh-cost-pill{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;padding:1px 8px;border:none;border-radius:24px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;cursor:pointer}',
			'.dsh-cost-pill:hover,.dsh-cost-pill[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.dsh-cost-pill svg{width:14px;height:14px;flex:none}',
			'.dsh-cost-sep{color:var(--dsw-alias-separator-primary);margin:0 6px}',
			'.dsh-cost-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;font-size:10px;line-height:1;font-weight:500}',
			'.dsh-cost-badge[data-peak="true"]{background:rgba(226,124,0,.16);color:#b26a00}',
			'.dsh-cost-badge[data-peak="false"]{background:rgba(0,122,255,.14);color:#0a66c2}',
			// 表面材质：**不透明**高层级表面（看板与费用弹层共用）。
			// DSH 0.1.7 把 --dsw-specific-menu 从 rgba(...,.94) 改成了半透明
			// （浅色 rgba(248,249,250,.58) / 深色 rgba(48,49,54,.5)），并且规定
			// 用它必须同时应用 backdrop-filter: var(--dsw-menu-backdrop-filter)
			// （见官方 ui-chat 的 stat-dialog.module.css）——只取颜色不配滤镜就会
			// "看穿"成半透明。宠物这两块是大面积信息面板，直接用官方 Modal 内容
			// 同款的不透明层表面 --dsw-alias-bg-layer-2（配同一个 elevation-prominent），
			// 第二档回退到不透明的 --dsw-alias-bg-module-platform，避免 token 再漂移。
			'.dsh-cost-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(280px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));padding:16px;border:0;border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-module-platform));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default}',
			'.dsh-cost-title{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
			'.dsh-cost-title-label{display:inline-flex;align-items:center;gap:6px;min-width:0}',
			'.dsh-cost-title-label svg{width:14px;height:14px;flex:none}',
			'.dsh-cost-rule{margin-bottom:10px;border-top:.5px solid var(--dsw-alias-border-l2)}',
			'.dsh-cost-details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}',
			'.dsh-cost-details dt,.dsh-cost-details dd{min-width:0;margin:0}',
			'.dsh-cost-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
			'.dsh-cost-note{margin-top:10px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dsh-cost-total{font-variant-numeric:tabular-nums}',
			// 本 fork 新增：每条回复动作行里的"本轮费用"pill（与官方"用量 X tok"同排）
			'.dsh-cost-turn-root{display:inline-flex;min-width:0}',
			'.dsh-cost-turn-trigger{display:inline-flex;align-items:center;gap:4px;min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px 8px;border:none;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(24px + var(--dsh-content-font-delta,0px));white-space:nowrap;cursor:pointer}',
			'.dsh-cost-turn-trigger:hover,.dsh-cost-turn-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.dsh-cost-turn-trigger svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));flex:none}',
			'.dsh-cost-turn-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
			'@media (max-width:480px){.dsh-cost-turn-trigger{justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));padding:6px}.dsh-cost-turn-label{display:none}}',
			// ================================================================
			// 本 fork 新增：气泡看板（分时段花费）—— 面板 / 拖拽 / 柱状图
			// 锚点就是按钮组里的 📊 按钮本身（forwardRef 落到真实 <button>）
			// ================================================================
			'.dsh-pet-dash-panel{position:fixed;z-index:1100;box-sizing:border-box;width:min(520px,calc(100vw - 24px));padding:14px 16px 12px;border:0;border-radius:14px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-module-platform));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:default}',
			'.dsh-pet-dash-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
			// 本 fork：头部是拖拽手柄（拖动移动看板）；双击恢复默认位置/尺寸
			'.dsh-pet-dash-panel .dsh-pet-dash-head{cursor:grab;touch-action:none}',
			'.dsh-pet-dash-panel.is-dragging .dsh-pet-dash-head{cursor:grabbing}',
			'.dsh-pet-dash-panel.is-dragging{user-select:none}',
			// 右下角缩放手柄（只在悬停/拖拽时明显）
			'.dsh-pet-dash-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;touch-action:none;opacity:.4;border-right:2px solid var(--dsw-alias-label-tertiary);border-bottom:2px solid var(--dsw-alias-label-tertiary);border-bottom-right-radius:6px}',
			'.dsh-pet-dash-panel:hover .dsh-pet-dash-resize{opacity:.85}',
			'.dsh-pet-dash-title-label{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-weight:500;font-size:13px}',
			'.dsh-pet-dash-title-label svg{width:15px;height:15px;flex:none}',
			'.dsh-pet-dash-tools{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}',
			'.dsh-pet-dash-seg{display:inline-flex;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;overflow:hidden}',
			'.dsh-pet-dash-seg button{border:0;background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11.5px;padding:3px 9px;cursor:pointer}',
			'.dsh-pet-dash-seg button[data-on="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.dsh-pet-dash-refresh{border:.5px solid var(--dsw-alias-border-l4);background:0 0;color:var(--dsw-alias-label-tertiary);border-radius:8px;width:24px;height:24px;line-height:1;font-size:13px;cursor:pointer}',
			'.dsh-pet-dash-refresh:hover{color:var(--dsw-alias-label-primary)}',
			'.dsh-pet-dash-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px;margin-bottom:12px}',
			'.dsh-pet-dash-stat{background:var(--dsw-alias-bg-module-platform);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:1px}',
			'.dsh-pet-dash-stat b{color:var(--dsw-alias-label-primary);font-size:15px;line-height:20px;font-variant-numeric:tabular-nums}',
			'.dsh-pet-dash-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
			'.dsh-pet-dash-stat em{font-style:normal;font-size:10.5px;color:var(--dsw-alias-label-tertiary);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			// 看板主图：Y 轴刻度 + SVG 堆叠柱 + 平均线 + 柱顶数值
			// 结构：plot（相对定位，含 SVG 绘图区）→ 绝对定位的 Y 轴刻度 / 均值标注 / 柱顶数值
			//       顶部再留出 DASH_LABEL_ZONE 的数值带，避免数字压在柱子上。
			'.dsh-pet-dash-chart{display:flex;flex-direction:column;gap:6px}',
			'.dsh-pet-dash-plot{position:relative;height:' + (DASH_PLOT_HEIGHT + DASH_LABEL_ZONE) + 'px;margin-left:38px}',
			'.dsh-pet-dash-plot>svg{position:absolute;left:0;bottom:0;display:block;width:100%;height:' + DASH_PLOT_HEIGHT + 'px}',
			'.dsh-pet-dash-yaxis{position:absolute;left:-38px;bottom:0;width:34px;height:' + DASH_PLOT_HEIGHT + 'px}',
			'.dsh-pet-dash-yaxis span{position:absolute;right:0;transform:translateY(-50%);font-size:9.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
			'.dsh-pet-dash-grid{stroke:var(--dsw-alias-border-l2);stroke-width:1}',
			'.dsh-pet-dash-band{fill:rgba(226,124,0,.10)}',
			'.dsh-pet-dash-seg.is-hit{fill:#4D94F5}',
			'.dsh-pet-dash-seg.is-miss{fill:#E27C00}',
			'.dsh-pet-dash-seg.is-out{fill:#7C5CE0}',
			'.dsh-pet-dash-seg.is-current{stroke:var(--dsw-alias-label-primary);stroke-width:1.2;stroke-opacity:.55}',
			'.dsh-pet-dash-tip{position:absolute;transform:translateX(-50%);font-size:9.5px;line-height:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none}',
			'.dsh-pet-dash-tip.is-current{color:var(--dsw-alias-label-primary);font-weight:600}',
			'.dsh-pet-dash-xaxis{display:flex;margin-left:38px}',
			'.dsh-pet-dash-xaxis span{flex:1 1 0;min-width:0;text-align:center;font-size:9.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden}',
			'.dsh-pet-dash-xaxis span.is-current{color:var(--dsw-alias-label-primary);font-weight:600}',
			// 图例：每项 flex:none + nowrap，否则窄面板下 flex 会把"缓存命中"压成竖排单字
			'.dsh-pet-dash-legend{display:flex;gap:14px;row-gap:4px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}',
			'.dsh-pet-dash-legend-item{display:inline-flex;align-items:center;gap:5px;flex:none;white-space:nowrap}',
			'.dsh-pet-dash-legend-note{flex:1 1 100%;opacity:.85;white-space:normal}',
			'.dsh-pet-dash-dot{width:8px;height:8px;border-radius:2px;display:inline-block}',
			'.dsh-pet-dash-dot.is-hit{background:#4D94F5}',
			'.dsh-pet-dash-dot.is-miss{background:#E27C00}',
			'.dsh-pet-dash-dot.is-out{background:#7C5CE0}',
			'.dsh-pet-dash-dot.is-band{background:rgba(226,124,0,.35)}',
			'.dsh-pet-dash-meta{margin-top:10px;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}',
			'.dsh-pet-dash-note{margin-top:6px;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);opacity:.85}',
			'.dsh-pet-dash-error{margin:8px 0;color:var(--dsw-alias-state-error-primary,#c24040);font-size:11.5px}',
			'.dsh-pet-dash-empty{padding:26px 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11.5px}',
			'@media (max-width:480px){.dsh-pet-dash-value{display:none}}',
		].join('\n');
		const cssTag = 'dsh-pet/style.css';
		// 只在页面还没有这个 style 标签时才注入（防止热重载/重复挂载时重复）
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + cssTag + '"]') === null) {
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-pet';
			tag.dataset.pluginCss = cssTag;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ============================================================================
		// 动画目录（animation catalog）—— 所有动画名和参数的"事实来源"
		// ============================================================================
		// 对齐说明：thumb 视频是 360×360 画布，人物的"脚底"在 y=330 处。
		// (360-330)/360 = 30/360 = 0.0833，与 1200 母版 (1200-1100)/1200 比例一致，
		// 所以用这个比例做落地对齐，缩放后依然准确。
		const CANVAS_H = 360; // thumb 画布高度
		const FEET_Y = 330;   // thumb 画布上"脚底"的 y 坐标（人物站在 y=330 线上）

		// 主体待机动画（唯一常驻、循环播放）
		const IDLE = '待机呼吸休闲';
		// 转向动画（东张西望本身内容就是"从偏左看到偏右"，播完翻转 facing）
		const TURN = '东张西望';
		// 随机动作池：纯字符串数组，全部等概率抽取。
		// 含"打瞌睡被惊醒"（原独立闲置动画，已统一纳入）。
		// 注意：原地漂浮踏步不在这里，它是移动动画（在 MOVES 里）。
		const ACTS = [
			'悠闲哼歌',
			'超大伸懒腰',
			'原地专心玩魔方',
			'原地敲击桌面互动',
			'原地重力下蹲压缩',
			'哈欠连天',
			'原地小憩沉眠',
			'原地蹲下玩玩具汽车',
			'鲸鱼吐泡泡特效',
			'女仆屈膝礼仪',
			'被吓一跳（炸毛）',
			'原地跳跃抓碎头顶物品',
			'小幅度原地 360 度旋转展示',
			'偷吃零食被抓住',
			'玩游戏气急败坏',
			'用鲸鱼尾巴拍打地面',
			'打瞌睡被惊醒', // 原独立闲置动画，已并入
			'偷吃Token',   // 本 fork 新增：随机动作
			// 本 fork 新增：新生成动画接入随机动作池
			'打喷嚏',
			'喝奶茶',
			'女仆扫除',
			'空白举牌',
			'举牌不是大肥鱼', // 本 fork：空白牌叠加文字的成品
			'闲得无聊打游戏', // 本 fork：新生成随机动作
		];
		// 点击回应动画池（3 选 1）
		const CLICKS = ['点击回应 - 开心跃动', '点击回应 - 害羞惊讶', '点击回应 - 傲娇生气（侧身展示）'];
		// 拖拽动画（按住时播放）
		const DRAG = '被鼠标拖拽悬空反馈';
		// 移动动画池：动画只提供"走路姿态"，实际位置移动由代码（rAF）驱动
		const MOVES = ['螃蟹走路', '原地漂浮踏步'];
		// 移动参数：
		const MOVE_MIN_PX = 60;  // 每次移动的最短距离（px）
		const MOVE_MAX_PX = 240; // 每次移动的最长距离（px）
		const MOVE_MARGIN = 20;  // 屏幕边缘安全边距（px），防止宠物贴边/出屏
		const MOVE_LEAD_SEC = 2; // 动画开头 2s 是"准备动作"，位置不动
		const MOVE_TAIL_SEC = 2; // 动画结尾 2s 是"收尾动作"，位置不动

		// 睡眠三连（躺姿动画：进入 / 持续循环 / 被叫醒）
		const SLEEP_IN = '睡觉第一段';
		const SLEEP_LOOP = '睡觉第二段';
		const SLEEP_WAKE = '睡觉第三段';
		const SLEEP_IDLE_MS = 5 * 60 * 1000; // 空闲 5 分钟无动作 → 进入睡眠

		// 时间感知动画（新生成替换占位）
		const MORNING_SLEEPY = '睡眼惺忪';   // 8~10 点：睡眼惺忪
		const LUNCH = '吃盒饭';              // 12 点：吃午饭
		const NIGHT_GROGGY = '迷糊犯困';     // 23~3 点：迷糊犯困
		const TIME_ANIM_COOLDOWN_MS = 20 * 60 * 1000; // 时间动画最小间隔 20 分钟

		// 本 fork 新增：任务状态联动（Agent 状态镜像 + 结束通知）
		const STATE_API = '/api/whale-pet/state'; // 宿主半侧的状态/通知轮询接口
		// 工作三态：开始工作（站→坐，一次）→ 工作中轮播（坐姿循环池）→ 工作结束（坐→站，庆祝）
		const WORK_START = '开始工作';
		const WORK_END = '工作结束';
		const WORKING = '认真工作';                            // 工作轮播池默认项
		const WORKING_POOL = ['认真工作', '工作摸鱼', '工作思考', '摸鱼被抓']; // 工作中坐姿→站姿轮播池（运行时探测存在性）
		const BUSY_CLICK = '工作被打扰'; // 忙时点击：工作中被打扰（惊到→嫌弃→继续工作）
		const BUSY_LINES = [
			'正在忙，别摸我啦！',
			'呜…工作还没做完，等一下啦',
			'再摸的话，鲸尾要打结啦！',
			'忙着呢忙着呢，去去去～',
			'（小声）人家在认真工作……',
		];
		const NOTICE_DONE = ['点击回应 - 开心跃动', '鲸鱼吐泡泡特效', '女仆屈膝礼仪']; // 任务完成庆祝
		const NOTICE_FAIL = ['玩游戏气急败坏', '被吓一跳（炸毛）'];                   // 任务失败
		// 喂食动画与台词
		const FEED = '吃小鱼干'; // 本 fork：投喂专属动画（鱼干带 TOKEN 压字）
		const FEED_LINES = ['（啊呜）小鱼干真好吃～', '谢谢款待！心情 +1！', '再来一根？真的可以吗！'];
		// 随机小剧场台词（社区 DS 梗）
		const CHATTER = [
			'（小声）今天也没摸鱼，真的…',
			'我不是吃白饭的大肥鱼！',
			'让我看看你在写什么 bug…',
			'D指导说，今晚不许加班。',
			'要不要来杯奶茶？半糖去冰。',
			'刚才有个灵感飞过去了！',
			'（伸懒腰）啊——坐麻了。',
			'键盘声真好听，像下雨。',
		];
		// 打断型动画全集（用户点击/通知触发，播完回工作轮播或待机，不进随机链）
		const INTERRUPT = NOTICE_DONE.concat(NOTICE_FAIL).concat(['吃小鱼干', '看天气', '翻钱包', '看表叹气', '长时间工作看表', '工作结束', '工作被打扰']);

		// 生成 [min, max) 区间内的随机整数
		const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min));
		// 从字符串池里等概率随机抽一个；exclude 排除某个名字（避免连续重复）
		const pick = (pool, exclude) => {
			const entries = exclude ? pool.filter((n) => n !== exclude) : pool;
			return entries[Math.floor(Math.random() * entries.length)];
		};

		// ============================================================================
		// 本 fork 新增：气泡看板 —— 分时段 token / 花费面板
		// ----------------------------------------------------------------------------
		// 数据来自宿主半侧的 /api/whale-pet/usage（lib/usage-ledger.js 的分时段账本）：
		//   · 今日 24 个北京小时桶：每小时花费/token/调用次数 + 峰谷标记
		//   · 近 N 天（北京日）桶：日趋势
		// 图表是**手写内联 SVG**（零依赖）：不引第三方图表库，主题色走 --dsw-* 变量。
		// ============================================================================
		const DASH_API = '/api/whale-pet/usage';
		/**
		 * 看板文案转换器。桌宠本体挂在 shell.overlay 上（注册时没有 locale 座位，
		 * 拿不到框架注入的 t），所以这里直接用本插件注册的 COST_NS 词典自己查表：
		 * 中文键齐备，英文环境下英文键齐备，缺键时退回键名。
		 */
		const dashT = (key, params) => {
			const dict = COST_ZH[key] !== undefined ? COST_ZH : COST_EN;
			let text = dict[key] !== undefined ? dict[key] : key;
			if (params) {
				for (const name of Object.keys(params)) {
					text = text.split('{' + name + '}').join(String(params[name]));
				}
			}
			return text;
		};

		/** 千分位整数：14342442 → 14,342,442。 */
		function fmtInt(n) {
			return (Number(n) || 0).toLocaleString('en-US');
		}

		/** 紧凑 token：1234567 → 1.23M，12345 → 12.3k（与账单口径一致）。 */
		function fmtTokensCompact(n) {
			const value = Number(n) || 0;
			if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B';
			if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
			if (value >= 1e3) return (value / 1e3).toFixed(1) + 'k';
			return String(Math.round(value));
		}

		/** 把上界抬到"好看的整数"：1/2/2.5/5 × 10^n。 */
		function niceCeil(value) {
			if (!(value > 0)) return 1;
			const exponent = Math.floor(Math.log10(value));
			const base = Math.pow(10, exponent);
			const scaled = value / base;
			const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
			return step * base;
		}

		/** Y 轴刻度文字：金额带 ¥，token 走紧凑写法。 */
		function fmtAxisValue(value, metric) {
			if (metric === 'tokens') return fmtTokensCompact(value);
			const v = Number(value) || 0;
			if (v <= 0) return '0';
			if (v < 1) return v.toFixed(2);
			if (v < 10) return v.toFixed(1);
			return String(Math.round(v));
		}

		/**
		 * 柱子/均值的数值标签。
		 * @param symbol - 传 `'@'` 时金额带 ¥ 前缀（平均值标注用）；默认不带（柱顶省空间）。
		 */
		function fmtBarValue(value, metric, symbol) {
			if (metric === 'tokens') return fmtTokensCompact(value);
			const v = Number(value) || 0;
			if (v <= 0) return '';
			const prefix = symbol === '@' ? '¥' : '';
			if (v < 0.01) return prefix + '<0.01';
			if (v < 1) return prefix + v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
			return prefix + v.toFixed(2);
		}

		/**
		 * 解析 portal 容器：优先 document.body，退回 documentElement。
		 *
		 * 【为什么不能直接写 document.body】
		 *   插件 bundle 的模块作用域里 `document` 不一定就是渲染 React 应用的那个
		 *   document（DSH 的客户端模块系统可以给插件一个隔离环境）。一旦容器不是
		 *   真实 DOM 元素，React 的 createPortal 会抛 minified error #200
		 *   （"container is not a DOM element"）。所以这里**每次渲染都重新取**，
		 *   并且显式校验 nodeType，拿不到就退回内联渲染（见 DashboardModal）。
		 * @returns 可用容器，或 null。
		 */
		function portalContainer() {
			try {
				const doc = typeof document === 'undefined' ? undefined : document;
				if (doc === undefined || doc === null) return null;
				const candidates = [doc.body, doc.documentElement];
				for (const candidate of candidates) {
					if (candidate && candidate.nodeType === 1) return candidate;
				}
			} catch {
				// 取容器失败一律退回内联渲染
			}
			return null;
		}

		/** 看板图标：柱状图。 */
		function ChartIcon() {
			return react.createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
				react.createElement('path', {
					d: 'M2.2 13.4h11.6M4 13.4V8.6M7.4 13.4V4.6M10.8 13.4v-3.4',
					fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
				}));
		}

		/**
		 * 看板主图：**带 Y 轴刻度的三桶堆叠柱**（内联 SVG，零依赖）。
		 *
		 * 为什么从"矮 DOM 柱"换成 SVG：
		 *   · 原来没有 Y 轴/网格/均值线，只能看出"哪根高"，读不出量级；
		 *   · 柱顶数值是相对 max 归一的，柱高不代表绝对量级，重开面板还会变；
		 *   · 24 格 + 9px 数值必然重叠。
		 * 现在每根柱按「缓存命中 / 缓存未命中 / 输出」堆叠，配 4 档网格 +
		 * 高峰时段底纹，并只给"最高 3 根 / 当前小时 / token 视图"标数值，避免糊成一片。
		 * 均值不再画在图里（横贯虚线和柱顶数值会互相压），改为上方汇总格里的一个数字。
		 *
		 * @param props.bars - `[{ label, tip, hit, miss, out, value }]`（金额视图的 value = 三者和）
		 * @param props.metric - `cost` | `tokens`
		 * @param props.kind - `hour` | `day`（只影响说明文案）
		 * @param props.t - 文案函数
		 */
		function BarChart(props) {
			const bars = props.bars || [];
			const metric = props.metric;
			const kind = props.kind;
			const t = props.t;
			if (bars.length === 0) return null;

			// ---- 量级与刻度 ----
			const stackOf = (bar) => metric === 'tokens'
				? [bar.hitTokens || 0, bar.missTokens || 0, bar.outTokens || 0]
				: [bar.hit || 0, bar.miss || 0, bar.out || 0];
			const totals = bars.map((bar) => stackOf(bar).reduce((a, b) => a + b, 0));
			const grand = totals.reduce((a, b) => a + b, 0);
			if (grand <= 0) return react.createElement('div', { className: 'dsh-pet-dash-empty' }, t('dash.empty'));
			const rawMax = Math.max(...totals);
			const niceMax = niceCeil(rawMax * 1.08);
			const yOf = (value) => DASH_PLOT_BOTTOM - (value / niceMax) * DASH_PLOT_HEIGHT;

			// ---- 数值标签：只标"最高 3 根 + 当前小时"，token 视图全标（量级差异大） ----
			const ranked = totals.map((value, index) => ({ value, index }))
				.sort((a, b) => b.value - a.value);
			const labelled = new Set();
			const labelBudget = bars.length <= 8 ? 3 : 4;
			const showAllLabels = metric === 'tokens' && bars.length <= 12;
			if (showAllLabels) totals.forEach((_value, index) => labelled.add(index));
			else ranked.slice(0, labelBudget).forEach((row) => { if (row.value > 0) labelled.add(row.index); });
			bars.forEach((bar, index) => { if (bar.current) labelled.add(index); });

			// ---- X 轴：等距抽稀，保证标签之间留得下 ----
			const stride = Math.max(1, Math.ceil(bars.length / 8));
			const axisLabel = (bar, index) => {
				if (bar.current || index === bars.length - 1) return bar.label;
				return index % stride === 0 ? bar.label : '';
			};

			// ---- 网格 + Y 轴刻度 ----
			const grid = [];
			for (let step = 0; step <= 4; step += 1) {
				const value = (niceMax / 4) * step;
				const y = Math.round(yOf(value) * 10) / 10;
				grid.push({ key: 'g' + step, value, y });
			}

			const children = [];

			/**
			 * 这一屏真实出现过的项（决定图例显示哪些）。
			 *
			 * token 视图例外：缓存命中通常占 99%+，未命中/输出只有细丝甚至为 0，
			 * 但用户在 token 视图里**就是想知道**三桶各占多少——所以 token 视图
			 * 固定列全三桶（哪怕某桶为 0），并在说明里点明"柱高几乎全是缓存命中"。
			 * 金额视图则按实际出现与否显示，免得图例出现屏幕上不存在的颜色。
			 */
			const tokensView = metric === 'tokens';
			const present = {
				hit: tokensView || bars.some((bar) => bar.hit > 0),
				miss: tokensView || bars.some((bar) => bar.miss > 0),
				out: tokensView || bars.some((bar) => bar.out > 0),
				peak: bars.some((bar) => bar.peak),
			};

			// 1) 高峰时段底纹（每根柱一条，宽度在 viewBox 单位里算）
			const unit = DASH_VIEW_WIDTH / bars.length;
			bars.forEach((bar, index) => {
				if (!bar.peak) return;
				children.push(react.createElement('rect', {
					key: 'band' + index,
					className: 'dsh-pet-dash-band',
					x: Math.round(index * unit * 10) / 10,
					y: 0,
					width: Math.round(unit * 10) / 10,
					height: DASH_PLOT_HEIGHT,
				}));
			});

			// 2) 网格线 + 数值参照
			grid.forEach((line) => {
				children.push(react.createElement('line', {
					key: line.key,
					className: 'dsh-pet-dash-grid',
					x1: 0,
					y1: line.y,
					x2: DASH_VIEW_WIDTH,
					y2: line.y,
				}));
			});

			// 3) 堆叠柱
			const barWidth = unit * 0.66;
			bars.forEach((bar, index) => {
				const center = index * unit + unit / 2;
				const x = Math.round((center - barWidth / 2) * 10) / 10;
				const stack = stackOf(bar);
				const keys = ['hit', 'miss', 'out'];
				let cursor = DASH_PLOT_BOTTOM;
				keys.forEach((bucketKey, bucketIndex) => {
					const value = stack[bucketIndex];
					if (!(value > 0)) return;
					const height = (value / niceMax) * DASH_PLOT_HEIGHT;
					cursor -= height;
					children.push(react.createElement('rect', {
						key: 'b' + index + bucketKey,
						className: 'dsh-pet-dash-seg is-' + bucketKey + (bar.current ? ' is-current' : ''),
						x,
						y: Math.round(cursor * 10) / 10,
						width: Math.round(barWidth * 10) / 10,
						height: Math.max(Math.round(height * 10) / 10, 0.6),
						rx: bucketIndex === 2 ? 2 : 0,
					},
					react.createElement('title', null, bar.tip)));
				});
			});

			// 4) （均值线已移除：改由上方汇总格里的"均值"卡片表达，
			//     避免横贯虚线与柱顶数值在同一行互相压）

			return react.createElement('div', { className: 'dsh-pet-dash-chart' },
				react.createElement('div', { className: 'dsh-pet-dash-plot' },
					// Y 轴刻度（HTML 文字：不随 SVG 横向拉伸变形；bottom 对齐绘图区）
					react.createElement('div', { className: 'dsh-pet-dash-yaxis', 'aria-hidden': true },
						grid.slice().reverse().map((line) => react.createElement('span', {
							key: 'y' + line.key,
							style: { top: line.y + 'px' },
						}, fmtAxisValue(line.value, metric)))),
					react.createElement('svg', {
						viewBox: '0 0 ' + DASH_VIEW_WIDTH + ' ' + DASH_PLOT_HEIGHT,
						preserveAspectRatio: 'none',
						role: 'img',
						'aria-label': t(metric === 'tokens' ? 'dash.chartAriaTokens' : 'dash.chartAriaCost'),
					}, children),
					// 柱顶数值：底边贴住柱顶（top = 柱顶 y − 行高），所以永远不会压在柱子上；
					// 绘图区顶部留了 8% 顶空，最高那根的标签刚好落进这条留白里。
					bars.map((bar, index) => (labelled.has(index)
						? react.createElement('span', {
							key: 'v' + index,
							className: 'dsh-pet-dash-tip' + (bar.current ? ' is-current' : ''),
							style: {
								left: ((index + 0.5) / bars.length * 100) + '%',
								top: Math.max(0, Math.round((yOf(totals[index]) - DASH_LABEL_LINE) * 10) / 10) + 'px',
							},
						}, fmtBarValue(totals[index], metric))
						: null))),
				react.createElement('div', { className: 'dsh-pet-dash-xaxis', 'aria-hidden': true },
					bars.map((bar, index) => react.createElement('span', {
						key: 'x' + index,
						className: bar.current ? 'is-current' : null,
						title: bar.tip,
					}, axisLabel(bar, index)))),
				react.createElement('div', { className: 'dsh-pet-dash-legend' },
					// 图例只列"这一屏真的出现过"的项：空桶/无高峰就不显示，
					// 免得出现一个屏幕上根本不存在的颜色（用户会以为图坏了）
					present.hit ? react.createElement('span', { className: 'dsh-pet-dash-legend-item' },
						react.createElement('i', { className: 'dsh-pet-dash-dot is-hit' }), t('dash.bucketHit')) : null,
					present.miss ? react.createElement('span', { className: 'dsh-pet-dash-legend-item' },
						react.createElement('i', { className: 'dsh-pet-dash-dot is-miss' }), t('dash.bucketMiss')) : null,
					present.out ? react.createElement('span', { className: 'dsh-pet-dash-legend-item' },
						react.createElement('i', { className: 'dsh-pet-dash-dot is-out' }), t('dash.bucketOut')) : null,
					present.peak ? react.createElement('span', { className: 'dsh-pet-dash-legend-item' },
						react.createElement('i', { className: 'dsh-pet-dash-dot is-band' }), t('dash.peakHours')) : null,
					react.createElement('span', {
						className: 'dsh-pet-dash-legend-note',
					}, t(kind === 'hour'
						? (tokensView ? 'dash.legendHourTokens' : 'dash.legendHour')
						: (tokensView ? 'dash.legendDayTokens' : 'dash.legendDay')))));
		}

		/** 把账本快照的一行转成图表柱（含三桶金额与三桶 token，供堆叠）。 */
		function toBar(row, kind, metric, t) {
			const label = kind === 'hour'
				? String(row.hour).padStart(2, '0') + ':00'
				: row.date.slice(5);
			const hitRate = row.cacheHitPercent === null || row.cacheHitPercent === undefined
				? ''
				: ' · ' + t('dash.hitRate') + ' ' + row.cacheHitPercent + '%';
			const tip = [
				kind === 'hour' ? row.day + ' ' + String(row.hour).padStart(2, '0') + ':00' : row.date,
				t('dash.metricCost') + ' ' + fmtCost(row.costCny) + hitRate,
				fmtTokensCompact(row.tokens.total) + ' tokens',
				t('dash.bucketHit') + ' ' + fmtCost(row.costHitCny) + ' · ' + t('dash.bucketMiss') + ' ' + fmtCost(row.costMissCny) + ' · ' + t('dash.bucketOut') + ' ' + fmtCost(row.costOutCny),
				t('dash.calls', { count: row.calls }),
				row.peak ? t('dash.peakHours') : t('dash.offPeakHours'),
			].join(' · ');
			return {
				label,
				peak: !!row.peak,
				current: !!row.current,
				empty: row.calls === 0,
				tip,
				// 金额三桶（堆叠用）
				hit: row.costHitCny || 0,
				miss: row.costMissCny || 0,
				out: row.costOutCny || 0,
				value: row.costCny,
				// token 三桶（堆叠用）
				hitTokens: row.tokens.cacheRead,
				missTokens: row.tokens.input + row.tokens.cacheWrite,
				outTokens: row.tokens.output,
				valueTokens: row.tokens.total,
			};
		}

		/**
		 * 汇总格里的"缓存命中率"行（宿主已算好 cacheHitPercent；没有就返回空串跳过）。
		 * @param bucket - 快照里的一个桶（totals.today / last24h / window）。
		 */
		function hitRateLine(bucket, t) {
			if (bucket === undefined || bucket === null) return '';
			const percent = bucket.cacheHitPercent;
			if (percent === null || percent === undefined) return '';
			return t('dash.hitRate') + ' ' + percent + '%';
		}

		/**
		 * 看板里的一个汇总格。
		 * @param subs - 补充说明行（数组，逐行渲染；空值自动跳过）。
		 */
		function dashStat(label, value, subs, key) {
			const lines = (Array.isArray(subs) ? subs : [subs]).filter((line) => line !== null && line !== undefined && line !== '');
			return react.createElement('div', { className: 'dsh-pet-dash-stat', key },
				react.createElement('b', null, value),
				react.createElement('span', null, label),
				lines.map((line, index) => react.createElement('em', { key: 's' + index }, line)));
		}
		// ============================================================================
		// 看板布局：拖动移动 + 右下角缩放 + localStorage 记忆（只作用于看板弹窗）
		// ----------------------------------------------------------------------------
		// 模型：
		//   · 默认"锚定在 📊 按钮上方居中"（与官方统计弹层一致）；
		//   · 用户拖走后记住**绝对视口坐标**（不是相对锚点的偏移——偏移会在每次
		//     打开时叠加基准位，导致面板每次重开都往下漂）；
		//   · 窗口 resize 时把坐标夹回视口（幂等，不会漂）；
		//   · 双击头部 = 恢复自动布局（清记忆 + 重新锚定）。
		// 位置/尺寸是纯本地界面偏好，只影响本机浏览器，不写宿主配置。
		//
		// 纯逻辑（归一化/读写/锚定/夹取）放在下面这个**自包含**的
		// createDashboardLayoutStore 工厂里：单测会用 vm 把这段函数体抠出来
		// 单独跑（见 test/dashboard-layout.test.mjs）。这类"存进去的键名和读出来
		// 的不一致"的 bug 只在重新打开时才暴露，塞在组件里几乎测不到。
		// ============================================================================
		/** 判定为"拖动"而非"点击"的位移阈值（px）。 */
		const DRAG_THRESHOLD = 3;

		/**
		 * 看板布局存储工厂（自包含：只用参数，不引用任何外部变量，便于单测抠出）。
		 *
		 * 存储形状 `{ v, x, y, w, h, moved }`：
		 *   v       版本号；读到旧版本整份作废（改默认尺寸/默认位置时必须 +1）
		 *   x/y     用户拖走后的**绝对视口坐标**（不是相对锚点的偏移！）
		 *   w/h     用户改过的尺寸（px）
		 *   moved   用户是否亲手拖过；只有 true 才用 x/y 恢复位置，
		 *           否则每次打开都用默认基准位（视口居中）
		 *
		 * @param options.storage - 兼容 localStorage 的 { getItem, setItem }（可为 null）
		 * @param options.viewport - 返回 `{ width, height }`
		 * @param options.version - 记忆版本号（默认取 DASH_LAYOUT_VERSION）
		 * @param options.defaultWidth / options.defaultHeight - 默认尺寸（px）
		 * @returns 存储实例（read/write/clear/place/dragTo/resizeTo/sizeOf/centerBase/clampPoint）
		 */
		function createDashboardLayoutStore(options) {
			const opts = options || {};
			const key = opts.key === undefined ? 'dsh-whale-pet.dashboard-layout' : opts.key;
			const storage = opts.storage === undefined ? null : opts.storage;
			const VERSION = opts.version === undefined ? DASH_LAYOUT_VERSION : opts.version;
			const DEFAULT_W = opts.defaultWidth === undefined ? DASH_DEFAULT_WIDTH : opts.defaultWidth;
			const DEFAULT_H = opts.defaultHeight === undefined ? DASH_DEFAULT_HEIGHT : opts.defaultHeight;
			const viewport = typeof opts.viewport === 'function'
				? opts.viewport
				: function () { return { width: 1024, height: 768 }; };
			const MARGIN = 8;
			const MIN_W = 300;
			const MIN_H = 200;
			const MAX_W = 1400;
			const MAX_H = 1200;
			const NUMBER_KEYS = ['x', 'y', 'w', 'h'];

			function clampNum(value, min, max) {
				return Math.min(Math.max(value, min), Math.max(min, max));
			}

			/** 归一化：只保留白名单数值 + 布尔 moved；脏数据整体退回 {}。 */
			function normalize(value) {
				if (value === null || typeof value !== 'object') return {};
				const clean = {};
				for (const name of NUMBER_KEYS) {
					const number = Number(value[name]);
					if (Number.isFinite(number)) clean[name] = Math.round(number);
				}
				// 布尔必须按类型判断：Number(true) === 1 会把开关悄悄变成数字
				if (value.moved === true) clean.moved = true;
				return clean;
			}

			/** 读取（坏数据 / 无痕模式 / 版本不符一律 {}）。 */
			function read() {
				if (storage === null || typeof storage.getItem !== 'function') return {};
				try {
					const raw = storage.getItem(key);
					if (raw === null || raw === '') return {};
					const parsed = JSON.parse(raw);
					if (parsed === null || typeof parsed !== 'object') return {};
					// 版本不符 = 这份记忆是按旧的默认尺寸/默认位置存的，整份作废
					if (parsed.v !== VERSION) return {};
					return normalize(parsed);
				} catch (error) {
					return {};
				}
			}

			/** 写入（失败忽略：退化为"本次会话内可拖动"）。总是带上当前版本号。 */
			function write(layout) {
				if (storage === null || typeof storage.setItem !== 'function') return;
				try {
					storage.setItem(key, JSON.stringify(Object.assign({ v: VERSION }, normalize(layout))));
				} catch (error) {
					// 忽略
				}
			}

			/**
			 * 面板尺寸：只有两档——**用户自定义**（记忆里的 w/h）或**默认尺寸**。
			 *
			 * 这里刻意**不把"面板当前渲染尺寸"当兜底**：CSS 里还有一个 520px 的
			 * 自然宽度，一旦拿它当兜底，默认尺寸就永远被 CSS 值盖住（改默认值等于没改），
			 * 而且会把"上一次残留的尺寸"写回记忆。需要按实测尺寸落定的唯一场景是
			 * 双击复位，由 {@link applySize} 显式覆盖。
			 */
			function sizeOf(layout) {
				const current = layout === undefined || layout === null ? {} : layout;
				const view = viewport();
				return {
					width: current.w !== undefined && current.w > 0
						? current.w
						: Math.min(DEFAULT_W, Math.max(MIN_W, view.width - 24)),
					height: current.h !== undefined && current.h > 0
						? current.h
						: Math.min(DEFAULT_H, Math.max(MIN_H, view.height - 24)),
				};
			}

			/**
			 * 用一份尺寸覆盖布局里的 w/h（双击复位：按面板"内容自然尺寸"落定，
			 * 这样复位后的高度正好贴合内容，不会留一大片空白或出滚动条）。
			 * @param layout - 布局记录。
			 * @param size - 实测尺寸 `{ w, h }`；不合法时原样返回布局。
			 */
			function applySize(layout, size) {
				const current = normalize(layout);
				if (size === undefined || size === null || !(size.w > 0) || !(size.h > 0)) return current;
				return Object.assign({}, current, { w: Math.round(size.w), h: Math.round(size.h) });
			}

			/** 把坐标夹进视口（幂等：重复调用结果不变）。 */
			function clampPoint(x, y, size) {
				const view = viewport();
				return {
					x: Math.round(clampNum(x, MARGIN, view.width - size.width - MARGIN)),
					y: Math.round(clampNum(y, MARGIN, view.height - size.height - MARGIN)),
				};
			}

			/**
			 * 默认基准位：**视口居中**（不再贴着 📊 按钮）。
			 * 夹取只是防止面板比视口还大时溢出。
			 */
			function centerBase(size) {
				const view = viewport();
				return clampPoint((view.width - size.width) / 2, (view.height - size.height) / 2, size);
			}

			/**
			 * 落定本次打开的位置：
			 *   拖过 → 用记忆的绝对坐标（只夹回视口，幂等）；
			 *   没拖过 → **视口居中**（默认位置）。
			 * @returns 下一份布局。
			 */
			function place(layout, sizeOverride) {
				const current = applySize(layout, sizeOverride);
				const size = sizeOf(current);
				const useSaved = current.moved === true && current.x !== undefined && current.y !== undefined;
				const base = useSaved ? { x: current.x, y: current.y } : centerBase(size);
				const point = clampPoint(base.x, base.y, size);
				return Object.assign({}, current, point, { w: Math.round(size.width), h: Math.round(size.height) });
			}

			/** 拖动落点：位移叠加在当前坐标上（不是叠加基准位，避免逐次漂移）。 */
			function dragTo(layout, origin, delta) {
				const current = normalize(layout);
				const size = sizeOf(current);
				const point = clampPoint(origin.x + delta.dx, origin.y + delta.dy, size);
				return Object.assign({}, current, point, {
					w: Math.round(size.width),
					h: Math.round(size.height),
					moved: true,
				});
			}

			/** 缩放到目标尺寸：夹在 [MIN, MAX] 与视口剩余空间之内。 */
			function resizeTo(layout, target) {
				const current = normalize(layout);
				const view = viewport();
				const originX = current.x === undefined ? MARGIN : current.x;
				const originY = current.y === undefined ? MARGIN : current.y;
				const maxW = Math.max(MIN_W, Math.min(MAX_W, view.width - MARGIN - originX));
				const maxH = Math.max(MIN_H, Math.min(MAX_H, view.height - MARGIN - originY));
				return Object.assign({}, current, {
					w: Math.round(clampNum(target.w, MIN_W, maxW)),
					h: Math.round(clampNum(target.h, MIN_H, maxH)),
				});
			}

			return {
				key: key,
				read: read,
				write: write,
				clear: function () { write({}); },
				sizeOf: sizeOf,
				applySize: applySize,
				clampPoint: clampPoint,
				centerBase: centerBase,
				place: place,
				dragTo: dragTo,
				resizeTo: resizeTo,
			};
		}


		/**
		 * 看板的位置与尺寸权威：返回要合并进面板 style 的字段 + pointer 处理器。
		 *
		 * 默认位置 = **视口居中**；默认尺寸 = `DASH_DEFAULT_WIDTH/HEIGHT`（视口小则收窄）。
		 * 用户拖过之后才用记忆坐标；双击头部复位回默认。
		 *
		 * @param open - 面板是否打开。
		 * @param buttonRef - 📊 按钮的 DOM ref（点击外部关闭的判定要用它）。
		 * @param panelRef - 面板元素（量尺寸用）。
		 */
		function useDashboardLayout(open, buttonRef, panelRef) {
			const [layout, setLayout] = useState(() => layoutStore(buttonRef).read());
			const layoutRef = useRef(layout);
			const [dragging, setDragging] = useState(false);
			const [placed, setPlaced] = useState(false);
			layoutRef.current = layout;

			/** 取布局存储（默认尺寸/默认位置都在 store 内部，与页面无关）。 */
			function layoutStore() {
				return createDashboardLayoutStore({
					storage: typeof window === 'undefined' ? null : window.localStorage,
					viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
				});
			}

			const apply = (next) => {
				layoutRef.current = next;
				setLayout(next);
			};

			/**
			 * 落定本次打开的位置（记忆过就走记忆，否则重新锚定）。
			 * @param frozenSize - 显式尺寸（重置时用：此时面板还带着旧的自定义尺寸，
			 *   不能拿它当"实测"，否则会把刚清掉的尺寸又写回记忆）。
			 */
			/**
			 * 落定本次打开的位置与尺寸。
			 * @param sizeOverride - 仅双击复位时传：用面板"内容自然尺寸"覆盖宽高。
			 *   其余情况一律走 `sizeOf`（自定义尺寸 or 默认尺寸），
			 *   **绝不**拿 DOM 上的当前尺寸当依据——那会让默认值永远失效。
			 */
			const place = (sizeOverride) => {
				apply(layoutStore(buttonRef).place(layoutRef.current, sizeOverride));
				setPlaced(true);
			};

			/** 合并进面板 style：位置、尺寸、以及"未定位前先隐藏"（避免 (0,0) 闪一帧）。 */
			const style = {};
			if (!placed) style.visibility = 'hidden';
			if (layout.x !== undefined) style.left = layout.x + 'px';
			if (layout.y !== undefined) style.top = layout.y + 'px';
			if (layout.w !== undefined) style.width = layout.w + 'px';
			if (layout.h !== undefined) {
				style.height = layout.h + 'px';
				style.overflowY = 'auto';
			}

			/** 拖动：位移叠加在当前绝对坐标上，落盘 moved:true。 */
			const onHeaderPointerDown = (event) => {
				if (event.button !== undefined && event.button !== 0) return;
				if (panelRef.current === null) return;
				const store = layoutStore(buttonRef);
				const current = layoutRef.current;
				// 起手尺寸 = 当前布局尺寸（自定义优先，否则默认尺寸；不拿 CSS 自然宽度兜底）
				const size = store.sizeOf(current);
				// 起手位置：拖过就用当前坐标，没拖过就用默认基准位（视口居中）
				const origin = current.moved === true && current.x !== undefined && current.y !== undefined
					? { x: current.x, y: current.y }
					: store.centerBase(size);
				const start = { x: event.clientX, y: event.clientY };
				let moved = false;

				const move = (moveEvent) => {
					if (!moved && Math.abs(moveEvent.clientX - start.x) < DRAG_THRESHOLD
						&& Math.abs(moveEvent.clientY - start.y) < DRAG_THRESHOLD) return;
					moved = true;
					setDragging(true);
					apply(store.dragTo(layoutRef.current, origin, {
						dx: moveEvent.clientX - start.x,
						dy: moveEvent.clientY - start.y,
					}));
				};
				const up = () => {
					window.removeEventListener('pointermove', move);
					window.removeEventListener('pointerup', up);
					window.removeEventListener('pointercancel', up);
					setDragging(false);
					// 只有真的拖过才落盘，避免"点一下头部"变成写偏好
					if (moved) store.write(layoutRef.current);
				};
				window.addEventListener('pointermove', move);
				window.addEventListener('pointerup', up);
				window.addEventListener('pointercancel', up);
			};

			/** 右下角缩放：从当前尺寸起算，夹进 [最小, 最大] 与视口剩余空间。 */
			const onResizePointerDown = (event) => {
				if (event.button !== undefined && event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				if (panelRef.current === null) return;
				const store = layoutStore(buttonRef);
				// 起点尺寸 = 当前布局尺寸（自定义优先，否则默认尺寸；与拖动同一口径）
				const startSize = store.sizeOf(layoutRef.current);
				const start = { x: event.clientX, y: event.clientY };
				apply(store.resizeTo(layoutRef.current, startSize));
				setDragging(true);

				const move = (moveEvent) => {
					apply(store.resizeTo(layoutRef.current, {
						w: startSize.width + (moveEvent.clientX - start.x),
						h: startSize.height + (moveEvent.clientY - start.y),
					}));
				};
				const up = () => {
					window.removeEventListener('pointermove', move);
					window.removeEventListener('pointerup', up);
					window.removeEventListener('pointercancel', up);
					setDragging(false);
					store.write(layoutRef.current);
				};
				window.addEventListener('pointermove', move);
				window.addEventListener('pointerup', up);
				window.addEventListener('pointercancel', up);
			};

			/**
			 * 双击头部：清掉记忆并回到**默认尺寸 + 视口居中**。
			 *
			 * 两个坑都要避开：
			 *   1) 不能量面板当前尺寸去落定——那会把"当前渲染尺寸"（CSS 自然宽或上次拖
			 *      出来的尺寸）当成复位目标，复位后既不是默认尺寸又可能残留旧值；
			 *   2) 不能只调 `place()`——place 的位置来源是 `layoutRef.current`，
			 *      而那个 ref 里还带着旧的 moved/x/y，于是"清了记忆但位置没动"。
			 * 所以必须**先**把内存里的布局也清掉，再落定。
			 */
			const clearLayout = () => {
				layoutStore(buttonRef).clear();
				apply({});        // 内存状态 → 空布局（默认尺寸 + 视口居中）
				place(undefined); // 立刻按空布局重算位置与尺寸
			};

			// 打开：绘制前落定位置（默认尺寸/记忆尺寸）；窗口 resize 时把坐标夹回视口（幂等）
			useLayoutEffect(() => {
				if (!open) {
					setPlaced(false);
					return undefined;
				}
				place();
				const onResize = () => {
					// 只重算位置（夹回视口）与尺寸档位，不拿当前渲染尺寸当依据，
					// 否则窗口一变化就会把当时的尺寸锁进记忆、默认尺寸从此失效
					apply(layoutStore(buttonRef).place(layoutRef.current));
				};
				window.addEventListener('resize', onResize);
				return () => { window.removeEventListener('resize', onResize); };
			}, [open]);

			// 尺寸被用户改过之后，位置也要跟着夹一次（缩放可能把面板推出视口）
			useLayoutEffect(() => {
				if (!open || !placed) return;
				const current = layoutRef.current;
				if (current.x === undefined || current.y === undefined) return;
				const store = layoutStore(buttonRef);
				const point = store.clampPoint(current.x, current.y, store.sizeOf(current));
				if (point.x !== current.x || point.y !== current.y) apply(Object.assign({}, current, point));
			}, [layout.w, layout.h, open, placed]);

			return {
				style,
				dragging,
				onHeaderPointerDown,
				onResizePointerDown,
				clearLayout,
			};
		}
/** 读取一次看板数据；卸载/重新请求时中断上一次。 */
		function useDashboardData(open, refreshToken) {
			const [state, setState] = useState({ loading: true, error: null, data: null });
			useEffect(() => {
				if (!open) return undefined;
				let alive = true;
				const controller = new AbortController();
				setState((prev) => ({ loading: true, error: null, data: prev.data }));
				fetch(DASH_API, { signal: controller.signal })
					.then((res) => {
						if (!res.ok) throw new Error('HTTP ' + res.status);
						return res.json();
					})
					.then((data) => {
						if (!alive) return;
						if (!data || data.ok !== true) throw new Error((data && data.error) || 'bad payload');
						setState({ loading: false, error: null, data });
					})
					.catch((error) => {
						if (!alive || (error && error.name === 'AbortError')) return;
						setState({ loading: false, error: String(error && error.message ? error.message : error), data: null });
					});
				return () => { alive = false; controller.abort(); };
			}, [open, refreshToken]);
			return state;
		}

		/**
		 * 看板渲染错误围栏：看板出问题时**只**让面板显示错误文本，
		 * 绝不把异常抛到桌宠（否则整个 shell.overlay 条目会被框架卸载，
		 * 桌宠直接消失——这是 pack 第三方插件最容易踩的坑）。
		 */
		class DashboardBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			render() {
				if (this.state.error !== null) {
					return react.createElement('div', { className: 'dsh-pet-dash-error' },
						'看板渲染出错：' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error));
				}
				return this.props.children;
			}
		}

		/**
		 * 分时段花费弹窗：汇总 + 分时/日趋势切换 + 花费/token 切换 + 柱状图 + 口径说明。
		 * 优先 portal 到 body（避免被宠物容器裁切）；拿不到可用容器时退回内联渲染。
		 */
		function DashboardModal(props) {
			return react.createElement(DashboardBoundary, null,
				react.createElement(DashboardPanel, props));
		}

		function DashboardPanel(props) {
			const t = props.t;
			const [metric, setMetric] = useState('cost');
			const [tab, setTab] = useState('hour');
			const [refreshToken, setRefreshToken] = useState(0);
			const { data, loading, error } = useDashboardData(props.open, refreshToken);

			if (!props.open) return null;

			const days = (data && data.windowDays) || 7;
			const scan = (data && data.scan) || null;
			const totals = (data && data.totals) || null;
			const hourly = tab === 'hour';
			// 分时图只看"今天"这一天的 24 小时（跨日的尾巴交给日趋势看）；日趋势图看全部 windowDays 天。
			// 说明：宿主快照里小时行的日期字段叫 `day`，日趋势行才叫 `date`。
			// 这些派生值必须算在下面的 return 之前；对畸形载荷也做兜底（空数组而非崩溃）。
			const list = (value) => (Array.isArray(value) ? value : []);
			const dayRows = list(data && data.days);
			const todayKey = dayRows.length > 0 ? dayRows[dayRows.length - 1].date : null;
			const rows = !data
				? []
				: hourly
					? list(data.hours).filter((row) => row.day === todayKey)
					: dayRows;
			const visibleBars = rows.map((row) => toBar(row, hourly ? 'hour' : 'day', metric, t));

			/**
			 * 当前视图的**均值**（每个时段平均花多少 / 多少 token）。
			 * 从图里挪到汇总格的依据：横贯虚线的平均线会和柱顶数值互相压，
			 * 而"平均每小时 ¥x"本身就是一个数字，放卡片里更好读。
			 */
			const avg = (() => {
				if (!data || rows.length === 0) return null;
				let cost = 0;
				let tokens = 0;
				for (const row of rows) {
					cost += Number(row.costCny) || 0;
					tokens += Number(row.tokens && row.tokens.total) || 0;
				}
				return { cost: cost / rows.length, tokens: tokens / rows.length, count: rows.length };
			})();

			// 布局：本 hook 是看板位置/尺寸的唯一来源（默认锚定在 📊 按钮上方，
			// 用户可拖动/缩放并被记忆；未定位完成前先隐藏，避免在 (0,0) 闪一帧）
			const layout = useDashboardLayout(props.open, props.buttonRef, props.panelRef);
			const panelStyle = Object.assign({}, layout.style);
			// portal 到 body（BODY 元素是合法容器）；容器不可用时退回内联渲染
			// （面板是 position:fixed，位置由 pos 决定，内联也能正确定位）
			const container = portalContainer();
			return container === null
				? renderPanel()
				: createPortal(renderPanel(), container);

			/** 面板本体（portal 与内联两条路径共用同一棵树）。 */
			function renderPanel() {
				return react.createElement('div', {
					ref: props.panelRef,
					className: 'dsh-pet-dash-panel' + (layout.dragging ? ' is-dragging' : ''),
					role: 'dialog',
					'aria-label': t('dash.title'),
					style: panelStyle,
				},
				react.createElement('div', {
					className: 'dsh-pet-dash-head',
					onPointerDown: layout.onHeaderPointerDown,
					onDoubleClick: layout.clearLayout,
					title: t('dash.dragHint'),
				},
					react.createElement('span', { className: 'dsh-pet-dash-title-label' },
						react.createElement(ChartIcon), t('dash.title')),
					react.createElement('div', { className: 'dsh-pet-dash-tools' },
						// 花费 / token 切换
						react.createElement('div', { className: 'dsh-pet-dash-seg' },
							['cost', 'tokens'].map((value) => react.createElement('button', {
								key: value,
								type: 'button',
								'data-on': metric === value,
								onClick: () => setMetric(value),
							}, value === 'cost' ? t('dash.metricCost') : t('dash.metricTokens')))),
						// 分时 / 日趋势切换
						react.createElement('div', { className: 'dsh-pet-dash-seg' },
							[['hour', t('dash.tabHourly')], ['day', t('dash.tabDaily', { days })]].map(([value, label]) =>
								react.createElement('button', {
									key: value,
									type: 'button',
									'data-on': tab === value,
									onClick: () => setTab(value),
								}, label))),
						react.createElement('button', {
							type: 'button',
							className: 'dsh-pet-dash-refresh',
							title: t('dash.refresh'),
							onClick: () => setRefreshToken((n) => n + 1),
						}, '⟳'))),

				error
					? react.createElement('div', { className: 'dsh-pet-dash-error' }, t('dash.error', { error }))
					: null,
				!data && loading ? react.createElement('div', { className: 'dsh-pet-dash-meta' }, t('dash.loading')) : null,
				data ? react.createElement('div', { className: 'dsh-pet-dash-stats' },
					dashStat(hourly ? t('dash.last24h') : t('dash.window', { days }),
						fmtCost(hourly ? totals.last24h.costCny : totals.window.costCny),
						[
							fmtTokensCompact(hourly ? totals.last24h.tokens.total : totals.window.tokens.total) + ' tokens',
							hitRateLine(hourly ? totals.last24h : totals.window, t),
						],
						'a'),
					dashStat(t('dash.today'), fmtCost(totals.today.costCny),
						[
							fmtTokensCompact(totals.today.tokens.total) + ' tokens',
							t('dash.calls', { count: totals.today.calls }),
						], 'b'),
					// 均值卡：原图里的平均线搬到这里；金额与 token 同时给
					avg === null ? null : dashStat(
						t(hourly ? 'dash.avgHour' : 'dash.avgDay', { count: avg.count }),
						fmtCost(avg.cost),
						[fmtTokensCompact(avg.tokens) + ' tokens', t('dash.avgHint')],
						'avg'),
					dashStat(t('dash.tokensIn'), fmtTokensCompact(totals.today.tokens.inputTotal),
						t('dash.cacheRead') + ' ' + fmtTokensCompact(totals.today.tokens.cacheRead), 'c'),
					dashStat(t('dash.tokensOut'), fmtTokensCompact(totals.today.tokens.output),
						t('dash.costOut') + ' ' + fmtCost(totals.today.costOutCny), 'd')) : null,
				data ? react.createElement(BarChart, { bars: visibleBars, metric, kind: hourly ? 'hour' : 'day', t }) : null,
				data ? react.createElement('div', { className: 'dsh-pet-dash-meta' },
					scan && scan.status === 'running' ? t('dash.scanRunning')
						: scan && scan.status === 'done' ? t('dash.scanDone', { sessions: scan.sessions, events: fmtInt(scan.events) })
							: scan && scan.status === 'unavailable' ? t('dash.scanUnavailable')
								: scan && scan.status === 'failed' ? t('dash.scanFailed', { failed: scan.failed })
									: t('dash.loading')) : null,
				react.createElement('div', { className: 'dsh-pet-dash-note' }, t('dash.note')),
				// 右下角缩放手柄（只改宽高，不影响内容）
				react.createElement('div', {
					className: 'dsh-pet-dash-resize',
					title: t('dash.resizeHint'),
					'aria-hidden': true,
					onPointerDown: layout.onResizePointerDown,
				}));
			}
		}

		/** 宠物侧边的「数据看板」按钮（forwardRef 以便把 ref 落到真正的 <button> 上）。 */
		const DashboardButton = react.forwardRef(function DashboardButton(props, ref) {
			return react.createElement(IconButton, {
				icon: '📊',
				title: props.t ? props.t('dash.button') : '数据看板',
				loading: false,
				onClick: props.onClick,
				buttonRef: ref,
			});
		});

		// ============================================================================
		// Pet 组件 —— 宠物本体
		// ============================================================================
		/**
		 * 核心组件。职责：
		 * 1. 渲染"双缓冲"的一对 <video>（A/B 交替显示），切换动画时交叉淡入，永无空白帧
		 * 2. 状态机：待机 →（定时器随机）→ 转向/移动/动作；点击/拖拽可打断
		 * 3. 朝向（facing）渲染：right 时 CSS 镜像
		 *
		 * 参数 config：来自 patch 配置。当前 DSH 客户端配置管线尚未打通，
		 * 实际收到的是空对象，所以下面全部用 || 默认值兜底。
		 */
		function Pet({ config }) {
			// ---- 从 config 读取参数（当前走默认值） ----
			const size = (config && config.size) || 260;             // 显示尺寸（px）
			const corner = (config && config.position) || 'bottom-right'; // 默认角落

			// ---- React 状态 ----
			const [anim, setAnim] = useState(IDLE);   // 当前动画名
			const [once, setOnce] = useState(true);   // 是否一次性播放——链式模型全部一次性
			const [facing, setFacing] = useState('left'); // 朝向：left | right
			const [dragging, setDragging] = useState(false); // 是否正在拖拽
			// 自定义位置（拖拽/移动后宠物停留的视口坐标）；null = 回到默认角落
			const [customPos, setCustomPos] = useState(null);
			// 播放序号：每次切换 +1。即使连续选中同一个动画（如待机播完又选待机），
			// seq 变化也能保证 switchTo 重新执行、视频重新播放（否则 anim 没变 React 不重渲染）。
			const [seq, setSeq] = useState(0);
			// 本 fork 新增：任务通知气泡 / 工作打字气泡 / 忙碌标记
			const [bubble, setBubble] = useState(null); // { title, message, ok } | null
			const [typing, setTyping] = useState(null); // 打字气泡当前文本
			const [sleeping, setSleeping] = useState(false); // 是否处于睡眠态
			const busyRef = useRef(false);              // Agent 是否正在工作
			const bubbleTimerRef = useRef(null);        // 气泡自动消失定时器
			const typingTimerRef = useRef(null);        // 打字机 interval
			const typingRef = useRef(null);             // 打字状态 { lineIdx, charIdx, line }
			/** 当前工具名（打字气泡展示） */
			const activityRef = useRef('');
			const workingAvailRef = useRef(null);       // 已探测存在的工作动画池（null=未探测）
			const workingTimerRef = useRef(null);       // 工作轮播切换定时器
			const sleepRef = useRef(false);             // 是否处于睡眠态（镜像）
			const lastActivityAtRef = useRef(Date.now()); // 最近一次活动时间戳
			const timeAnimAtRef = useRef(0);            // 上次时间感知动画的时间戳
			const lunchDoneRef = useRef('');            // 已吃过午饭的日期（YYYY-M-D）
			const [weatherLoading, setWeatherLoading] = useState(false); // 天气按钮加载中
			const feedAtRef = useRef(0);                // 喂食冷却时间戳
			// 本 fork 新增：气泡看板（分时段花费）开合状态 + 按钮/面板引用。
			// 位置与尺寸由 useDashboardLayout 统一负责（可拖动/缩放/记忆）；
			// "点击外部 / Esc 关闭"复用费用 pill 的 useCostDismiss。
			// 注意：拒绝外部点击的判定用"按钮 + 面板"，所以这里必须拿到真实 <button>，
			// 不能用 display:contents 的包裹元素（它没有盒子，也拦不住外部判定）。
			const [dashOpen, setDashOpen] = useState(false);
			const dashButtonRef = useRef(null);
			const dashPanelRef = useRef(null);
			useCostDismiss(dashOpen, setDashOpen, dashButtonRef, dashPanelRef);
			// ---- DOM 引用 ----
			const rootRef = useRef(null);  // 根容器（fixed 定位）
			const stageRef = useRef(null); // 内部舞台（落地对齐）
			const videoARef = useRef(null); // 视频 A
			const videoBRef = useRef(null); // 视频 B
			// ---- 双缓冲/竞态相关 ref ----
			const frontRef = useRef(0);  // 当前显示的是哪个视频：0=A, 1=B
			const pendingRef = useRef(null); // 正在加载中的 {anim, once, gen}
			const genRef = useRef(0);    // 切换代数：每次切换 +1，用于识别"过期回调"
			// ---- 交互相关 ref ----
			const dragRef = useRef({ active: false, dragging: false, sx: 0, sy: 0 }); // 拖拽状态
			const justDraggedRef = useRef(false); // 刚拖拽完（用于抑制拖拽后的误点击）
			const animRef = useRef(IDLE); // 动画名镜像（供异步回调读当前值）
			animRef.current = anim;

			// ============================================================================
			// 双缓冲切换（switchTo）—— 核心播放逻辑
			// ============================================================================
			// 思路：两个 video 层叠。切换动画时：
			//   1. 把目标动画 src 设到"非当前显示"的那个 video 上
			//   2. 等它 loadeddata（数据加载完成）
			//   3. 新 video 淡入（加 is-front），旧 video 淡出（去 is-front）
			//   4. frontRef 翻转，下次切换用另一个
			// 这样切换时旧画面一直显示到新画面就绪，永远不会闪空白。
			//
			// 竞态防护（重要）：快速连点/连续切换时，可能前一个动画还没加载完
			// 就又要切下一个。每个切换有一个递增的"代数" gen，loadeddata 回调
			// 执行时检查自己是否还是最新代——不是就放弃（避免两个 video 都被
			// 移除 is-front 而全部透明、宠物消失）。
			const switchTo = (next, nextOnce) => {
				// 如果目标动画已经在加载中，直接跳过（避免重复加载）
				const pending = pendingRef.current;
				if (pending && pending.anim === next && pending.once === nextOnce) return;
				const gen = ++genRef.current; // 本次切换的代数
				pendingRef.current = { anim: next, once: nextOnce, gen };

				// 本 fork 修复：切换一开始就清掉旧视频的 onended——
				// 否则旧动画播完会触发 handleEnded 把状态机拉回随机链，
				// 打断"工作循环"（原地敲击桌面互动）。
				const oldElNow = frontRef.current === 0 ? videoARef.current : videoBRef.current;
				if (oldElNow) oldElNow.onended = undefined;

				// 目标 video = 当前"非显示"的那个（front 是 A 就用 B，反之用 A）
				const target = frontRef.current === 0 ? videoBRef : videoARef;
				const el = target.current;
				if (!el) return;
				// 设置视频属性并开始加载
				el.src = '/pet/thumb/' + encodeURIComponent(next) + '.webm';
				el.loop = !nextOnce;           // 一次性动画不循环
				el.muted = true;               // 静音（动画无声音）
				el.autoplay = true;            // 自动播放
				el.playsInline = true;         // 行内播放（移动端不弹全屏）
				el.onended = nextOnce ? handleEnded : undefined; // 一次性动画播完 → 回待机
				el.load();

				// 数据加载完成后的回调
				const onReady = () => {
					el.removeEventListener('loadeddata', onReady);
					// 过期检查：如果期间又有更新的切换，本回调作废
					if (pendingRef.current?.gen !== gen) return;
					// 交换前后台：新 video 加 is-front（淡入），旧 video 移除（淡出）
					const old = frontRef.current === 0 ? videoARef : videoBRef;
					el.classList.add('is-front');
					// old !== el 守卫：防止把自己刚加的 is-front 又移除
					if (old.current && old.current !== el) {
						old.current.classList.remove('is-front');
						old.current.pause(); // 本 fork：停掉旧视频，避免后台空转
					}
					frontRef.current = frontRef.current === 0 ? 1 : 0;
					pendingRef.current = null;
					el.play().catch(() => {}); // 开始播放（捕获自动播放策略异常）
					// 如果这是"计划中的移动"的动画，现在动画就绪了，
					// 开始驱动位置移动（见 startMoveDrive）
					if (pendingMoveRef.current) startMoveDrive(el);
				};
				el.addEventListener('loadeddata', onReady);
				// 如果视频已缓存就绪（readyState>=2），立即触发回调
				if (el.readyState >= 2) onReady();
			};

			// ============================================================================
			// 随机事件定时器 —— 待机时的"自主行为"
			// ---- 状态驱动播放：anim/once/seq 一变就切换视频 ----
			// seq 参与依赖：即使 anim/once 没变（连续选中同一动画），seq 变化也强制重播。
			useEffect(() => {
				switchTo(anim, once);
			}, [anim, once, seq]);

			// ---- 组件卸载时清理移动 rAF ----
			useEffect(() => () => { stopMove(); }, []);

			// ---- 窗口尺寸变化：重算比例位置（触发重渲染，宠物保持相对窗口位置） ----
			useEffect(() => {
				const onResize = () => {
					// 有自定义位置时，用同值 setCustomPos 触发重渲染；
					// 渲染逻辑会用新窗口尺寸 × 比例重算坐标。
					setCustomPos((prev) => (prev ? { ...prev } : prev));
				};
				window.addEventListener('resize', onResize);
				return () => window.removeEventListener('resize', onResize);
			}, []);

			// ============================================================================
			// 本 fork 新增：任务状态镜像（轮询宿主 /api/whale-pet/state）
			// ============================================================================
			const showBubble = (b) => {
				setBubble(b);
				if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
				bubbleTimerRef.current = setTimeout(() => setBubble(null), 8000);
			};

			const stopTyping = () => {
				if (typingTimerRef.current) {
					clearInterval(typingTimerRef.current);
					typingTimerRef.current = null;
				}
				typingRef.current = null;
				setTyping(null);
			};

			// 打字机气泡：工作中逐字打出当前在做什么
			const startTyping = () => {
				if (typingRef.current) return;
				const st = { lineIdx: 0, charIdx: 0, line: null };
				typingRef.current = st;
				const step = () => {
					const cur = typingRef.current;
					if (!cur) return;
					if (cur.line === null) {
						const act = activityRef.current;
						const pool = act
							? ['正在调用「' + act + '」…', 'def 努力干活():', '哒哒哒哒哒……', '快好啦快好啦…']
							: ['def 努力干活():', '哒哒哒哒哒……', '这段逻辑再想想…', '快好啦快好啦…'];
						cur.line = pool[cur.lineIdx % pool.length];
					}
					if (cur.charIdx < cur.line.length) {
						cur.charIdx += 1;
						setTyping({ text: cur.line.slice(0, cur.charIdx) });
					} else {
						cur.lineIdx += 1;
						cur.charIdx = 0;
						cur.line = null;
						setTyping({ text: '' });
					}
				};
				step();
				typingTimerRef.current = setInterval(step, 90);
			};

			// 探测工作动画池中真实存在的动画（HEAD 探测一次，缺失项自动剔除）
			const ensureWorkingPool = async () => {
				if (workingAvailRef.current !== null) return workingAvailRef.current;
				const results = await Promise.all(WORKING_POOL.map((n) =>
					fetch('/pet/thumb/' + encodeURIComponent(n) + '.webm', { method: 'HEAD' })
						.then((r) => (r.ok ? n : null))
						.catch(() => null)));
				const pool = results.filter(Boolean);
				workingAvailRef.current = pool.length > 0 ? pool : [WORKING];
				return workingAvailRef.current;
			};

			// 工作轮播：随机选一段坐姿工作动画循环播放，~10.5 秒后切下一段（尽量避开重复）
			const playWorking = async () => {
				if (workingTimerRef.current) clearTimeout(workingTimerRef.current);
				const pool = await ensureWorkingPool();
				const prev = animRef.current;
				const candidates = pool.length > 1 ? pool.filter((n) => n !== prev) : pool;
				const next = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : pool[0];
				setAnim(next);
				setOnce(false); // 循环播放
				setSeq((s) => s + 1);
				workingTimerRef.current = setTimeout(() => {
					if (busyRef.current) playWorking();
				}, 10500);
			};

			// 工作开始（工作三态第一态）：先播「开始工作」（站→坐，一次），
			// 播完 handleEnded 自动进入工作中轮播
			const startWork = () => {
				if (workingTimerRef.current) clearTimeout(workingTimerRef.current);
				busyRef.current = true;
				setAnim(WORK_START);
				setOnce(true);
				setSeq((s) => s + 1);
			};

			// 按钮触发的动作动画（看天气 / 翻钱包 等）：打断当前动画播一次
			const playAction = (name) => {
				markActivity();
				resetSleep();
				stopMove();
				setOnce(true);
				setAnim(name);
				setSeq((s) => s + 1);
			};

			// ---- 睡眠三连 ----
			const resetSleep = () => {
				sleepRef.current = false;
				setSleeping(false);
			};

			const wakeUp = () => {
				resetSleep();
				setAnim(SLEEP_WAKE);
				setOnce(true);
				setSeq((s) => s + 1);
			};

			const enterSleep = () => {
				sleepRef.current = true;
				setSleeping(true);
				stopMove(); // 别睡在路中间
				setAnim(SLEEP_IN);
				setOnce(true);
				setSeq((s) => s + 1);
			};

			const markActivity = () => {
				lastActivityAtRef.current = Date.now();
			};

			// 工作/空闲状态：工作 → 轮播池循环；空闲 → 回到待机链
			const applyMood = (mood) => {
				if (mood === 'working') {
					if (!busyRef.current) {
						busyRef.current = true;
						startTyping();
						if (sleepRef.current) {
							wakeUp(); // 睡梦中来活：先播叫醒动画，播完自动进「开始工作」
						} else {
							startWork(); // 工作三态第一态：开始工作（站→坐）
						}
					}
				} else if (mood === 'idle') {
					busyRef.current = false;
					markActivity(); // 任务结束：睡眠计时从此刻重新开始
					stopTyping();
					if (workingTimerRef.current) clearTimeout(workingTimerRef.current);
					setAnim(IDLE);
					setOnce(true);
					setSeq((s) => s + 1);
				}
			};

			// 任务完成/失败通知：庆祝/气急败坏动画 + 气泡
			const playNotice = (ok, item) => {
				markActivity();
				resetSleep(); // 有任务事件：先脱离睡眠
				let animName;
				if (item && item.title === '还没完呢…') animName = '长时间工作看表'; // 长任务提醒：站在电脑前看表叹气
				else if (ok && item && item.title === '任务完成啦！') animName = WORK_END; // 工作三态第三态：工作结束庆祝
				else animName = pick(ok ? NOTICE_DONE : NOTICE_FAIL, animRef.current);
				setAnim(animName);
				setOnce(true);
				setSeq((s) => s + 1);
				// 多行信息（用时/消耗/花费）→ 左对齐排版
				showBubble({ title: item.title, message: item.message, ok: !!ok, lines: !!(item.message && item.message.indexOf('\n') >= 0) });
			};

			useEffect(() => {
				let alive = true;
				const poll = async () => {
					try {
						const res = await fetch(STATE_API);
						if (!alive || !res.ok) return;
						const data = await res.json();
						const items = Array.isArray(data) ? data : (data && data.items) || [];
						if (data && data.settings) settingsRef.current = data.settings;
						if (items.length === 0) return;
						for (const item of items) {
							if (!item) continue;
							if (item.type === 'mood') applyMood(item.mood);
							else if (item.type === 'activity') activityRef.current = typeof item.name === 'string' ? item.name : '';
							else if (item.type === 'done') playNotice(item.ok, item);
						}
					} catch {
						// 网络波动忽略，下个周期重试
					}
				};
				poll();
				const timer = setInterval(poll, 800);
				return () => {
					alive = false;
					clearInterval(timer);
					stopTyping();
					if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
					if (workingTimerRef.current) clearTimeout(workingTimerRef.current);
				};
			}, []);

			// ============================================================================
			// 本 fork 新增：番茄钟 / 深夜关怀 / 随机小剧场（每 60 秒检查一次）
			// ============================================================================
			const settingsRef = useRef({});
			const pomoAtRef = useRef(Date.now());
			const lateNightAtRef = useRef(Date.now());
			const chatterAtRef = useRef(Date.now());
			const chatterNextRef = useRef(120000 + Math.random() * 240000);
			useEffect(() => {
				const tick = () => {
					const s = settingsRef.current || {};
					const now = Date.now();
					const hour = new Date().getHours();
					// 番茄钟：每 N 分钟提醒休息（可在设置面板调）
					if (s.pomodoro !== false) {
						const mins = Number(s.pomodoroMinutes) || 25;
						if (now - pomoAtRef.current >= mins * 60000) {
							pomoAtRef.current = now;
							showBubble({ title: '休息一下', message: '已经坐了很久啦，起来喝口水吧～', ok: true });
						}
					}
					// 深夜关怀：23:00-05:00 每 20 分钟提醒一次
					if (s.lateNight !== false && (hour >= 23 || hour < 5)) {
						if (now - lateNightAtRef.current >= 20 * 60000) {
							lateNightAtRef.current = now;
							showBubble({ title: '深夜啦', message: '夜深了，早点休息哦～', ok: true });
						}
					}
					// 随机小剧场：空闲且清醒时每 2~6 分钟随机冒一句（睡觉时不打扰）
					if (s.chatter !== false && !busyRef.current && !sleepRef.current && now - chatterAtRef.current >= chatterNextRef.current) {
						chatterAtRef.current = now;
						chatterNextRef.current = 120000 + Math.random() * 240000;
						showBubble({ title: '', message: CHATTER[Math.floor(Math.random() * CHATTER.length)], ok: true });
					}
					// 长时间无动作（无任务、无互动）：进入睡眠三连
					if (!busyRef.current && !sleepRef.current && now - lastActivityAtRef.current >= SLEEP_IDLE_MS) {
						enterSleep();
					}
					// 时间感知动画（清醒、空闲、非拖拽，且过了冷却期）
					if (!busyRef.current && !sleepRef.current && !dragRef.current.active && now - timeAnimAtRef.current >= TIME_ANIM_COOLDOWN_MS) {
						const d = new Date();
						const todayStr = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
						if (hour >= 8 && hour < 10 && Math.random() < 0.25) {
							timeAnimAtRef.current = now;
							setAnim(MORNING_SLEEPY);
							setOnce(true);
							setSeq((s) => s + 1);
							showBubble({ title: '早…', message: '好困…还没睡醒…', ok: true });
						} else if (hour === 12 && lunchDoneRef.current !== todayStr) {
							lunchDoneRef.current = todayStr;
							timeAnimAtRef.current = now;
							setAnim(LUNCH);
							setOnce(true);
							setSeq((s) => s + 1);
							showBubble({ title: '干饭时间！', message: '（拿出饭盒）开饭啦～', ok: true });
						} else if ((hour >= 23 || hour < 3) && Math.random() < 0.25) {
							timeAnimAtRef.current = now;
							setAnim(NIGHT_GROGGY);
							setOnce(true);
							setSeq((s) => s + 1);
							showBubble({ title: '好困…', message: '眼睛都睁不开了…', ok: true });
						}
					}
				};
				const timer = setInterval(tick, 60000);
				return () => clearInterval(timer);
			}, []);

			// ============================================================================
			// 动画链：每次动画播完 → 按概率选下一个
			// ============================================================================
			// 链式模型（无常驻待机、无定时器）：
			//   每个动画（含待机呼吸休闲）都是一次性播放，播完 handleEnded 触发，
			//   按概率选下一个：30% 待机 / 10% 转向 / 40% 动作 / 20% 移动。
			//   点击/拖拽打断的动画播完后先回待机（作为缓冲），待机播完再进随机链。
			const pickNext = () => {
				const roll = Math.random();
				if (roll < 0.3) {
					// 30% 待机：待机呼吸休闲（也是一次性，播完再选）
					setAnim(IDLE);
				} else if (roll < 0.4) {
					// 10% 转向：东张西望，播完 handleEnded 里翻转 facing
					setAnim(TURN);
				} else if (roll < 0.8) {
					// 40% 随机动作（等概率 + 去重）
					setAnim(pick(ACTS, animRef.current));
				} else if ((settingsRef.current || {}).roam !== false) {
					// 20% 尝试移动（可在设置里关掉漫游）：tryMove 先检查空间，不够就回退随机动作
					if (!tryMove()) {
						setAnim(pick(ACTS, animRef.current));
					}
				} else {
					// 漫游已关闭：把移动概率让给随机动作
					setAnim(pick(ACTS, animRef.current));
				}
				setOnce(true);        // 链式模型全部一次性
				setSeq((s) => s + 1); // 保证即使 anim 没变也重新播放
			};

			// 一次性动画播完的回调：决定下一个动画。
			// 拖拽中途不响应（让拖拽动画继续）。
			const handleEnded = () => {
				if (dragRef.current.active) return; // 拖拽中：不打断
				if (sleepRef.current) {
					// 睡眠中：进入睡眠播完 → 持续睡觉循环；其余一律继续睡
					setAnim(SLEEP_LOOP);
					setOnce(false);
					setSeq((s) => s + 1);
					return;
				}
				if (busyRef.current && animRef.current === SLEEP_WAKE) {
					startWork(); // 睡梦中被任务叫醒：叫醒播完 → 开始工作 → 工作中轮播
					return;
				}
				if (busyRef.current && animRef.current === WORK_START) {
					playWorking(); // 开始工作（站→坐）播完 → 进入工作中坐姿轮播
					return;
				}
				if (animRef.current === TURN) {
					// 东张西望播完 → 翻转朝向
					setFacing((f) => (f === 'left' ? 'right' : 'left'));
				}
				// 点击回应/拖拽/任务通知动画（用户或任务打断触发的）播完 → 先回待机缓冲；
				// 若 Agent 仍在工作，则回到工作轮播
				if (animRef.current === DRAG || CLICKS.includes(animRef.current) || INTERRUPT.includes(animRef.current)) {
					if (busyRef.current) {
						playWorking();
						return;
					}
					setAnim(IDLE);
					setOnce(true);
					setSeq((s) => s + 1);
					return;
				}
				// 自主链动画播完 → 按概率选下一个
				pickNext();
			};

			// ============================================================================
			// 移动系统 —— 动画提供姿态，代码驱动位置
			// ============================================================================
			const moveRef = useRef(null);        // 移动中的 rAF id
			const moveTokenRef = useRef(0);      // 移动令牌：每次取消 +1 使旧回调失效
			const pendingMoveRef = useRef(null); // 计划中的移动 {startX,startY,target,dir,total}
			const customPosRef = useRef(null);   // customPos 的 ref 镜像（供异步读取）
			customPosRef.current = customPos;

			// 当前宠物中心 x（视口坐标）：
			// customPos 存"相对窗口比例"（rx = centerX/innerWidth），渲染时乘当前窗口尺寸。
			// 窗口 resize 后按新尺寸重算 → 宠物保持相对位置。
			const currentCenterX = () => {
				const cp = customPosRef.current;
				if (cp) return cp.rx * window.innerWidth;
				const rootEl = rootRef.current;
				if (rootEl) return rootEl.getBoundingClientRect().left + size / 2;
				return window.innerWidth - 24 - size / 2;
			};
			// 当前宠物中心 y（视口坐标）
			const currentCenterY = () => {
				const cp = customPosRef.current;
				if (cp) return cp.ry * window.innerHeight;
				const rootEl = rootRef.current;
				if (rootEl) return rootEl.getBoundingClientRect().top + size / 2;
				return window.innerHeight - 20 - size / 2;
			};

			/**
			 * 启动"位置驱动"循环。只在移动动画真正加载完成并开始播放后调用
			 * （在 switchTo 的 onReady 里），保证人物姿态先出现在屏幕上、位置才开始动。
			 *
			 * 关键设计：位置跟随动画的播放时钟（video.currentTime）——
			 *   动画开头 MOVE_LEAD_SEC(2s) 是准备动作：位置不动
			 *   中间窗口：位置按 (t-LEAD)/window 比例从起点走向终点
			 *   结尾 MOVE_TAIL_SEC(2s) 是收尾动作：位置已到终点不动
			 * 这样踏步节奏和位移完全同步，不会有"滑步"。
			 */
			const startMoveDrive = (el) => {
				const pm = pendingMoveRef.current;
				if (!pm || moveRef.current !== null) return; // 没有计划或已在移动
				pendingMoveRef.current = null;
				const { startRatio, startYRatio, targetRatio, dir, totalRatio } = pm;
				// 动画时长驱动节奏（10.09s），取不到时兜底
				const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 10.09;
				// 真正移动的窗口 = 总时长 - 前后 2s（至少 0.1s 防除零）
				// 命名注意：不能叫 window——会遮蔽全局 window，导致 window.innerWidth 变 undefined（历史 bug）
				const travelWindow = Math.max(0.1, duration - MOVE_LEAD_SEC - MOVE_TAIL_SEC);
				const token = ++moveTokenRef.current;
				const step = () => {
					if (moveTokenRef.current !== token) return;
					const t = el.currentTime || 0; // 动画当前播放进度（秒）
					const rootEl = rootRef.current;
					if (rootEl) {
						// 每帧用"当前窗口尺寸 × 比例"算实际坐标——resize 后自动跟随
						const W = window.innerWidth;
						const H = window.innerHeight;
						let ratioX;
						if (t <= MOVE_LEAD_SEC) {
							ratioX = startRatio; // 准备动作：原地
						} else if (t >= duration - MOVE_TAIL_SEC) {
							ratioX = targetRatio; // 收尾动作：已到终点
						} else {
							// 移动窗口：按进度插值（比例制）
							const progress = (t - MOVE_LEAD_SEC) / travelWindow;
							ratioX = startRatio + dir * totalRatio * progress;
						}
						const px = ratioX * W;
						const py = startYRatio * H;
						// 直接改 DOM style（不触发 React 重渲染，保证 60fps 平滑）
						rootEl.style.left = (px - size / 2) + 'px';
						rootEl.style.top = (py - size / 2) + 'px';
						rootEl.style.right = 'auto';
						rootEl.style.bottom = 'auto';
					}
					if (t < duration - MOVE_TAIL_SEC) {
						moveRef.current = requestAnimationFrame(step); // 继续下一帧
					} else {
						// 到位：提交终点位置（存相对窗口比例），让动画自然播完最后 2s 收尾——
						// 它是一次性动画，ended 事件会带我们回待机
						moveRef.current = null;
						setCustomPos({ rx: targetRatio, ry: startYRatio });
					}
				};
				moveRef.current = requestAnimationFrame(step);
			};

			/**
			 * 尝试计划一次移动（朝当前 facing 方向）。
			 * 只做两件事：检查空间是否够 + 记录计划；真正的位置驱动
			 * 等移动动画就绪后由 switchTo 的 onReady 触发。
			 * @returns {boolean} true=移动已计划；false=空间不够（调用方回退随机动作）
			 */
			const tryMove = () => {
				if (moveRef.current !== null || pendingMoveRef.current) return true; // 已在移动/已计划
				const dir = facingRef.current === 'right' ? 1 : -1; // 朝右=+1，朝左=-1
				const W = window.innerWidth;
				const cx = currentCenterX();
				const distance = randomBetween(MOVE_MIN_PX, MOVE_MAX_PX);
				const target = cx + dir * distance;
				// 【播放前检查一次距离】目标点必须在屏幕安全边距内，否则不移动
				const leftBound = MOVE_MARGIN + size / 2;
				const rightBound = W - MOVE_MARGIN - size / 2;
				if (target < leftBound || target > rightBound) return false; // 空间不够
				// 记录计划（存"比例"而非绝对坐标，resize 后仍正确）：
				// 起点比例、目标比例、Y 比例、方向、总距离比例
				pendingMoveRef.current = {
					startRatio: cx / W,
					startYRatio: currentCenterY() / window.innerHeight,
					targetRatio: target / W,
					dir,
					totalRatio: Math.abs(target - cx) / W,
				};
				// 移动动画一次性播放（10s），播完 ended 触发 handleEnded → 进入动画链
				setOnce(true);
				setAnim(pick(MOVES));
				return true;
			};
			// 停止移动（点击/拖拽打断时调用）：取消计划 + 使 rAF 失效 + 取消帧
			const stopMove = () => {
				pendingMoveRef.current = null;
				moveTokenRef.current++;
				if (moveRef.current !== null) {
					cancelAnimationFrame(moveRef.current);
					moveRef.current = null;
				}
			};

			// facing 的 ref 镜像（tryMove/定时器读取当前朝向）
			const facingRef = useRef(facing);
			facingRef.current = facing;

			// ============================================================================
			// 点击 vs 拖拽的区分
			// ============================================================================
			// 问题：按下+松开可能是一次"点击"，也可能是一次"拖拽"。
			// 方案：pointerdown 只记录起点；pointermove 超过 5px 才判定为拖拽
			// （播放拖拽动画并跟手）；松手时若没拖过，click 事件正常触发点击回应。
			const DRAG_THRESHOLD = 5; // 拖拽判定阈值（px）

			// 按下：只记录，不立即切动画
			const handlePointerDown = (e) => {
				markActivity();
				stopMove(); // 用户交互打断正在进行的移动
				e.currentTarget.setPointerCapture(e.pointerId); // 捕获指针（拖出元素也能收到 move）
				dragRef.current = { active: true, dragging: false, sx: e.clientX, sy: e.clientY };
			};
			// 移动：超过阈值才进入拖拽模式
			const handlePointerMove = (e) => {
				const d = dragRef.current;
				if (!d.active) return;
				const dx = e.clientX - d.sx;
				const dy = e.clientY - d.sy;
				if (!d.dragging) {
					// 还没超过阈值：仍是"点击候选"，不动
					if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
					// 进入拖拽：播放拖拽动画
					d.dragging = true;
					setDragging(true);
					setOnce(true);
					setAnim(DRAG);
				}
				// 跟手：直接改 root 的 style（不触发 React 重渲染 → 60fps 平滑）
				const rootEl = rootRef.current;
				if (rootEl) {
					rootEl.style.left = (e.clientX - size / 2) + 'px';
					rootEl.style.top = (e.clientY - size / 2) + 'px';
					rootEl.style.right = 'auto';
					rootEl.style.bottom = 'auto';
				}
				const stageEl = stageRef.current;
				if (stageEl) stageEl.style.transform = 'none'; // 拖拽时去掉落地偏移
			};
			// 松手：真拖拽则停留 + 回待机；没拖过则等 click 事件
			const handlePointerUp = (e) => {
				const d = dragRef.current;
				const wasDragging = d.dragging;
				d.active = false;
				d.dragging = false;
				if (wasDragging) {
					// 抑制拖拽结束后的"幽灵点击"（浏览器在拖完也会发 click）
					justDraggedRef.current = true;
					setTimeout(() => { justDraggedRef.current = false; }, 100);
					setDragging(false);
					// 停在松手处（存相对窗口比例，窗口变化时位置跟随）
					setCustomPos({
						rx: e.clientX / window.innerWidth,
						ry: e.clientY / window.innerHeight,
					});
					const stageEl = stageRef.current;
					if (stageEl) stageEl.style.transform = 'translateY(' + bottomPad + 'px)'; // 恢复落地对齐
					// 本 fork 修复：工作中被拖动 → 放回工作轮播池；睡梦中被拖动 → 叫醒；空闲 → 原版待机
					if (sleepRef.current) {
						wakeUp();
					} else if (busyRef.current) {
						playWorking();
					} else {
						setAnim(IDLE);
						setOnce(false);
					}
				}
				// 没拖过：交给 handleClick
			};

			// ---- 点击回应（仅真点击触发，拖拽后的 click 被忽略） ----
			const handleClick = () => {
				const d = dragRef.current;
				if (d.active || d.dragging || justDraggedRef.current) return; // 拖拽中/刚拖完：忽略
				markActivity();
				if (sleepRef.current) {
					wakeUp(); // 睡着时点击：先叫醒
					return;
				}
				if (once && animRef.current !== IDLE) return; // 正在播一次性动画：不打断
				stopMove(); // 点击打断移动
				setOnce(true);
				if (busyRef.current) {
					// 本 fork：忙时点击 → 生气动画 + 不耐烦台词
					setAnim(BUSY_CLICK);
					showBubble({ title: '别闹～', message: BUSY_LINES[Math.floor(Math.random() * BUSY_LINES.length)], ok: true });
				} else {
					setAnim(pick(CLICKS)); // 空闲：随机一个点击回应动画
				}
			};

			// ---- 本 fork：双击摸头（开心跃动 + 台词） ----
			const handleDoubleClick = () => {
				if (dragRef.current.active) return;
				markActivity();
				if (sleepRef.current) {
					wakeUp(); // 睡着时双击：先叫醒
					return;
				}
				stopMove();
				setOnce(true);
				setAnim('点击回应 - 开心跃动');
				showBubble({ title: '摸摸～', message: '双倍摸摸！心情 +1！', ok: true });
			};

			// ---- 本 fork：喂食（🍪 按钮，30 秒冷却） ----
			const handleFeed = () => {
				const now = Date.now();
				markActivity();
				resetSleep(); // 喂食先脱离睡眠
				if (now - feedAtRef.current < 30000) {
					showBubble({ title: '吃饱啦', message: '刚吃过啦，等会儿再喂～', ok: true });
					return;
				}
				feedAtRef.current = now;
				setAnim(FEED);
				setOnce(true);
				setSeq((s) => s + 1);
				showBubble({ title: '开饭！', message: FEED_LINES[Math.floor(Math.random() * FEED_LINES.length)], ok: true });
			};

			// ---- 本 fork：天气查询（☁️ 按钮） ----
			const iconToCn = (icon) => {
				const map = [
					['☀', '晴'], ['🌞', '晴'], ['⛅', '多云'], ['☁', '多云'], ['🌤', '晴间多云'],
					['🌦', '阵雨'], ['🌧', '雨'], ['⛈', '雷雨'], ['🌩', '雷雨'],
					['❄', '雪'], ['🌨', '雪'], ['🌫', '雾'], ['🌬', '大风'],
				];
				for (const [key, value] of map) if (icon.indexOf(key) === 0) return value;
				return icon || '天气';
			};
			const handleWeather = async () => {
				if (weatherLoading) return;
				markActivity();
				resetSleep(); // 查天气先脱离睡眠
				playAction('看天气'); // 本 fork：播专属动画（手搭凉棚望天）
				setWeatherLoading(true);
				showBubble({ title: '查天气', message: '掐指一算明日天气…', ok: true });
				try {
					const data = await fetch('/api/whale-pet/weather').then((r) => r.json());
					if (data && data.ok) {
						// 主打明日：今日天气抬头就能看见
						const tomorrow = (data.tomorrowIcon || '🌤') + ' ' + Number(data.tomorrowLow) + '°~' + Number(data.tomorrowHigh) + '°' + (data.tomorrowDesc ? ' ' + data.tomorrowDesc : '');
						showBubble({ title: '☁️ ' + data.city + ' · 明日天气', message: tomorrow, ok: true });
					} else {
						showBubble({ title: '天气查询失败', message: data && data.error ? data.error : '未知错误', ok: false });
					}
				} catch (error) {
					showBubble({ title: '天气查询失败', message: String(error && error.message ? error.message : error), ok: false });
				} finally {
					setWeatherLoading(false);
				}
			};

			// ============================================================================
			// 渲染
			// ============================================================================
			// 落地对齐：视频是 360 画布、脚在 y=330，脚底距画布底 30px。
			// bottomPad = size × (360-330)/360，把舞台向下平移这么多，
			// 让"脚"正好落在视口底线上（宠物看起来站在地上而不是悬空）。
			const bottomPad = (size * (CANVAS_H - FEET_Y)) / CANVAS_H;
			// 舞台样式：拖拽中无偏移；平时 translateY(bottomPad) 落地
			const stageStyle = dragging
				? { transform: 'none' }
				: { transform: 'translateY(' + bottomPad + 'px)' };

			// 根容器样式：有自定义位置（拖过/走过）就按"相对窗口比例 × 当前窗口尺寸"定位；
			// 否则不设（走 CSS 的 data-corner 默认角落，天然响应式）。
			// resize 后重渲染会用新尺寸重算 → 宠物保持相对位置；
			// 同时钳制到窗口内，防止窗口缩小到宠物放不下时跑出屏幕。
			const rootStyle = customPos
				? (() => {
					const half = size / 2;
					const rx = customPos.rx;
					const ry = customPos.ry;
					const left = Math.min(Math.max(rx * window.innerWidth - half, 0), window.innerWidth - size);
					const top = Math.min(Math.max(ry * window.innerHeight - half, 0), window.innerHeight - size);
					return { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' };
				})()
				: {};

			// 两个 video 共用的 props（事件绑定 + 播放属性）
			const commonVideoProps = {
				muted: true,
				playsInline: true,
				autoPlay: true,
				onClick: handleClick,
				onDoubleClick: handleDoubleClick,
				onPointerDown: handlePointerDown,
				onPointerMove: handlePointerMove,
				onPointerUp: handlePointerUp,
				onPointerCancel: handlePointerUp,
			};

			// 渲染树：root > [任务气泡, 打字气泡, stage > video A/B]
			// A 初始带 is-front（显示），B 隐藏待命
			return h('div', {
				ref: rootRef,
				className: 'dsh-pet-root',
				'data-corner': corner,   // CSS 决定默认角落
				'data-facing': facing,   // CSS 决定是否镜像
				style: Object.assign({ '--dsh-pet-size': size + 'px' }, rootStyle),
				children: [
					// 本 fork 新增：任务完成/失败通知气泡
					bubble ? h('div', {
						className: 'dsh-pet-bubble' + (bubble.ok ? '' : ' dsh-pet-bubble-fail') + (bubble.lines ? ' dsh-pet-bubble-lines' : ''),
						onClick: () => setBubble(null),
						children: [
							bubble.title ? h('div', { className: 'dsh-pet-bubble-title' + (bubble.ok ? '' : ' dsh-pet-bubble-title-fail'), children: bubble.title }) : null,
							h('div', { className: 'dsh-pet-bubble-msg', children: bubble.message }),
						],
					}) : null,
					// 本 fork 新增：工作中的打字机气泡
					typing && !bubble ? h('div', {
						className: 'dsh-pet-bubble dsh-pet-bubble-work',
						children: h('div', { className: 'dsh-pet-bubble-msg', children: ['🖥️ ', typing.text, h('span', { className: 'dsh-pet-cursor', children: '▍' })] }),
					}) : null,
					// 本 fork 新增：☁️/💰/🍪/📊 按钮挂在宠物身上（跟随漫游/拖拽一起移动）；
					// 查询结果通过 onResult 汇入宠物头顶的统一气泡（与任务通知共用位置）
					// 本 fork：按钮组位置跟随设置（左侧默认 / 右侧）
					// 本 fork：📊 按钮用 forwardRef 把 ref 落到真实 <button> 上，
					// 作为看板弹层的锚点（包裹 span 是 display:contents，没有盒子不能当锚点）
					react.createElement('div', { className: 'wb-stack' + (((settingsRef.current || {}).buttonSide === 'right') ? ' wb-stack-right' : '') },
						react.createElement(WeatherButton, { loading: weatherLoading, onClick: handleWeather }),
						react.createElement(BalanceButton, { onResult: (r) => showBubble(r), onPlay: () => playAction('翻钱包') }),
						react.createElement(FeedButton, { onClick: handleFeed }),
						react.createElement(DashboardButton, {
							ref: dashButtonRef,
							t: dashT,
							onClick: () => {
								markActivity();
								setDashOpen((open) => !open);
							},
						}),
						dashOpen && react.createElement(DashboardModal, {
							open: true,
							t: dashT,
							buttonRef: dashButtonRef,
							panelRef: dashPanelRef,
						}),
					),
					h('div', {
						ref: stageRef,
						className: 'dsh-pet-stage',
						style: stageStyle,
						children: [
							h('video', Object.assign({}, commonVideoProps, { ref: videoARef, className: 'dsh-pet-video is-front' })),
							h('video', Object.assign({}, commonVideoProps, { ref: videoBRef, className: 'dsh-pet-video' })),
						],
					}),
				],
			});
		}

		// ============================================================================
		// 本 fork 新增：💰 余额查询按钮（挂在宠物默认角落上方，同源 /api/whale-balance）
		// ============================================================================
		function IconButton({ icon, title, loading, onClick, buttonRef }) {
			return react.createElement('button', {
				ref: buttonRef,
				className: 'wb-btn' + (loading ? ' wb-loading' : ''),
				onClick: onClick,
				title: title,
			}, icon);
		}

		function WeatherButton({ loading, onClick }) {
			return react.createElement(IconButton, { icon: '☁️', title: '查询天气', loading: loading, onClick: onClick });
		}

		function FeedButton({ onClick }) {
			return react.createElement(IconButton, { icon: '🍪', title: '投喂小鱼干', loading: false, onClick: onClick });
		}

		/** token 数人性化显示：1234567 → 1.23M，12345 → 12.3k。 */
		function fmtTokens(n) {
			n = Number(n) || 0;
			if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
			if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
			return String(n);
		}

		/** 金额显示：不足 1 分显示 <¥0.01，其余保留 2 位。 */
		function fmtCost(n) {
			const v = Number(n) || 0;
			return v > 0 && v < 0.01 ? '<¥0.01' : '≈¥' + v.toFixed(2);
		}

		function BalanceButton({ onResult, onPlay }) {
			const [loading, setLoading] = useState(false);
			const onClick = async () => {
				if (loading) return;
				setLoading(true);
				if (onPlay) onPlay(); // 本 fork：播「翻钱包」动画
				try {
					const data = await fetch('/api/whale-balance').then((r) => r.json());
					// 本 fork 新增：同一响应里附带的今日用量（token 消耗 + 花费）
					const usage = data && data.usage && data.usage.ok ? data.usage : null;
					const lines = [];
					let title = '';
					if (data && data.ok) {
						const sym = data.currency === 'USD' ? '$' : '¥';
						title = '💰 余额 · 今日用量';
						lines.push('余额 ' + sym + data.total);
					} else if (usage) {
						title = '今日用量';
						if (data && data.error) lines.push('余额查询失败：' + data.error);
					} else {
						if (onResult) onResult({ title: '余额查询失败', message: data && data.error ? data.error : '未知错误', ok: false });
						return;
					}
					if (usage) {
						const totalTok = Number(usage.tokens && usage.tokens.total) || 0;
						lines.push('今日消耗 ' + fmtTokens(totalTok) + ' tokens');
						lines.push('今日花费 ' + fmtCost(usage.costCny));
						// 本 fork：花费按桶拆分（缓存命中 / 未命中 / 输出），与任务完成气泡同口径
						lines.push('· 缓存命中 ' + fmtCost(usage.costHitCny));
						lines.push('· 缓存未命中 ' + fmtCost(usage.costMissCny));
						lines.push('· 输出 ' + fmtCost(usage.costOutCny));
					} else if (data && data.ok) {
						lines.push('（今日用量统计不可用）');
					}
					if (onResult) onResult({ title, message: lines.join('\n'), ok: true, lines: true });
				} catch (error) {
					if (onResult) onResult({ title: '余额查询失败', message: '查询失败：' + String(error && error.message ? error.message : error), ok: false });
				} finally {
					setLoading(false);
				}
			};
			return react.createElement(IconButton, { icon: '💰', title: '查询 DeepSeek 余额与今日用量', loading: loading, onClick: onClick });
		}

		// ============================================================================
		// 本 fork 新增：设置面板（DSH 设置 → 桌宠配置）
		// ============================================================================
		const S_ROW = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(128,128,128,.18)', fontSize: 13 };
		const S_BTN = { border: '1px solid #cfe4ff', borderRadius: 8, padding: '4px 14px', cursor: 'pointer', fontSize: 12, background: 'transparent', color: 'inherit' };
		const S_BTN_ON = { background: '#4D94F5', color: '#fff', borderColor: '#4D94F5' };
		const S_INPUT = { width: 90, padding: '4px 8px', borderRadius: 8, border: '1px solid #cfe4ff', fontSize: 12, background: 'transparent', color: 'inherit' };

		class SettingsSectionBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}
			static getDerivedStateFromError(error) {
				return { error };
			}
			render() {
				if (this.state.error) {
					return react.createElement('div', { style: { padding: 12, color: '#c24040', fontSize: 12, lineHeight: 1.6 } },
						'桌宠配置渲染出错：' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error));
				}
				return this.props.children;
			}
		}

		function PetSettingsSection() {
			const [settings, setSettings] = useState(null);
			const [busy, setBusy] = useState(false);
			const [msg, setMsg] = useState(null);
			const load = async () => {
				try {
					const data = await fetch('/api/whale-pet/settings').then((r) => r.json());
					setSettings(data && data.value ? data.value : {});
				} catch (e) { setSettings({}); }
			};
			useEffect(() => { load(); }, []);
			const save = async (ops) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				try {
					const res = await fetch('/api/whale-pet/settings', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ ops }),
					});
					const data = await res.json();
					setMsg(data && data.ok ? '已保存 ✓' : '保存失败');
					load();
				} catch (e) {
					setMsg('保存失败');
				} finally {
					setBusy(false);
				}
			};
			const s = settings || {};
			const toggle = (path, key) => save([{ op: 'set', path: path, value: s[key] !== true }]);
			const toggler = (path, key) => react.createElement('button', {
				style: Object.assign({}, S_BTN, s[key] === true ? S_BTN_ON : null),
				onClick: () => toggle(path, key),
			}, s[key] === true ? '开' : '关');
			const numberInput = (path, fallback) => react.createElement('input', {
				type: 'number',
				style: S_INPUT,
				defaultValue: s[path] !== undefined ? s[path] : fallback,
				key: String(s[path] !== undefined ? s[path] : fallback),
				onBlur: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) save([{ op: 'set', path: [path], value: v }]); },
			});
			const textInput = (path) => react.createElement('input', {
				type: 'text',
				style: S_INPUT,
				defaultValue: s[path] || '',
				key: String(s[path] || ''),
				placeholder: '如 Beijing / 北京',
				onBlur: (e) => save([{ op: 'set', path: [path], value: String(e.target.value).slice(0, 40) }]),
			});
			return react.createElement(SettingsSectionBoundary, null,
				react.createElement('div', { style: { maxWidth: 520, padding: '4px 0 20px' } },
					react.createElement('div', { style: { fontSize: 12, color: '#55627c', marginBottom: 4 } }, '改动即时生效并保存到 settings.yaml（重启不丢）'),
					react.createElement('div', { style: S_ROW }, '番茄钟提醒', toggler(['pomodoro'], 'pomodoro')),
					react.createElement('div', { style: S_ROW }, '番茄钟间隔（分钟）', numberInput('pomodoroMinutes', 25)),
					react.createElement('div', { style: S_ROW }, '深夜关怀（23:00-05:00）', toggler(['lateNight'], 'lateNight')),
					react.createElement('div', { style: S_ROW }, '随机小剧场', toggler(['chatter'], 'chatter')),
					react.createElement('div', { style: S_ROW }, '漫游走动（随机溜达）', react.createElement('button', {
						style: Object.assign({}, S_BTN, s.roam !== false ? S_BTN_ON : null),
						onClick: () => save([{ op: 'set', path: ['roam'], value: s.roam === false }]),
					}, s.roam !== false ? '开' : '关')),
					react.createElement('div', { style: S_ROW }, '按钮位置（☁️💰🍪📊）', react.createElement('div', { style: { display: 'flex', gap: 6 } },
						[['left', '左侧'], ['right', '右侧']].map(([v, label]) => react.createElement('button', {
							key: v,
							style: Object.assign({}, S_BTN, (s.buttonSide === undefined ? 'left' : s.buttonSide) === v ? S_BTN_ON : null),
							onClick: () => save([{ op: 'set', path: ['buttonSide'], value: v }]),
						}, label)))),
					// 本 fork 新增：看板（分时段花费）——历史补扫开关与窗口天数
					// 注意 dashboardHistory / dashboardWindowDays 在宿主半侧启动时读取，
					// 改动重启 dsh web 后完全生效（窗口天数会影响响应内容，故取回即生效）。
					react.createElement('div', { style: S_ROW }, '看板：启动补扫历史用量（重启生效）', react.createElement('button', {
						style: Object.assign({}, S_BTN, s.dashboardHistory !== false ? S_BTN_ON : null),
						onClick: () => save([{ op: 'set', path: ['dashboardHistory'], value: s.dashboardHistory === false }]),
					}, s.dashboardHistory !== false ? '开' : '关')),
					react.createElement('div', { style: S_ROW }, '看板：日趋势天数（1-30）', numberInput('dashboardWindowDays', 7)),
					react.createElement('div', { style: S_ROW }, '长任务提醒阈值（分钟）', numberInput('longTaskMinutes', 10)),
					react.createElement('div', { style: S_ROW }, '天气城市（留空=自动定位）', textInput('city')),
					msg ? react.createElement('div', { style: { fontSize: 12, color: '#2e7d4f', marginTop: 8 } }, msg) : null,
					busy ? react.createElement('div', { style: { fontSize: 12, color: '#55627c', marginTop: 4 } }, '保存中…') : null,
				),
			);
		}

		// ============================================================================
		// 本 fork 新增：会话费用 pill（conversation.composer.dock，输入框下方统计行右侧）
		// ----------------------------------------------------------------------------
		// 金额来自宿主半侧注册的 costUsage 投影（lib/cost-projection.js），与任务完成
		// 气泡、余额按钮共用 lib/usage.js 的同一套价目与计费口径。
		// ============================================================================
		const COST_NS = 'whale-pet-cost';
		const COST_ZH = {
			'pill.peak': '峰',
			'pill.offPeak': '谷',
			'pill.label': '费用 {amount}',
			'pill.aria': '费用估算 {amount}，当前{period}',
			'dialog.title': '费用估算',
			'dialog.cacheRead': '缓存命中',
			'dialog.miss': '缓存未命中',
			'dialog.output': '输出',
			'dialog.peak': '高峰时段',
			'dialog.offPeak': '空闲时段',
			'dialog.priced': '计价调用',
			'dialog.unpriced': '未定价调用',
			'dialog.periodPeak': '当前为高峰时段',
			'dialog.periodOffPeak': '当前为空闲时段',
			'dialog.note': '按官方价目表估算，缓存写入按未命中计价；高峰时段为北京时间周一至周五 9:00–12:00、14:00–18:00。',
			'dialog.unpricedNote': '有 {count} 次调用没有匹配的价目表，金额被低估。',
			'dialog.subtree': '子会话',
			'dialog.subtreeNote': '含 {count} 个子代理会话的用量（宿主按会话树汇总，已结束的子代理也在内）。',
			'dialog.turnSubtreeNote': '含本轮派发出去的子代理开销。',
			'turn.label': '费用 {amount}',
			'turn.aria': '本轮费用 {amount}',
			'turn.title': '本轮费用',
			// 本 fork 新增：气泡看板（分时段花费）
			'dash.button': '数据看板',
			'dash.title': '分时段花费',
			'dash.metricCost': '花费',
			'dash.metricTokens': 'token',
			'dash.tabHourly': '今日分时',
			'dash.tabDaily': '近 {days} 天',
			'dash.today': '今日',
			'dash.last24h': '近 24 小时',
			'dash.window': '近 {days} 天',
			'dash.calls': '{count} 次调用',
			'dash.tokensIn': '输入',
			'dash.tokensOut': '输出',
			'dash.cacheRead': '缓存命中',
			'dash.bucketHit': '缓存命中',
			'dash.bucketMiss': '未命中',
			'dash.bucketOut': '输出',
			'dash.costOut': '输出花费',
			'dash.hitRate': '命中率',
			'dash.avg': '均值',
			'dash.avgHour': '平均每小时（{count} 个小时）',
			'dash.avgDay': '平均每天（{count} 天）',
			'dash.avgHint': '每格均值',
			'dash.axisCost': '单价',
			'dash.chartAriaCost': '分时段花费堆叠柱状图（缓存命中 / 未命中 / 输出）',
			'dash.chartAriaTokens': '分时段 token 堆叠柱状图（缓存命中 / 未命中 / 输出）',
			'dash.legendHour': '柱内三段 = 该小时的花费构成；橙色底纹 = 高峰时段（价 ×2）',
			'dash.legendDay': '柱内三段 = 当天的花费构成；只标最高几天与今天的金额',
			'dash.legendHourTokens': 'token 视图按同一分桶堆叠；缓存命中通常占 99%+，所以柱高几乎全是它',
			'dash.legendDayTokens': 'token 视图按同一分桶堆叠；缓存命中通常占 99%+，与金额视图对照看',
			'dash.peakHours': '高峰',
			'dash.offPeakHours': '空闲',
			'dash.refresh': '刷新',
			'dash.loading': '读取中…',
			'dash.error': '读取失败：{error}',
			'dash.legendPeak': '高峰时段（价 ×2）',
			'dash.legendOff': '空闲时段',
			'dash.scanRunning': '正在补扫历史用量…',
			'dash.scanDone': '已补扫 {sessions} 个会话 · {events} 条事件',
			'dash.scanUnavailable': '未接入历史持久化，仅统计本次运行',
			'dash.scanFailed': '历史补扫未完成（{failed} 个会话失败）',
			'dash.empty': '这个时段还没有用量记录～',
			'dash.dragHint': '按住头部拖动 · 双击头部恢复默认位置',
			'dash.resizeHint': '拖动可调整看板大小',
			'dash.note': '金额为本地估算：按官方价目表分档计价，缓存写入按未命中计价，高峰为北京时间周一至周五 9:00–12:00、14:00–18:00。',
		};
		const COST_EN = {
			'pill.peak': 'Peak',
			'pill.offPeak': 'Off-peak',
			'pill.label': 'Cost {amount}',
			'pill.aria': 'Estimated cost {amount}, currently {period}',
			'dialog.title': 'Cost estimate',
			'dialog.cacheRead': 'Cache hit',
			'dialog.miss': 'Cache miss',
			'dialog.output': 'Output',
			'dialog.peak': 'Peak hours',
			'dialog.offPeak': 'Off-peak hours',
			'dialog.priced': 'Priced calls',
			'dialog.unpriced': 'Unpriced calls',
			'dialog.periodPeak': 'Currently peak hours',
			'dialog.periodOffPeak': 'Currently off-peak hours',
			'dialog.note': 'Estimated from the official rate table; cache writes are billed as misses. Peak hours are Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00.',
			'dialog.unpricedNote': '{count} call(s) had no matching rate, so the total is understated.',
			'dialog.subtree': 'Sub-sessions',
			'dialog.subtreeNote': 'Includes usage from {count} subagent session(s), aggregated by the host in the session tree (finished subagents included).',
			'dialog.turnSubtreeNote': 'Includes subagents dispatched during this turn.',
			'turn.label': 'Cost {amount}',
			'turn.aria': 'Turn cost {amount}',
			'turn.title': 'Turn cost',
			// 本 fork 新增：气泡看板（分时段花费）
			'dash.button': 'Usage dashboard',
			'dash.title': 'Cost by time',
			'dash.metricCost': 'Cost',
			'dash.metricTokens': 'Tokens',
			'dash.tabHourly': 'Today by hour',
			'dash.tabDaily': 'Last {days} days',
			'dash.today': 'Today',
			'dash.last24h': 'Last 24 hours',
			'dash.window': 'Last {days} days',
			'dash.calls': '{count} calls',
			'dash.tokensIn': 'Input',
			'dash.tokensOut': 'Output',
			'dash.cacheRead': 'Cache read',
			'dash.bucketHit': 'Cache hit',
			'dash.bucketMiss': 'Cache miss',
			'dash.bucketOut': 'Output',
			'dash.costOut': 'Output cost',
			'dash.hitRate': 'hit rate',
			'dash.avg': 'avg',
			'dash.avgHour': 'Avg per hour ({count}h)',
			'dash.avgDay': 'Avg per day ({count}d)',
			'dash.avgHint': 'per bucket',
			'dash.axisCost': 'rate',
			'dash.chartAriaCost': 'Cost by time, stacked bars (cache hit / miss / output)',
			'dash.chartAriaTokens': 'Tokens by time, stacked bars (cache hit / miss / output)',
			'dash.legendHour': 'Each stack = that hour’s cost mix; orange band = peak hours (rate ×2)',
			'dash.legendDay': 'Each stack = that day’s cost mix; labels only on top days and today',
			'dash.legendHourTokens': 'Same buckets, token scale; cache hits are usually 99%+, so they dominate the bars',
			'dash.legendDayTokens': 'Same buckets, token scale; compare against the cost view',
			'dash.peakHours': 'Peak',
			'dash.offPeakHours': 'Off-peak',
			'dash.refresh': 'Refresh',
			'dash.loading': 'Loading…',
			'dash.error': 'Failed to load: {error}',
			'dash.legendPeak': 'Peak hours (rate ×2)',
			'dash.legendOff': 'Off-peak hours',
			'dash.scanRunning': 'Rebuilding usage history…',
			'dash.scanDone': 'Scanned {sessions} sessions · {events} events',
			'dash.scanUnavailable': 'No session persistence: this run only',
			'dash.scanFailed': 'History scan incomplete ({failed} sessions failed)',
			'dash.empty': 'No usage recorded in this window yet.',
			'dash.dragHint': 'Drag the header to move · double-click it to reset',
			'dash.resizeHint': 'Drag to resize the dashboard',
			'dash.note': 'Amounts are local estimates from the official rate table; cache writes are billed as misses. Peak hours are Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00.',
		};

		/** 北京时间是否处于高峰时段（与宿主 lib/usage.js 的 isPeakBeijing 同规则）。 */
		function isPeakNow() {
			const bj = new Date(Date.now() + 8 * 3600e3);
			const day = bj.getUTCDay();
			if (day === 0 || day === 6) return false;
			const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();
			return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080);
		}

		/** 费用条目图标：¥ 硬币。 */
		function CostIcon() {
			return react.createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true },
				react.createElement('circle', { cx: 8, cy: 8, r: 6.25, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
				react.createElement('path', {
					d: 'M5.4 5.3 8 8.6 10.6 5.3 M8 8.6V11.2 M6.2 8.6h3.6 M6.2 10h3.6',
					fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round',
				}));
		}

		/** 明细弹层里的一行 dt/dd。 */
		function costRow(label, value, key) {
			return react.createElement(react.Fragment, { key: key },
				react.createElement('dt', null, label),
				react.createElement('dd', null, value));
		}

		/** 费用明细弹层内容（三桶 + 峰谷拆分 + 计数 + 子会话 + 说明）。 */
		function CostDialog(props) {
			const view = props.view;
			const t = props.t;
			// 子会话（subagent）费用：宿主按会话树汇总，叠加进总额
			const subTotal = subtreeTotal(props.subtree);
			const subCount = props.subtree && props.subtree.descendants
				? Number(props.subtree.descendants.count) || 0
				: 0;
			const peak = isPeakNow();
			const period = peak ? t('dialog.periodPeak') : t('dialog.periodOffPeak');
			const rows = [
				costRow(t('dialog.cacheRead'), fmtCost(view.cacheReadCny), 'hit'),
				costRow(t('dialog.miss'), fmtCost(view.missCny), 'miss'),
				costRow(t('dialog.output'), fmtCost(view.outputCny), 'out'),
				costRow(t('dialog.peak'), fmtCost(view.peakCny), 'peak'),
				costRow(t('dialog.offPeak'), fmtCost(view.offPeakCny), 'off'),
				costRow(t('dialog.priced'), String(view.pricedRequests), 'priced'),
			];
			if (view.unpricedRequests > 0) rows.push(costRow(t('dialog.unpriced'), String(view.unpricedRequests), 'unpriced'));
			if (subTotal > 0) rows.push(costRow(t('dialog.subtree'), fmtCost(subTotal), 'subtree'));
			const notes = [period];
			if (view.unpricedRequests > 0) notes.push(t('dialog.unpricedNote', { count: view.unpricedRequests }));
			if (subTotal > 0) notes.push(t('dialog.subtreeNote', { count: subCount }));
			notes.push(t('dialog.note'));
			return react.createElement('div', {
				ref: props.panelRef,
				className: 'dsh-cost-panel',
				role: 'dialog',
				'aria-label': t('dialog.title'),
				style: props.pos ?? { visibility: 'hidden', left: 0, top: 0 },
			},
			react.createElement('div', { className: 'dsh-cost-title' },
				react.createElement('span', { className: 'dsh-cost-title-label' }, react.createElement(CostIcon), t('dialog.title')),
				react.createElement('span', { className: 'dsh-cost-total' }, fmtCost(view.totalCny + subTotal))),
			react.createElement('div', { className: 'dsh-cost-rule', 'aria-hidden': true }),
			react.createElement('dl', { className: 'dsh-cost-details' }, rows),
			notes.map((text, index) => react.createElement('div', { className: 'dsh-cost-note', key: 'note' + index }, text)));
		}

		/** 弹层定位：锚定触发器上方并夹在视口内（与官方统计弹层同一套行为）。 */
		function useCostPanelPosition(open, anchorRef, panelRef) {
			const [pos, setPos] = useState(null);
			useEffect(() => {
				if (!open) { setPos(null); return; }
				const place = () => {
					const anchor = anchorRef.current;
					if (anchor === null) return;
					const rect = anchor.getBoundingClientRect();
					const panel = panelRef.current;
					const width = panel === null ? 0 : panel.offsetWidth;
					const height = panel === null ? 0 : panel.offsetHeight;
					const margin = 12;
					const gap = 8;
					const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, margin), Math.max(margin, window.innerWidth - width - margin));
					const above = rect.top - height - gap;
					const top = above >= margin ? above : Math.min(rect.bottom + gap, Math.max(margin, window.innerHeight - height - margin));
					setPos({ left: left + 'px', top: top + 'px' });
				};
				place();
				window.addEventListener('resize', place);
				return () => { window.removeEventListener('resize', place); };
			}, [open]);
			return pos;
		}

		/** 点击外部 / Esc 关闭弹层。 */
		function useCostDismiss(open, close, anchorRef, panelRef) {
			useEffect(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					if (anchorRef.current !== null && anchorRef.current.contains(target)) return;
					if (panelRef.current !== null && panelRef.current.contains(target)) return;
					close(false);
				};
				const onKeyDown = (event) => { if (event.key === 'Escape') close(false); };
				document.addEventListener('pointerdown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown);
				return () => {
					document.removeEventListener('pointerdown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown);
				};
			}, [open]);
		}

		// ============================================================================
		// 本 fork 新增：子会话（subagent）费用
		// ----------------------------------------------------------------------------
		// costUsage 投影只折叠"本条会话自己的日志"，而子代理是独立会话，所以
		// "本会话费用"天然漏掉子代理的开销。宿主半侧折叠了所有会话，经
		// /api/whale-pet/subtree-cost 按会话树汇总后返回，这里轮询并叠加到 pill。
		// 会话 id 由 session 作用域槽位注入（props.sessionId）。
		// ============================================================================
		const SUBTREE_API = '/api/whale-pet/subtree-cost';

		/** 轮询当前会话的后代会话费用；没有 sessionId（未选中会话）时返回 null。 */
		function useSubtreeCost(sessionId) {
			const [state, setState] = useState(null);
			useEffect(() => {
				if (!sessionId) { setState(null); return undefined; }
				let alive = true;
				const load = () => {
					fetch(SUBTREE_API + '?session=' + encodeURIComponent(String(sessionId)))
						.then((r) => (r.ok ? r.json() : null))
						.then((data) => { if (alive && data && data.ok) setState(data); })
						.catch(() => {});
				};
				load();
				const timer = setInterval(load, 5000);
				return () => { alive = false; clearInterval(timer); };
			}, [sessionId]);
			return state;
		}

		/** 子会话合计金额（元）；没有或为 0 时返回 0。 */
		function subtreeTotal(state) {
			if (state === null || state === undefined || !state.descendants) return 0;
			const value = Number(state.descendants.costCny);
			return Number.isFinite(value) && value > 0 ? value : 0;
		}

		/** 输入框下方的费用条目：总额 + 实时谷/峰徽标，点击打开明细弹层。 */
		function CostPill(props) {
			const useProjection = props.useProjection;
			const t = props.t;
			const view = useProjection('costUsage');
			// 子会话费用：宿主按会话树汇总（含已结束的子代理）
			const subtree = useSubtreeCost(props.sessionId);
			const [open, setOpen] = useState(false);
			const anchorRef = useRef(null);
			const panelRef = useRef(null);
			const pos = useCostPanelPosition(open, anchorRef, panelRef);
			useCostDismiss(open, setOpen, anchorRef, panelRef);

			if (view === undefined) return null;
			const subTotal = subtreeTotal(subtree);
			// 只看自己的投影时"零调用"就不显示；但只有子会话花钱时也要显示
			if (view.pricedRequests + view.unpricedRequests === 0 && subTotal === 0) return null;
			const peak = isPeakNow();
			const period = peak ? t('dialog.periodPeak') : t('dialog.periodOffPeak');
			const totalText = fmtCost(view.totalCny + subTotal);
			// 与看板同一套防御：容器必须是真实 DOM 元素，否则 createPortal 抛 #200
			const costContainer = portalContainer();
			return react.createElement('div', { className: 'dsh-cost-root' },
				react.createElement('span', { ref: anchorRef, className: 'dsh-cost-anchor' },
					react.createElement('button', {
						type: 'button',
						className: 'dsh-cost-pill',
						'aria-haspopup': 'dialog',
						'aria-expanded': open,
						'aria-label': t('pill.aria', { amount: totalText, period }),
						onClick: () => { setOpen(!open); },
					},
					react.createElement(CostIcon),
					react.createElement('span', null,
						t('pill.label', { amount: totalText }),
						react.createElement('span', { className: 'dsh-cost-sep', 'aria-hidden': true }, '·'),
						react.createElement('span', { className: 'dsh-cost-badge', 'data-peak': String(peak) },
							peak ? t('pill.peak') : t('pill.offPeak')))),
					// 容器不可用时退回内联（面板是 position:fixed，pos 已算好绝对坐标）
					open && (costContainer === null
						? react.createElement(CostDialog, { view, subtree, t, panelRef, pos })
						: createPortal(react.createElement(CostDialog, { view, subtree, t, panelRef, pos }), costContainer))));
		}

		/** 每条回复动作行里的本轮费用 pill（与官方"用量 X tok"同排）。 */
		function TurnCostPill(props) {
			const useProjection = props.useProjection;
			const t = props.t;
			const view = useProjection('costUsage');
			// 本轮派发出去的子代理，其开销归到"派发它的那一轮"（宿主按会话树归集）
			const subtree = useSubtreeCost(props.sessionId);
			const [open, setOpen] = useState(false);
			const anchorRef = useRef(null);
			const panelRef = useRef(null);
			const pos = useCostPanelPosition(open, anchorRef, panelRef);
			useCostDismiss(open, setOpen, anchorRef, panelRef);

			const turn = view === undefined || view.messageTurns === undefined
				? undefined
				: view.messageTurns[String(props.messageId)];
			const row = turn === undefined || !Array.isArray(view.byTurn)
				? undefined
				: view.byTurn.find((item) => item.turn === turn);
			const subTurn = turn === undefined || subtree === null || subtree === undefined || !subtree.byTurn
				? undefined
				: subtree.byTurn[String(turn)];
			const subTotal = subTurn ? Number(subTurn.costCny) || 0 : 0;
			// 本轮自己没有计费调用、但派发过子代理时也要显示
			const base = row === undefined
				? { cacheReadCny: 0, missCny: 0, outputCny: 0, peakCny: 0, offPeakCny: 0, totalCny: 0 }
				: row;
			const total = base.totalCny + subTotal;
			if (!(total > 0)) return null;
			const totalText = fmtCost(total);
			const peak = isPeakNow();
			const period = peak ? t('dialog.periodPeak') : t('dialog.periodOffPeak');
			const turnContainer = portalContainer();
			const turnRows = [
				costRow(t('dialog.cacheRead'), fmtCost(base.cacheReadCny), 'hit'),
				costRow(t('dialog.miss'), fmtCost(base.missCny), 'miss'),
				costRow(t('dialog.output'), fmtCost(base.outputCny), 'out'),
				costRow(t('dialog.peak'), fmtCost(base.peakCny), 'peak'),
				costRow(t('dialog.offPeak'), fmtCost(base.offPeakCny), 'off'),
			];
			if (subTotal > 0) turnRows.push(costRow(t('dialog.subtree'), fmtCost(subTotal), 'subtree'));
			const turnPanel = react.createElement('div', {
				ref: panelRef,
				className: 'dsh-cost-panel',
				role: 'dialog',
				'aria-label': t('turn.title'),
				style: pos ?? { visibility: 'hidden', left: 0, top: 0 },
			},
			react.createElement('div', { className: 'dsh-cost-title' },
				react.createElement('span', { className: 'dsh-cost-title-label' }, react.createElement(CostIcon), t('turn.title')),
				react.createElement('span', { className: 'dsh-cost-total' }, totalText)),
			react.createElement('div', { className: 'dsh-cost-rule', 'aria-hidden': true }),
			react.createElement('dl', { className: 'dsh-cost-details' }, turnRows),
			react.createElement('div', { className: 'dsh-cost-note' }, period),
			subTotal > 0
				? react.createElement('div', { className: 'dsh-cost-note' }, t('dialog.turnSubtreeNote'))
				: null,
			react.createElement('div', { className: 'dsh-cost-note' }, t('dialog.note')));
			return react.createElement('span', { ref: anchorRef, className: 'dsh-cost-turn-root' },
				react.createElement('button', {
					type: 'button',
					className: 'dsh-cost-turn-trigger',
					'aria-haspopup': 'dialog',
					'aria-expanded': open,
					'aria-label': t('turn.aria', { amount: totalText }),
					onClick: () => { setOpen(!open); },
				},
				react.createElement(CostIcon),
				react.createElement('span', { className: 'dsh-cost-turn-label' }, t('turn.label', { amount: totalText }))),
				open && (turnContainer === null ? turnPanel : createPortal(turnPanel, turnContainer)));
		}

		// ============================================================================
		// 插件主体（Cordis 插件三件套：name / inject / apply）
		// ============================================================================
		const name = 'pet';        // 插件行 id（与 cordis.patch.yml 一致）
		const inject = ['slots', 'locale'];  // 需要注入的服务：slots（槽位）、locale（费用条目文案）

		// apply：插件被激活时调用
		function apply(ctx, config) {
			// 官方"叠加式"注册模式：
			// slots.inject 等 shell.overlay 槽位被声明后，再注册我们的条目。
			// 用 generator + yield 形式（与官方 dsh-client-ui-directory-picker-native 一致），
			// 这样不会替换其他条目，而是以 id='pet' 叠加进列表槽。
			ctx.slots.inject('shell.overlay', function* () {
				yield ctx.slots.register({
					name: 'shell.overlay',
					id: 'pet',       // 列表槽的条目 id（唯一）
					order: 1000,     // 排序（大 = 靠后渲染）
				}, (ownerProps) => h(Pet, { config, ...ownerProps }));
			});

			// 本 fork 新增：设置面板（DSH 设置 → 桌宠配置）
			ctx.slots.inject('settings.section', function* () {
				yield ctx.slots.register({
					name: 'settings.section',
					id: 'whale-pet',
					order: 30,
					label: '桌宠配置',
				}, PetSettingsSection);
			});

			// 本 fork 新增：输入框下方的会话费用条目（读宿主 costUsage 投影）
			ctx.effect(() => ctx.locale.register(COST_NS, { zh: COST_ZH, en: COST_EN }), 'whale-pet: cost dictionaries');
			ctx.slots.inject('conversation.composer.dock', function* () {
				yield ctx.slots.register({
					name: 'conversation.composer.dock',
					id: 'whale-pet-cost',
					order: 5,
					locale: COST_NS,
				}, CostPill);
			});

			// 本 fork 新增：每条回复动作行里的"本轮费用"（与官方"用量 X tok"同排）
			ctx.slots.inject('conversation.chat.assistant-actions', function* () {
				yield ctx.slots.register({
					name: 'conversation.chat.assistant-actions',
					id: 'whale-pet-cost-turn',
					order: 50,
					locale: COST_NS,
				}, TurnCostPill);
			});
		}

		// 导出插件三件套（Cordis Loader 需要）
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
