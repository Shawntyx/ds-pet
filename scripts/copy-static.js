// tsc 只编译 .ts，这里把渲染进程用到的静态文件（html/css）复制到 dist 里，和编译出的 pet.js 放一起。
const fs = require('fs');
const path = require('path');

const pairs = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/pet.css', 'dist/renderer/pet.css'],
  ['src/renderer/theme.css', 'dist/renderer/theme.css'],
  ['src/renderer/menu.html', 'dist/renderer/menu.html'],
  ['src/renderer/menu.css', 'dist/renderer/menu.css'],
  ['src/renderer/chat.html', 'dist/renderer/chat.html'],
  ['src/renderer/chat.css', 'dist/renderer/chat.css'],
  ['src/renderer/settings.html', 'dist/renderer/settings.html'],
  ['src/renderer/settings.css', 'dist/renderer/settings.css'],
  ['src/renderer/bubble.html', 'dist/renderer/bubble.html'],
  ['src/renderer/bubble.css', 'dist/renderer/bubble.css'],
];

for (const [from, to] of pairs) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
