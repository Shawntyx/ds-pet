// 启动 Electron 的小包装。
//
// 它干两件事：
//
// 1) 启动前先构建（tsc + 复制静态文件）。
//    以前只有 `npm start` 会构建，直接跑 `node scripts/start.js` 会拿到旧 dist——
//    实际踩过：面板上看不到新加的按钮，还以为是代码没生效。现在两条路都会构建。
//    想跳过构建（比如你正开着 `npm run dev` 的 watch）：`node scripts/start.js --no-build`
//    构建也刻意不经过 npm，直接调 node + 本地 tsc，避开 npm 脚本偶尔抽风的问题
//    （见过 npm run build 报 "Could not determine Node.js install directory"）。
//
// 2) 把环境里的 ELECTRON_RUN_AS_NODE 删掉再启动。
//    这个变量一旦存在，electron.exe 会以"纯 Node 模式"启动——`require('electron').app`
//    是 undefined，主进程第一行就崩，表现就是 npm start 完全跑不起来。

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const skipBuild = process.argv.includes('--no-build');

if (!skipBuild) {
  const tsc = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const copyStatic = path.join(projectRoot, 'scripts', 'copy-static.js');

  console.log('[whale-pet] 编译 TypeScript…');
  const compile = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (compile.status !== 0) {
    console.error('[whale-pet] 编译失败，已中止启动（先修掉上面的报错再试）');
    process.exit(compile.status ?? 1);
  }

  const copy = spawnSync(process.execPath, [copyStatic], { cwd: projectRoot, stdio: 'inherit' });
  if (copy.status !== 0) {
    console.error('[whale-pet] 复制静态文件失败，已中止启动');
    process.exit(copy.status ?? 1);
  }
}

const electronPath = require('electron'); // 在 Node 进程里 require('electron') 得到的是可执行文件路径

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit', // 直接继承终端：日志能实时看到，也不走管道（沙箱下管道会有权限问题）
  env,
});

child.on('close', (code) => process.exit(code === null ? 0 : code));
child.on('error', (err) => {
  console.error('[whale-pet] 启动 Electron 失败:', err.message);
  process.exit(1);
});
