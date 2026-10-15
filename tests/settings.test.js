// 默认配置和互动区域的回归测试：这些数值来自 ASSETS.md / SPEC，
// 不小心的"顺手改一下默认值"很容易没人发现，这里锁住。
const test = require('node:test');
const assert = require('node:assert');

const { DEFAULT_SETTINGS, DEFAULT_ZONES } = require('../dist/shared/types');

test('互动区域坐标与 ASSETS.md §0 一致', () => {
  assert.deepEqual(DEFAULT_ZONES.tail, { x: 0.0, y: 0.78, w: 1.0, h: 0.22 });
  assert.deepEqual(DEFAULT_ZONES.belly, { x: 0.18, y: 0.45, w: 0.64, h: 0.33 });
  assert.deepEqual(DEFAULT_ZONES.head, { x: 0.2, y: 0.0, w: 0.6, h: 0.45 });
});

test('主动说话默认间隔是用户手动定的 10 分钟', () => {
  assert.equal(DEFAULT_SETTINGS.proactive.avgIntervalMinutes, 10);
});

test('默认值都在合理范围内', () => {
  assert.ok(DEFAULT_SETTINGS.afkAfterMinutes >= 1);
  assert.ok(DEFAULT_SETTINGS.balanceWarnThreshold >= 0);
  assert.ok(DEFAULT_SETTINGS.proactive.avgIntervalMinutes >= 1);
  assert.equal(DEFAULT_SETTINGS.baseURL, 'https://api.deepseek.com');
  assert.equal(DEFAULT_SETTINGS.model, 'deepseek-chat');
});

test('主动说话三个开关默认都开着，但勿扰默认关着', () => {
  assert.equal(DEFAULT_SETTINGS.proactive.enabled, true);
  assert.equal(DEFAULT_SETTINGS.proactive.healthReminder, true);
  assert.equal(DEFAULT_SETTINGS.proactive.windowTitleRoast, true);
  assert.equal(DEFAULT_SETTINGS.proactive.randomQuestion, true);
  assert.equal(DEFAULT_SETTINGS.doNotDisturb, false);
});
