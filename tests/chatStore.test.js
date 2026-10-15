// 聊天记录的两层截断逻辑（纯函数，不碰文件系统，所以能单独测）。
// 这两处一旦算错，表现是"模型看不到刚才那句话"或者"上下文越来越长"，都不容易一眼发现。
const test = require('node:test');
const assert = require('node:assert');

const { capMessages, recentRounds, MAX_STORED_MESSAGES } = require('../dist/main/chatStore');

const u = (text) => ({ role: 'user', content: text });
const a = (text) => ({ role: 'assistant', content: text });

test('recentRounds 取最近 N 轮，丢掉更早的', () => {
  const list = [u('1'), a('1'), u('2'), a('2'), u('3'), a('3')];
  assert.deepEqual(recentRounds(list, 1), [u('3'), a('3')]);
  assert.deepEqual(recentRounds(list, 2), [u('2'), a('2'), u('3'), a('3')]);
  assert.deepEqual(recentRounds(list, 3), list);
});

test('recentRounds 在历史比 N 轮短时原样返回', () => {
  const list = [u('1'), a('1')];
  assert.deepEqual(recentRounds(list, 20), list);
});

test('recentRounds 不会从 assistant 的消息开头（截断留下的孤儿）', () => {
  // 只剩 [a1, u2, a2] 时，应该从 u2 开始，而不是把 a1 也带上
  const list = [a('旧回复'), u('2'), a('2')];
  assert.deepEqual(recentRounds(list, 2), [u('2'), a('2')]);
});

test('recentRounds 轮数是非法值时兜底成 1 轮，不会返回空', () => {
  const list = [u('1'), a('1'), u('2'), a('2')];
  assert.deepEqual(recentRounds(list, 0), [u('2'), a('2')]);
  assert.deepEqual(recentRounds(list, NaN), [u('2'), a('2')]);
});

test('主动说话插入的 assistant 台词被当成普通历史消息处理', () => {
  // 提醒台词是 assistant 身份：落在窗口里就保留，落在窗口外就跟着旧消息一起丢，
  // 关键是它既不会把用户消息挤出去，也不会让"轮数"算错。
  const reminder = { role: 'assistant', content: '该喝水了' };
  const list = [u('1'), a('1'), u('2'), reminder, a('2')];
  assert.deepEqual(recentRounds(list, 1), [u('2'), reminder, a('2')]);
  assert.deepEqual(recentRounds(list, 3), list);
});

test('capMessages 超出上限时只留最后 limit 条', () => {
  const list = [u('1'), a('1'), u('2'), a('2'), u('3'), a('3')];
  assert.deepEqual(capMessages(list, 4), [u('2'), a('2'), u('3'), a('3')]);
  assert.deepEqual(capMessages(list, 3), [u('3'), a('3')]); // 落在回复上就把孤儿回复丢掉
});

test('capMessages 不超上限时不改动内容', () => {
  const list = [u('1'), a('1')];
  assert.deepEqual(capMessages(list, 10), list);
});

test('空历史不会炸', () => {
  assert.deepEqual(recentRounds([], 5), []);
  assert.deepEqual(capMessages([], 5), []);
});

test('上限常量是正数（防止有人手滑改成 0）', () => {
  assert.ok(MAX_STORED_MESSAGES >= 100);
});
