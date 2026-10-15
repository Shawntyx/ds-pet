// 临时隔离实验 4（不提交）：确认哪些窗口/移动方式会让尺寸漂移。
const { app, BrowserWindow } = require('electron');
const path = require('path');

async function make(options) {
  const win = new BrowserWindow({
    width: 220,
    height: 220,
    x: 500,
    y: 400,
    frame: false,
    show: false,
    skipTaskbar: true,
    ...options,
  });
  await win.loadFile(path.join(__dirname, 'probe2.html'));
  win.showInactive();
  await new Promise((r) => setTimeout(r, 300));
  return win;
}

function size(win) {
  const b = win.getBounds();
  return `${b.width}x${b.height}`;
}

app.whenReady().then(async () => {
  console.log('起始尺寸都应该是 220x220\n');

  let w = await make({ transparent: true, resizable: false });
  for (let i = 1; i <= 5; i++) w.setPosition(500 - i, 400);
  console.log(`透明 + 只动 x 5 次      : ${size(w)}`);
  w.destroy();

  w = await make({ transparent: true, resizable: false });
  for (let i = 1; i <= 5; i++) w.setPosition(500, 400 - i);
  console.log(`透明 + 只动 y 5 次      : ${size(w)}`);
  w.destroy();

  w = await make({ transparent: true, resizable: false });
  for (let i = 1; i <= 5; i++) w.setPosition(500 - i, 400 - i, false);
  console.log(`透明 + 3 参数 + x/y 5 次: ${size(w)}`);
  w.destroy();

  w = await make({ transparent: false, resizable: true });
  for (let i = 1; i <= 5; i++) w.setPosition(500 - i, 400 - i);
  console.log(`不透明 + x/y 5 次       : ${size(w)}`);
  w.destroy();

  w = await make({ transparent: true, resizable: false });
  for (let i = 1; i <= 5; i++) w.setBounds({ x: 500 - i, y: 400 - i, width: 220, height: 220 });
  console.log(`透明 + setBounds 5 次   : ${size(w)}`);
  w.destroy();

  app.exit(0);
});
