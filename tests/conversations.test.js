// 对话分段（conversation）的行为锁定：模型只看到当前这段对话，更早的留在文件里给用户翻。
// 这是"她在气泡里主动说话 → 你回复 = 一段新对话"这个交互能成立的基础。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-conv-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { getPath: () => tmpUserData } },
};

const store = require('../dist/main/chatStore');

test.after(() => {
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

test('默认是第 1 段对话，追加的消息都归它', () => {
  store.initChatStore();
  store.clearMessages();
  store.appendMessage({ role: 'user', content: '第一段-1' });
  store.appendMessage({ role: 'assistant', content: '第一段-2' });
  assert.equal(store.currentConversationId(), 1);
  assert.deepEqual(
    store.getConversationMessages().map((m) => m.content),
    ['第一段-1', '第一段-2']
  );
});

test('开新对话后，发给模型的上下文里只剩新对话（更早的还在文件/面板里）', () => {
  const id = store.startNewConversation();
  assert.equal(id, 2);
  store.appendMessage({ role: 'assistant', content: '她的主动说话（新对话开头）' });
  store.appendMessage({ role: 'user', content: '第二段-1' });
  store.appendMessage({ role: 'assistant', content: '第二段-2' });

  assert.deepEqual(
    store.getConversationMessages().map((m) => m.content),
    ['她的主动说话（新对话开头）', '第二段-1', '第二段-2']
  );
  // 面板看到的是全部，并且带对话编号（用来画分隔线）
  assert.equal(store.getStoredMessages().length, 5);
  assert.deepEqual(
    store.getStoredMessages().map((m) => m.conversation),
    [1, 1, 2, 2, 2]
  );
});

test('对话编号会落盘，"重启"后仍然是第 2 段（不会把新对话并回旧的）', () => {
  store.flushChatStore();
  store.initChatStore();
  assert.equal(store.currentConversationId(), 2);
  assert.deepEqual(
    store.getConversationMessages().map((m) => m.content),
    ['她的主动说话（新对话开头）', '第二段-1', '第二段-2']
  );
});

test('重启时末尾没回答的提问照样被清掉（对话分段不影响这个行为）', () => {
  store.appendMessage({ role: 'user', content: '这句没有回答' });
  store.flushChatStore();
  store.initChatStore();
  assert.deepEqual(
    store.getConversationMessages().map((m) => m.content),
    ['她的主动说话（新对话开头）', '第二段-1', '第二段-2']
  );
});

test('再开一段就是第 3 段', () => {
  assert.equal(store.startNewConversation(), 3);
  assert.deepEqual(store.getConversationMessages(), []);
  store.appendMessage({ role: 'user', content: '第三段-1' });
  assert.deepEqual(
    store.getConversationMessages().map((m) => m.content),
    ['第三段-1']
  );
});

test('老版本文件（消息没有 conversation 字段）当成第 1 段读回来', () => {
  const file = store.historyFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      messages: [
        { role: 'user', content: '老数据-1' },
        { role: 'assistant', content: '老数据-2' },
      ],
    }),
    'utf-8'
  );
  store.initChatStore();
  assert.equal(store.currentConversationId(), 1);
  assert.deepEqual(
    store.getConversationMessages().map((m) => m.content),
    ['老数据-1', '老数据-2']
  );
});
