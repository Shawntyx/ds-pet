// 余额接口响应的解析：field 缺失、余额真的是 0、货币是美元等边界。
const test = require('node:test');
const assert = require('node:assert');

const { parseBalancePayload, describeBalanceForModel } = require('../dist/main/balance');

test('正常响应能解析出余额明细', () => {
  const result = parseBalancePayload({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '12.34', granted_balance: '2.00', topped_up_balance: '10.34' },
    ],
  });
  assert.deepEqual(result, { currency: 'CNY', total: 12.34, granted: 2, toppedUp: 10.34 });
});

test('余额为 0 要当成"查到了 0 元"，不是"没查到"', () => {
  const result = parseBalancePayload({
    balance_infos: [{ currency: 'CNY', total_balance: '0', granted_balance: '0', topped_up_balance: '0' }],
  });
  assert.equal(result.total, 0);
  assert.equal(result.error, undefined);
});

test('美元账户', () => {
  const result = parseBalancePayload({
    balance_infos: [{ currency: 'USD', total_balance: '3.5' }],
  });
  assert.equal(result.currency, 'USD');
  assert.equal(result.total, 3.5);
});

test('缺 balance_infos 时给出"不支持/查不到"而不是抛错', () => {
  assert.equal(parseBalancePayload({}).supported, false);
  assert.ok(parseBalancePayload({}).error);
  assert.equal(parseBalancePayload({ balance_infos: [] }).total, undefined);
  assert.equal(parseBalancePayload(null).supported, false);
});

test('余额字段不是数字时不当成 0', () => {
  const result = parseBalancePayload({ balance_infos: [{ total_balance: 'N/A' }] });
  assert.equal(result.total, undefined);
  assert.ok(result.error);
});

test('只给部分字段也不会炸', () => {
  const result = parseBalancePayload({ balance_infos: [{ total_balance: '5' }] });
  assert.equal(result.total, 5);
  assert.equal(result.currency, 'CNY'); // 缺 currency 时按人民币兜底
  assert.equal(result.granted, null);
  assert.equal(result.toppedUp, null);
});

test('给模型看的余额说明：正常情况带上数字和组成', () => {
  const text = describeBalanceForModel({
    ok: true,
    supported: true,
    currency: 'CNY',
    total: 12.34,
    granted: 2,
    toppedUp: 10.34,
    fetchedAt: Date.now(),
    error: null,
    low: false,
  });
  assert.ok(text.includes('¥12.34'));
  assert.ok(text.includes('充值余额 ¥10.34'));
  assert.ok(text.includes('赠金 ¥2.00'));
  assert.ok(text.includes('余额充足'));
});

test('余额偏低时说明里会点出来', () => {
  const text = describeBalanceForModel({
    ok: true,
    supported: true,
    currency: 'CNY',
    total: 1,
    granted: 0,
    toppedUp: 1,
    fetchedAt: Date.now(),
    error: null,
    low: true,
  });
  assert.ok(text.includes('低于'));
});

test('服务不支持余额接口 / 查询失败 / 没配 Key，都说人话而不是抛错', () => {
  const base = { total: null, granted: null, toppedUp: null, fetchedAt: null, low: false };
  assert.ok(
    describeBalanceForModel({ ...base, ok: false, supported: false, currency: null, error: '这个服务没有余额查询接口' }).includes(
      '没有余额查询接口'
    )
  );
  assert.ok(
    describeBalanceForModel({ ...base, ok: false, supported: true, currency: null, error: '还没有设置 API Key' }).includes(
      '还没有设置 API Key'
    )
  );
  assert.ok(
    describeBalanceForModel({ ...base, ok: false, supported: true, currency: null, error: null }).includes('暂时查不到')
  );
});

test('美元账户用 $', () => {
  const text = describeBalanceForModel({
    ok: true,
    supported: true,
    currency: 'USD',
    total: 3.5,
    granted: null,
    toppedUp: null,
    fetchedAt: Date.now(),
    error: null,
    low: false,
  });
  assert.ok(text.includes('$3.50'));
});
