// 启动 Electron 的小包装。
//
// 为什么不能直接 `electron .`：如果环境里有 ELECTRON_RUN_AS_NODE=1（DSH 的终端里默认就有），
// electron.exe 会以"纯 Node 模式"启动——`require('electron').app` 是 undefined，
// 主进程第一行就崩，表现就是 npm start 完全跑不起来。
// 这里显式把这个变量从子进程环境里删掉，不管外面怎么设都能正常起来。

const { spawn } = require('child_process');
const electronPath = require('electron'); // 在 Node 进程里 require('electron') 得到的是可执行文件路径

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit', // 直接继承终端：日志能实时看到，也不走管道（沙箱下管道会有权限问题）
  env,
});

child.on('close', (code) => process.exit(code === null ? 0 : code));
child.on('error', (err) => {
  console.error('[whale-pet] 启动 Electron 失败:', err.message);
  process.exit(1);
});
