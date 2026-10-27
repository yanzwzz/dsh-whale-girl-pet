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

/** 把钱包金额格式化成官方接口同款的两位小数字符串（如 "93.44"）。 */
function fmtWalletAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * 整形 DSH 账号服务（`ctx.deepseekAccount.getBalance()`）返回的开放平台钱包余额。
 *
 * 【为什么需要它】账号登录（DSH 的 deepseek-account-platform）不产生 API Key，
 * 余额来自 DeepSeek 开放平台的 `get_user_summary`：`normal_wallets`（充值余额）
 * + `bonus_wallets`（赠金余额）。这里把它映射成与 {@link shapeBalance} 完全相同的
 * 字段结构，浏览器半侧无需改动：
 *   - `topped`  = 充值余额（normal_wallets 合计）
 *   - `granted` = 赠金余额（bonus_wallets 合计）
 *   - `total`   = 两者之和（与官方 `/user/balance` 的 total_balance 同口径）
 *
 * @param balance - `AccountDetails['balance']`：
 *   `{ status:'ready', value:[{currency,balance}], bonusWallets:[{currency,balance}] }`，
 *   或 `{ status:'failed' }`、`null`（未登录，由调用方处理）。
 * @returns `{ ok:true, currency, total, granted, topped }` 或 `{ ok:false, error }`。
 */
export function shapeAccountBalance(balance) {
  if (balance === null || balance === undefined) return { ok: false, error: '未登录 DeepSeek 账号' };
  if (balance.status === 'failed') return { ok: false, error: 'DeepSeek 账号余额查询失败（开放平台暂时不可用）' };
  const normal = Array.isArray(balance.value) ? balance.value : undefined;
  if (normal === undefined) return { ok: false, error: '账户余额不可用或响应格式未知' };
  const bonus = Array.isArray(balance.bonusWallets) ? balance.bonusWallets : [];
  const wallets = normal.concat(bonus).filter((wallet) => wallet !== null && wallet !== undefined
    && typeof wallet.currency === 'string' && wallet.currency.length > 0);
  if (wallets.length === 0) return { ok: false, error: '账户余额不可用或响应格式未知' };
  // 桌宠气泡只有一个金额位：与官方 /user/balance 的多币种口径一致，优先人民币；
  // 没有人民币钱包时取第一条钱包的币种（平台页面也是按币种分行的）。
  const currency = wallets.some((wallet) => wallet.currency === 'CNY') ? 'CNY' : wallets[0].currency;
  const sumOf = (rows) => rows
    .filter((wallet) => wallet.currency === currency)
    .reduce((total, wallet) => total + (Number(wallet.balance) || 0), 0);
  const topped = sumOf(normal);
  const granted = sumOf(bonus);
  return {
    ok: true,
    currency,
    total: fmtWalletAmount(topped + granted),
    granted: fmtWalletAmount(granted),
    topped: fmtWalletAmount(topped),
  };
}
