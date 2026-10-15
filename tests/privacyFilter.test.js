// 纯函数单元测试：隐私过滤（SPEC 5.3 要求标题里的敏感信息不能发给模型）。
// 跑法：npm test（会先 build，再对 dist/ 里编译出来的 JS 跑 node --test）。
const test = require('node:test');
const assert = require('node:assert');

const { isTitleSensitive, parseFilterWords } = require('../dist/main/privacyFilter');

test('内置黑名单命中就跳过', () => {
  assert.equal(isTitleSensitive('中国银行 - 个人网银'), true);
  assert.equal(isTitleSensitive('Chrome - 无痕模式'), true);
  assert.equal(isTitleSensitive('1Password - password vault'), true);
});

test('大小写不敏感', () => {
  assert.equal(isTitleSensitive('Firefox - INCOGNITO window'), true);
});

test('用户自定义过滤词也生效', () => {
  assert.equal(isTitleSensitive('VS Code - secret-project.ts', ['secret-project']), true);
  assert.equal(isTitleSensitive('VS Code - main.ts', ['secret-project']), false);
});

test('普通标题不该被误判', () => {
  assert.equal(isTitleSensitive('IntelliJ IDEA - A1.java'), false);
  assert.equal(isTitleSensitive('哔哩哔哩 - 学习视频'), false);
});

test('空标题和空过滤词不炸', () => {
  assert.equal(isTitleSensitive(''), false);
  assert.equal(isTitleSensitive('VS Code', ['', '   ']), false);
});

test('过滤词支持中英文逗号和换行分隔', () => {
  assert.deepEqual(parseFilterWords('银行, 密码\n无痕，test'), ['银行', '密码', '无痕', 'test']);
  assert.deepEqual(parseFilterWords(''), []);
  assert.deepEqual(parseFilterWords(undefined), []);
});
