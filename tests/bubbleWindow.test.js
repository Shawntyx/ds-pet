// 气泡"什么时候该自动收起"的规则（纯函数）。
// 用户明确要的行为：显示久一点；**回过话的气泡就一直留着**，只能点右上角 × 关掉。
const test = require('node:test');
const assert = require('node:assert');

const { shouldAutoHide } = require('../dist/main/bubbleWindow');

test('普通气泡到点自动收起', () => {
  assert.equal(shouldAutoHide({ pinned: false, streaming: false, focused: false }), true);
});

test('用户回过话（pinned）就不再自动收起', () => {
  assert.equal(shouldAutoHide({ pinned: true, streaming: false, focused: false }), false);
  // 即使焦点跑到别的地方也不收——用户可能正等着看回复
  assert.equal(shouldAutoHide({ pinned: true, streaming: false, focused: true }), false);
});

test('正在流式回复时不收起', () => {
  assert.equal(shouldAutoHide({ pinned: false, streaming: true, focused: false }), false);
});

test('焦点在气泡里（用户在打字）时不收起', () => {
  assert.equal(shouldAutoHide({ pinned: false, streaming: false, focused: true }), false);
});

test('三种原因同时存在也不收起', () => {
  assert.equal(shouldAutoHide({ pinned: true, streaming: true, focused: true }), false);
});
