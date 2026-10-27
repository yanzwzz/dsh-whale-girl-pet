/**
 * ============================================================================
 * dsh-whale-girl-pet 宿主半侧类型声明（TypeScript）
 * ============================================================================
 *
 * 【用途】
 *   给 lib/index.js（宿主半侧）提供类型信息。纯类型文件，不影响运行时。
 *
 * 【对应实现】
 *   lib/index.js —— 注册 /pet 动画路由、/api/whale-* 接口、桌宠设置命名空间，
 *   注册 `whalePetCost` 会话投影（费用 pill 读取），并驱动分时段用量账本
 *   （lib/usage-ledger.js，供 /api/whale-pet/usage 看板读取）。
 *
 * 【HTTP 接口一览】
 *   GET  /pet/thumb/<动画名>.webm     360×360 播放动画（随包）
 *   GET  /pet/full/<动画名>.webm      原始母版（$DSH_HOME/pet-assets，可选）
 *   GET  /api/whale-pet/state         任务状态/通知队列 + 当前设置（浏览器轮询）
 *   GET  /api/whale-balance           余额 + 今日用量（API Key 优先，账号登录兜底）
 *   GET  /api/whale-pet/weather       明日天气
 *   GET  /api/whale-pet/usage         分时段用量看板数据（?hours=1..24&days=1..30）
 *   GET  /api/whale-pet/subtree-cost  子会话费用汇总（?session=<id>）
 *   GET  /api/whale-pet/settings       读设置
 *   POST /api/whale-pet/settings       改设置（ops 补丁；只收 application/json）
 *
 *   每条路由都会先调 DSH Connection 的 `requestRejection`（Host/Origin fence +
 *   浏览器会话认证）；取不到 connection 服务时跳过，由所在组合负责认证策略。
 *
 * ============================================================================
 * @module dsh-whale-girl-pet
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';

/** Cordis 插件名（loader 诊断用），与 lib/index.js 的 name 一致。 */
export declare const name = 'pet';

/**
 * 需要注入的服务，与 lib/index.js 的 inject 一致。
 * `sessions` 与 `sessionPersistence` 供分时段账本补扫历史用量；
 * 若 patch 树里移除了 `sessionPersistence`，插件仍能加载（可选取得），
 * 看板退化为"仅本次运行实时统计"。
 */
export declare const inject: readonly [
    'webServer',
    'settings',
    'sessionProjections',
    'sessions',
    'sessionPersistence',
];

/** 桌宠配置（schema 里的 volatile 字段会出现在 DSH 设置表单里，改完即时生效）。 */
export interface Config {
    /** 番茄钟提醒开关。默认 true。 */
    pomodoro?: boolean;
    /** 番茄钟间隔（分钟，5-120）。默认 25。 */
    pomodoroMinutes?: number;
    /** 深夜关怀（23:00-05:00 提醒）。默认 true。 */
    lateNight?: boolean;
    /** 随机小剧场。默认 true。 */
    chatter?: boolean;
    /** 长任务提醒阈值（分钟，1-60）。默认 10。 */
    longTaskMinutes?: number;
    /** 天气城市；留空表示自动定位。默认 ''。 */
    city?: string;
    /** 宠物显示高度（px，40-400）。默认 260。 */
    size?: number;
    /** 默认角落：'bottom-right' | 'bottom-left'。默认 'bottom-right'。 */
    position?: string;
    /** 固定位置的视口像素坐标（外框左上角）；两个都有才生效，否则跟随 position 角落。 */
    posX?: number;
    /** 固定位置的视口像素坐标（外框左上角）；两个都有才生效，否则跟随 position 角落。 */
    posY?: number;
    /** 漫游走动开关。默认 true。 */
    roam?: boolean;
    /** 只隐藏宠物本体（动画暂停、不漫游、不响应点击），按钮与费用显示照旧。默认 false。 */
    hidden?: boolean;
    /** 按钮组三态：'left' | 'right' | 'off'。默认 'left'。 */
    buttonSide?: string;
    /** 提醒类气泡总开关（完成/失败、回来汇总、天气/余额/喂食、番茄钟等）。默认 true。 */
    bubbleNotice?: boolean;
    /** 工作输出气泡（干活时头顶逐字打出的当前动作）。默认 true。 */
    bubbleWork?: boolean;
    /**
     * 看板：启动时补扫已落盘会话（含重启前的用量）。默认 true。
     * 关掉则只统计本次运行实时折叠到的用量。
     */
    dashboardHistory?: boolean;
    /** 看板：保留并展示的日趋势天数（1-30）。默认 7。 */
    dashboardWindowDays?: number;
    /** 会话费用 pill（输入框下方）。默认 true。 */
    costPillSession?: boolean;
    /** 本轮费用 pill（每条回复动作行）。默认 true。 */
    costPillTurn?: boolean;
    /** 任务完成气泡里的花费与三桶（只影响显示）。默认 true。 */
    costInBubble?: boolean;
    /** 💰 余额按钮。默认 true。 */
    costBalanceButton?: boolean;
    /** 📊 分时段花费看板。默认 true。 */
    costDashboard?: boolean;
    /** 后台完成时给标签页打角标。默认 true。 */
    notifyBadge?: boolean;
    /** 回到前台时用气泡报一份期间总账。默认 true。 */
    notifySummary?: boolean;
    /** 后台完成时响提示音。默认 true。 */
    notifySound?: boolean;
    /** 提示音音量（0-100）。默认 60。 */
    notifySoundVolume?: number;
    /** "full"（原始 1200×1200）资源的根目录；代码读取，不属于设置表单字段。 */
    fullRoot?: string;
}

/**
 * 宿主插件主体：注册动画路由、接口、设置命名空间、`whalePetCost` 投影与分时段账本。
 * @param ctx - 插件上下文；ctx.webServer / ctx.settings / ctx.sessionProjections
 * @param config - 本行配置（来自 patch 树）
 */
export declare function apply(ctx: Context, config: Config): void;

export type { WebRoute };
