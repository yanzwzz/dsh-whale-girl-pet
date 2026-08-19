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
		let { useEffect, useRef, useState } = react;
		// jsx 是 React 18 的新 JSX 转换函数，这里起个别名 h 方便书写
		let { jsx: h } = require('react/jsx-runtime');

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
			const activityRef = useRef('');             // 当前工具名（打字气泡展示）
			const workingAvailRef = useRef(null);       // 已探测存在的工作动画池（null=未探测）
			const workingTimerRef = useRef(null);       // 工作轮播切换定时器
			const sleepRef = useRef(false);             // 是否处于睡眠态（镜像）
			const lastActivityAtRef = useRef(Date.now()); // 最近一次活动时间戳
			const timeAnimAtRef = useRef(0);            // 上次时间感知动画的时间戳
			const lunchDoneRef = useRef('');            // 已吃过午饭的日期（YYYY-M-D）
			const [weatherLoading, setWeatherLoading] = useState(false); // 天气按钮加载中
			const feedAtRef = useRef(0);                // 喂食冷却时间戳
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
					// 本 fork 新增：☁️/💰/🍪 按钮挂在宠物身上（跟随漫游/拖拽一起移动）；
					// 查询结果通过 onResult 汇入宠物头顶的统一气泡（与任务通知共用位置）
					// 本 fork：按钮组位置跟随设置（左侧默认 / 右侧）
					react.createElement('div', { className: 'wb-stack' + (((settingsRef.current || {}).buttonSide === 'right') ? ' wb-stack-right' : '') },
						react.createElement(WeatherButton, { loading: weatherLoading, onClick: handleWeather }),
						react.createElement(BalanceButton, { onResult: (r) => showBubble(r), onPlay: () => playAction('翻钱包') }),
						react.createElement(FeedButton, { onClick: handleFeed }),
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
		function IconButton({ icon, title, loading, onClick }) {
			return react.createElement('button', {
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
						const cost = Number(usage.costCny) || 0;
						lines.push('今日花费 ' + (cost > 0 && cost < 0.01 ? '<¥0.01' : '≈¥' + cost.toFixed(2)));
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
					react.createElement('div', { style: S_ROW }, '按钮位置（☁️💰🍪）', react.createElement('div', { style: { display: 'flex', gap: 6 } },
						[['left', '左侧'], ['right', '右侧']].map(([v, label]) => react.createElement('button', {
							key: v,
							style: Object.assign({}, S_BTN, (s.buttonSide === undefined ? 'left' : s.buttonSide) === v ? S_BTN_ON : null),
							onClick: () => save([{ op: 'set', path: ['buttonSide'], value: v }]),
						}, label)))),
					react.createElement('div', { style: S_ROW }, '长任务提醒阈值（分钟）', numberInput('longTaskMinutes', 10)),
					react.createElement('div', { style: S_ROW }, '天气城市（留空=自动定位）', textInput('city')),
					msg ? react.createElement('div', { style: { fontSize: 12, color: '#2e7d4f', marginTop: 8 } }, msg) : null,
					busy ? react.createElement('div', { style: { fontSize: 12, color: '#55627c', marginTop: 4 } }, '保存中…') : null,
				),
			);
		}

		// ============================================================================
		// 插件主体（Cordis 插件三件套：name / inject / apply）
		// ============================================================================
		const name = 'pet';        // 插件行 id（与 cordis.patch.yml 一致）
		const inject = ['slots'];  // 需要注入的服务：slots（槽位注册表）

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
		}

		// 导出插件三件套（Cordis Loader 需要）
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
