/**
 * dsh-whale-girl-pet 余额整形单测（lib/balance.js）
 *
 * 余额查询在 issue #2 里和天气一起被改成宿主 Node 直连，整形逻辑抽到这里。
 * 这里锁住的是「官方响应 → 既有字段结构」的映射，包括空串与缺字段的兜底：
 * 字段名一旦变化，浏览器半侧的余额气泡会直接读到 undefined。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeAccountBalance, shapeBalance } from '../lib/balance.js';

test('shapeBalance：正常响应整形为既有字段结构', () => {
  assert.deepEqual(shapeBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' }],
  }), {
    ok: true,
    currency: 'CNY',
    total: '12.34',
    granted: '2.00',
    topped: '10.34',
  });
});

test('shapeBalance：多币种时取第一条（与旧实现一致）', () => {
  const out = shapeBalance({
    balance_infos: [
      { currency: 'CNY', total_balance: '1.00', granted_balance: '0', topped_up_balance: '1.00' },
      { currency: 'USD', total_balance: '0.14', granted_balance: '0', topped_up_balance: '0.14' },
    ],
  });
  assert.equal(out.currency, 'CNY');
  assert.equal(out.total, '1.00');
});

test('shapeBalance：缺字段/空串按旧实现的 || 语义兜底', () => {
  assert.deepEqual(shapeBalance({ balance_infos: [{}] }), {
    ok: true,
    currency: 'CNY',
    total: '0',
    granted: '0',
    topped: '0',
  });
  assert.deepEqual(shapeBalance({ balance_infos: [{ currency: '', total_balance: '', granted_balance: '', topped_up_balance: '' }] }), {
    ok: true,
    currency: 'CNY',
    total: '0',
    granted: '0',
    topped: '0',
  });
  // 数字型字段也接受（官方未来若返回 number，不应变成 "undefined"）
  assert.equal(shapeBalance({ balance_infos: [{ total_balance: 3.5 }] }).total, '3.5');
});

test('shapeBalance：余额不可用时给出与旧实现一致的错误文案', () => {
  const expected = { ok: false, error: '账户余额不可用或响应格式未知' };
  assert.deepEqual(shapeBalance({}), expected);
  assert.deepEqual(shapeBalance({ balance_infos: [] }), expected);
  assert.deepEqual(shapeBalance({ balance_infos: 'oops' }), expected);
  assert.deepEqual(shapeBalance(undefined), expected);
});

// ============================================================================
// 账号登录路径（DSH deepseekAccount 的开放平台钱包）
// ============================================================================

test('shapeAccountBalance：充值 + 赠金钱包映射成既有字段（与官方 /user/balance 同口径）', () => {
  assert.deepEqual(shapeAccountBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '10.50' }],
    bonusWallets: [{ currency: 'CNY', balance: '2.25' }],
  }), {
    ok: true,
    currency: 'CNY',
    total: '12.75',
    granted: '2.25',
    topped: '10.50',
  });
});

test('shapeAccountBalance：平台金额是长小数，显示统一成两位（四舍五入）', () => {
  const out = shapeAccountBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '93.4472366400000000' }],
    bonusWallets: [{ currency: 'CNY', balance: '0' }],
  });
  assert.equal(out.total, '93.45');
  assert.equal(out.topped, '93.45');
  assert.equal(out.granted, '0.00');
});

test('shapeAccountBalance：多币种优先人民币（与官方接口取第一条的行为一致）', () => {
  const out = shapeAccountBalance({
    status: 'ready',
    value: [
      { currency: 'USD', balance: '1.00' },
      { currency: 'CNY', balance: '2.00' },
    ],
    bonusWallets: [],
  });
  assert.equal(out.currency, 'CNY');
  assert.equal(out.total, '2.00');
});

test('shapeAccountBalance：没有充值钱包但赠金钱包有余额，也要算进 total', () => {
  assert.deepEqual(shapeAccountBalance({
    status: 'ready',
    value: [],
    bonusWallets: [{ currency: 'CNY', balance: '5.00' }],
  }), {
    ok: true,
    currency: 'CNY',
    total: '5.00',
    granted: '5.00',
    topped: '0.00',
  });
});

test('shapeAccountBalance：未登录 / 平台失败 / 空钱包给出明确错误', () => {
  assert.deepEqual(shapeAccountBalance(null), { ok: false, error: '未登录 DeepSeek 账号' });
  assert.deepEqual(shapeAccountBalance({ status: 'failed' }), {
    ok: false,
    error: 'DeepSeek 账号余额查询失败（开放平台暂时不可用）',
  });
  const expected = { ok: false, error: '账户余额不可用或响应格式未知' };
  assert.deepEqual(shapeAccountBalance({ status: 'ready', value: [] }), expected);
  assert.deepEqual(shapeAccountBalance({ status: 'ready', value: 'oops' }), expected);
  assert.deepEqual(shapeAccountBalance({ status: 'ready', value: [{}] }), expected);
});
