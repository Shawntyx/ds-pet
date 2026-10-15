import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { bundledPersonaDir } from './paths';

// 人设文件放在 userData/personas/ 下（不是项目目录里），这样用户改了不会被以后更新代码覆盖掉。
// 首次启动时从随程序分发的 persona/ 目录复制一份默认的过去。
function personasDir(): string {
  return path.join(app.getPath('userData'), 'personas');
}

export function ensurePersonasSeeded(): void {
  const dir = personasDir();
  fs.mkdirSync(dir, { recursive: true });
  const existing = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  if (existing.length > 0) return;

  const bundled = bundledPersonaDir();
  if (!fs.existsSync(bundled)) return;
  for (const file of fs.readdirSync(bundled).filter((f) => f.endsWith('.md'))) {
    fs.copyFileSync(path.join(bundled, file), path.join(dir, file));
  }
}

export function listPersonas(): string[] {
  ensurePersonasSeeded();
  return fs
    .readdirSync(personasDir())
    .filter((f) => f.endsWith('.md'))
    .sort();
}

export function personaFilePath(name: string): string {
  return path.join(personasDir(), name);
}

/** 每次都从磁盘现读，不缓存——这样人设文件改了立刻生效，不用重启也不用"重新加载"按钮。 */
export function readPersonaContent(name: string): string {
  ensurePersonasSeeded();
  try {
    return fs.readFileSync(personaFilePath(name), 'utf-8');
  } catch {
    return '';
  }
}
