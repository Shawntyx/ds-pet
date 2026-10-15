// 打 Windows 安装包（第一版 alpha 用）。
//
// 为什么要一个脚本而不是直接写 `electron-builder`：
//   1) 先构建（tsc + 复制静态文件），不然打进包里的还是旧代码——这个坑刚踩过；
//   2) electron-builder 是 JS 程序，用 node 直接调它比经过 npm 稳
//      （npm 脚本在这台机器上偶尔会报 "Could not determine Node.js install directory"）；
//   3) 打完之后把产物路径打出来，省得自己去找。
//
// 产物目录在 **工作区外面**（../whale-pet-release，见 package.json 的 directories.output）：
// electron-builder 解压 Electron 后要把 win-unpacked.tmp 重命名成 win-unpacked，而当前工作区里
// "重命名目录"这个操作被 Windows 权限直接拒绝（工作区根目录上有一条对 Everyone 的
// "拒绝删除子项"权限，是 DSH 沙箱留下的，连非受限进程也会被拒——实测过）。
// 放到工作区外面就没有这条限制。

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
/** 和 package.json 里 directories.output 保持一致（相对项目根）。 */
const outputDir = path.join(projectRoot, '..', 'whale-pet-release');

/**
 * 每次构建都让版本号往前走一格（0.1.0-alpha.1 → 0.1.0-alpha.2 …），
 * 这样安装包文件名永远能分出新旧——不然每次都是同名文件，用户分不清装的是哪一版。
 * 只有在"同名安装包已经存在"时才递增，避免重复构建把版本号刷得飞快。
 */
function bumpVersionIfNeeded() {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const productName = pkg.build?.productName ?? pkg.name;
  const setupName = `${productName} Setup ${pkg.version}.exe`;

  if (!fs.existsSync(path.join(outputDir, setupName))) {
    console.log(`[whale-pet] 版本 ${pkg.version}（还没有同名安装包，不递增）`);
    return pkg.version;
  }

  const match = /^(.*?)(\d+)$/.exec(pkg.version);
  const next = match ? `${match[1]}${Number(match[2]) + 1}` : `${pkg.version}-alpha.1`;
  pkg.version = next;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
  console.log(`[whale-pet] 上一版安装包已存在，版本号递增为 ${next}`);
  return next;
}

function run(title, command, args) {
  console.log(`\n[whale-pet] ${title}`);
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[whale-pet] ${title} 失败（退出码 ${result.status}）`);
    process.exit(result.status ?? 1);
  }
}

// 1) 编译 TypeScript + 复制静态文件
const version = bumpVersionIfNeeded();
const tsc = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
run('编译 TypeScript…', process.execPath, [tsc, '-p', 'tsconfig.json']);
run('复制静态文件…', process.execPath, [path.join(projectRoot, 'scripts', 'copy-static.js')]);

// 2) 打安装包
const builder = path.join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
if (!fs.existsSync(builder)) {
  console.error('[whale-pet] 找不到 electron-builder，先跑：npm install --save-dev electron-builder');
  process.exit(1);
}

// electron-builder 解压 Electron 之后要把 win-unpacked.tmp 重命名成 win-unpacked；
// 如果上一次的 win-unpacked 还在，Windows 上这一步会因为没有覆盖语义而报 EPERM
// （实测：第一次成功、紧接着再打一次就失败）。每次先把上次的产物目录清掉。
for (const name of ['win-unpacked', 'win-unpacked.tmp']) {
  const stale = path.join(outputDir, name);
  if (fs.existsSync(stale)) {
    console.log(`[whale-pet] 清理上次的 ${name}…`);
    fs.rmSync(stale, { recursive: true, force: true });
  }
}

run('打包 Windows 安装包…', process.execPath, [builder, '--win', '--x64']);

// 3) 报告产物
const artifacts = fs.existsSync(outputDir)
  ? fs.readdirSync(outputDir).filter((name) => /\.(exe|msi|zip)$/i.test(name))
  : [];
console.log(`\n[whale-pet] 打包完成（版本 ${version}），产物在 ${outputDir}：`);
for (const name of artifacts) {
  const full = path.join(outputDir, name);
  console.log(`  - ${name}  (${(fs.statSync(full).size / 1024 / 1024).toFixed(1)} MB)`);
}
if (artifacts.length === 0) console.log('  （没找到产物，看看上面的日志）');

// 提醒：输出目录里如果已经有用户的安装目录，说一句，免得他以为更新会自己覆盖过去。
const installed = fs
  .readdirSync(outputDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'win-unpacked')
  .map((entry) => entry.name);
if (installed.length > 0) {
  console.log(
    `\n[whale-pet] 注意：这个目录里还有 ${installed.join('、')}（可能是你自己安装的位置）。\n` +
      `            更新时要重新运行上面的 Setup，并在向导里把安装位置选回同一个文件夹。`
  );
}
