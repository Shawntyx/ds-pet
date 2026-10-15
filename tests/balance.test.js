// 余额接口响应的解析：field 缺失、余额真的是 0、货币是美元等边界。
const test = require('node:test');
const assert = require('node:assert');

const {
  parseBalancePayload,
  pickPrimaryInfo,
  describeBalanceForModel,
  formatBalanceBrief,
  formatBalanceDetail,
  formatBalanceSpeech,
  formatBalanceForSettings,
} = require('../dist/main/balance');

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
  // 措辞和设置页/气泡共用 formatBalanceDetail，所以是"（充值 … + 赠金 …）"
  assert.ok(text.includes('充值 ¥10.34'));
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

// —— 多币种：真实接口会同时返回 CNY 和 USD 两条，而且顺序不固定。
// 之前直接取 [0]，碰上美元那条在前就显示 0（用户实际踩到"有时候查到 0"）。
const cny = { currency: 'CNY', total_balance: '9.68', granted_balance: '0.39', topped_up_balance: '9.28' };
const usdZero = { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' };

test('人民币在前：取人民币', () => {
  const result = parseBalancePayload({ balance_infos: [cny, usdZero] });
  assert.equal(result.currency, 'CNY');
  assert.equal(result.total, 9.68);
});

test('美元在前（金额为 0）：仍然取人民币，不能显示成 0', () => {
  const result = parseBalancePayload({ balance_infos: [usdZero, cny] });
  assert.equal(result.currency, 'CNY');
  assert.equal(result.total, 9.68);
  assert.equal(result.granted, 0.39);
  assert.equal(result.toppedUp, 9.28);
});

test('两个币种都有余额时优先人民币', () => {
  const result = parseBalancePayload({
    balance_infos: [
      { currency: 'USD', total_balance: '2.00' },
      { currency: 'CNY', total_balance: '9.68' },
    ],
  });
  assert.equal(result.currency, 'CNY');
  assert.equal(result.total, 9.68);
});

test('确实都是 0 时如实报 0（不能当成查不到）', () => {
  const result = parseBalancePayload({ balance_infos: [usdZero] });
  assert.equal(result.total, 0);
  assert.equal(result.currency, 'USD');
});

test('pickPrimaryInfo 对空数组返回 undefined', () => {
  assert.equal(pickPrimaryInfo([]), undefined);
});

test('三个格式化函数：数字一致，措辞分场景', () => {
  const view = {
    ok: true,
    supported: true,
    currency: 'CNY',
    total: 9.68,
    granted: 0.39,
    toppedUp: 9.28,
    fetchedAt: Date.now(),
    error: null,
    low: false,
  };
  assert.equal(formatBalanceBrief(view), '¥9.68');
  assert.equal(formatBalanceDetail(view), '¥9.68（充值 ¥9.28 + 赠金 ¥0.39）');
  assert.ok(formatBalanceSpeech(view).includes('¥9.68'));
  assert.ok(formatBalanceSpeech(view).includes('还够'));
  assert.equal(formatBalanceForSettings(view), '¥9.68（充值 ¥9.28 + 赠金 ¥0.39）');
});

test('余额偏低时措辞变成提醒', () => {
  const view = {
    ok: true,
    supported: true,
    currency: 'CNY',
    total: 1,
    granted: 0,
    toppedUp: 1,
    fetchedAt: Date.now(),
    error: null,
    low: true,
  };
  assert.ok(formatBalanceSpeech(view).includes('只剩'));
  assert.ok(formatBalanceSpeech(view).includes('充值'));
});

test('查不到余额时三个函数都给一句人话（而不是 0 或 undefined）', () => {
  const unsupported = {
    ok: false,
    supported: false,
    currency: null,
    total: null,
    granted: null,
    toppedUp: null,
    fetchedAt: null,
    error: '这个服务没有余额查询接口',
    low: false,
  };
  assert.ok(formatBalanceBrief(unsupported).includes('不支持'));
  assert.ok(formatBalanceSpeech(unsupported).includes('查不到'));
  assert.ok(formatBalanceForSettings(unsupported).includes('不支持'));

  const failed = { ...unsupported, supported: true, error: '查询超时（网络或服务端没响应）' };
  assert.ok(formatBalanceBrief(failed).includes('查询超时'));
  assert.ok(formatBalanceSpeech(failed).includes('查询超时'));
});

test('有旧数字但这次查询失败：设置页会说明"这是上次的数"', () => {
  const stale = {
    ok: false,
    supported: true,
    currency: 'CNY',
    total: 9.68,
    granted: 0.39,
    toppedUp: 9.28,
    fetchedAt: Date.now() - 3600_000,
    error: '查询超时（网络或服务端没响应）',
    low: false,
  };
  const text = formatBalanceForSettings(stale);
  assert.ok(text.includes('¥9.68'));
  assert.ok(text.includes('最近一次查询失败'));
});
