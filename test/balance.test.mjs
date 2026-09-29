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
import { shapeBalance } from '../lib/balance.js';

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
