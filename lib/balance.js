/**
 * ============================================================================
 * lib/balance.js —— DeepSeek 余额响应整形（纯函数、零依赖、可单测）
 * ============================================================================
 *
 * 【为什么单独成模块】
 *   和天气一样：旧实现把整段逻辑写成 Windows PowerShell 脚本经 `shell` 执行，
 *   在 Linux/macOS（bash）上必然失败（issue #2）。网络请求现在由 index.js 用
 *   Node 的全局 fetch 直接发，这里只负责把官方响应整形成既有字段结构。
 *
 * 【契约】成功返回 `{ ok:true, currency, total, granted, topped }`，
 * 失败返回 `{ ok:false, error }`；字段名与旧 PowerShell 输出逐字一致，
 * 浏览器半侧（`/api/whale-balance` 的消费方）无需改动。
 */

/**
 * 整形官方 `GET /user/balance` 的响应。
 * 空字符串按缺省处理（`||` 而非 `??`），与旧实现的 `[string]$b.currency` + 调用侧
 * `String(data.currency || 'CNY')` 行为一致。
 * @param json - 官方接口返回的 JSON。
 * @returns `{ ok:true, currency, total, granted, topped }` 或 `{ ok:false, error }`。
 */
export function shapeBalance(json) {
  const info = json !== null && json !== undefined && Array.isArray(json.balance_infos)
    ? json.balance_infos[0]
    : undefined;
  if (info === null || info === undefined) return { ok: false, error: '账户余额不可用或响应格式未知' };
  return {
    ok: true,
    currency: String(info.currency || 'CNY'),
    total: String(info.total_balance || '0'),
    granted: String(info.granted_balance || '0'),
    topped: String(info.topped_up_balance || '0'),
  };
}
