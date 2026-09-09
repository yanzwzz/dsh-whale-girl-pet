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
 *   并注册 `costUsage` 会话投影（供浏览器半侧的费用 pill 读取）。
 *
 * ============================================================================
 * @module dsh-whale-girl-pet
 */
import type { Context } from '@deepseek-ai/cordis';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';

/** Cordis 插件名（loader 诊断用），与 lib/index.js 的 name 一致。 */
export declare const name = 'pet';

/** 需要注入的服务，与 lib/index.js 的 inject 一致。 */
export declare const inject: readonly ['webServer', 'settings', 'sessionProjections'];

/** 桌宠配置（设置面板可改，持久化到 settings.yaml 的 `whale-pet` 段）。 */
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
    /** 漫游走动开关。默认 true。 */
    roam?: boolean;
    /** 按钮组位置：'left' | 'right'。默认 'left'。 */
    buttonSide?: string;
    /** "full"（原始 1200×1200）资源的根目录，默认 `$DSH_HOME/pet-assets`。 */
    fullRoot?: string;
}

/**
 * 宿主插件主体：注册动画路由、接口、设置命名空间与 `costUsage` 投影。
 * @param ctx - 插件上下文；ctx.webServer / ctx.settings / ctx.sessionProjections
 * @param config - 本行配置（来自 patch 树）
 */
export declare function apply(ctx: Context, config: Config): void;

export type { WebRoute };
