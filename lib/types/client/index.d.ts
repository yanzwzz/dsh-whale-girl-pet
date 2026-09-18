/**
 * ============================================================================
 * dsh-whale-girl-pet 浏览器半侧类型声明（TypeScript）
 * ============================================================================
 *
 * 【用途】
 *   给 lib/client.js（浏览器半侧）提供类型信息。纯类型文件，不影响运行时。
 *
 * 【对应实现】
 *   lib/client.js 注册四个槽位条目：
 *     - shell.overlay                      桌宠本体（动画 / 气泡 / 按钮组，含 📊 看板与弹窗）
 *     - settings.section                   设置 → 桌宠配置
 *     - conversation.composer.dock         输入框下方的会话费用 pill
 *     - conversation.chat.assistant-actions 每条回复动作行里的本轮费用 pill
 *
 *   数据看板（分时段花费）不走槽位：它由 shell.overlay 里的 📊 按钮触发，
 *   弹窗 portal 到 document.body，位置/尺寸由 useDashboardLayout 管理
 *   （默认 720×480 视口居中，可拖动/缩放，记忆存 localStorage）。
 *
 * 【注意】
 *   当前 DSH 客户端配置管线尚未打通，apply 实际收到的 config 是空对象；
 *   桌宠参数（size/position 等）以代码默认值为准。
 *
 * ============================================================================
 * @module dsh-whale-girl-pet/client
 */
import type { Context } from '@deepseek-ai/cordis';

/** Cordis 插件名（loader 诊断用），与 lib/client.js 的 name 一致。 */
export declare const name = 'pet';

/** 需要注入的服务，与 lib/client.js 的 inject 一致。 */
export declare const inject: readonly ['slots', 'locale'];

/** 插件配置（当前实际为空对象，见文件头说明）。 */
export interface Config {
    /** 宠物显示高度（px）。默认 260。 */
    size?: number;
    /** 默认角落：'bottom-right' | 'bottom-left'。默认 'bottom-right'。 */
    position?: 'bottom-right' | 'bottom-left';
}

/**
 * 客户端插件主体：注册桌宠、设置面板与费用 pill 的槽位条目。
 * @param ctx - 客户端根上下文（ctx.slots / ctx.locale）
 * @param config - 本行配置（来自 patch 树；当前实际为空对象）
 */
export declare function apply(ctx: Context, config: Config): void;
