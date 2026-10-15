import * as path from 'path';

// 打包之后，代码在 app.asar 里面，但**素材和人设是放在 asar 外面**的
// （electron-builder 的 extraResources：resources/whale-assets、resources/persona）。
// 这样素材（git submodule，体量大、还自带 LICENSE）不用塞进 asar，
// 路径也不受 asar 虚拟文件系统影响。
//
// 判断"是不是打包后的环境"不用 electron 的 app.isPackaged：这个模块也会被 preload 引用，
// 而 preload 里拿不到 app。用 __dirname 里有没有 app.asar 更直接。

const packaged = __dirname.includes('app.asar');

/** 打包后是 <安装目录>/resources；开发时是项目根目录。 */
function resourcesRoot(): string {
  if (!packaged) return path.join(__dirname, '..', '..');
  const fromProcess = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return fromProcess ?? path.join(__dirname, '..', '..');
}

/** 鲸鱼娘素材仓库的根目录（里面有 assets/generated、docs/images、LICENSE）。 */
export function whaleAssetsDir(): string {
  return packaged
    ? path.join(resourcesRoot(), 'whale-assets')
    : path.join(resourcesRoot(), 'assets', 'whale');
}

/** 随程序分发的默认人设目录（首次启动会复制到 userData/personas）。 */
export function bundledPersonaDir(): string {
  return path.join(resourcesRoot(), 'persona');
}
