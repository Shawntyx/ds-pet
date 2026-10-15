// 持久化链路的集成测试：把 electron 换成假的（只提供 app.getPath），
// 然后真的走一遍"写聊天记录 → 重启读回来 → 加记忆 → 敏感信息被拦 → 拼注入文本"，
// 用的是真实文件和真实 JSON 往返，而不是内存里的假对象。
//
// 为什么单独一个文件：模块顶层的 require 会缓存 electron，所以必须在 require chatStore/memory
// 之前把假 electron 装进 require.cache。node --test 每个文件一个进程，不会影响别的测试。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-test-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => tmpUserData } },
};

const chatStore = require('../dist/main/chatStore');
const memory = require('../dist/main/memory');

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('聊天记录：写入落盘、"重启"后读回来', () => {
  chatStore.initChatStore();
  for (let i = 1; i <= 5; i++) {
    chatStore.appendMessage({ role: 'user', content: `第 ${i} 句提问` });
    chatStore.appendMessage({ role: 'assistant', content: `第 ${i} 句回答` });
  }
  chatStore.flushChatStore();

  const file = chatStore.historyFilePath();
  assert.ok(file.startsWith(tmpUserData), '应该写在（假的）userData 目录下');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).messages.length, 10);

  // 模拟重启：重新初始化，应该从磁盘读回来
  chatStore.initChatStore();
  assert.equal(chatStore.getStoredMessages().length, 10);
  assert.equal(chatStore.getStoredMessages()[9].content, '第 5 句回答');

  const recent = chatStore.recentRounds(chatStore.getStoredMessages(), 2);
  assert.equal(recent.length, 4);
  assert.equal(recent[0].role, 'user');
});

test('请求失败撤回的用户消息不会留在文件里', () => {
  chatStore.appendMessage({ role: 'user', content: '这句会失败' });
  chatStore.dropLastMessage();
  chatStore.flushChatStore();
  assert.equal(chatStore.getStoredMessages().length, 10);
  assert.equal(JSON.parse(fs.readFileSync(chatStore.historyFilePath(), 'utf-8')).messages.length, 10);
});

test('长期记忆：敏感信息和重复项都进不了文件', () => {
  memory.initMemoryStore();
  const created = memory.addFacts([
    '用户在学数据结构，下周要交实验报告',
    '用户的密码是 abc12345',
    '用户在学数据结构，下周要交实验报告',
    '用户的 API Key 是 sk-abcdefghijklmn',
  ]);
  assert.equal(created.length, 1);
  assert.equal(memory.addFacts(['用户喜欢喝冰美式，晚上不喝咖啡']).length, 1);

  memory.flushMemoryStore();
  const file = memory.memoryFilePath();
  const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.equal(saved.facts.length, 2);
  assert.ok(!/abc12345|sk-abcdefghijklmn|密码|API Key/.test(JSON.stringify(saved)), '敏感信息不该出现');
});

test('长期记忆：注入文本包含记忆内容，重启后不丢', () => {
  const section = memory.memorySection();
  assert.ok(section.startsWith('【你记得的关于用户的事】'));
  assert.ok(section.includes('用户喜欢喝冰美式'));
  assert.ok(section.includes('数据结构'));

  memory.initMemoryStore();
  assert.equal(memory.factCount(), 2);
});

test('长期记忆：单条删除和清空都会同步到文件', () => {
  const firstId = memory.getFacts()[0].id;
  assert.equal(memory.deleteFact(firstId), true);
  assert.equal(memory.factCount(), 1);

  assert.equal(memory.clearFacts(), 1);
  memory.flushMemoryStore();
  assert.equal(memory.factCount(), 0);
  assert.equal(JSON.parse(fs.readFileSync(memory.memoryFilePath(), 'utf-8')).facts.length, 0);
});
