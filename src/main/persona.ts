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

/** name 要么是 personasDir() 里真实存在的文件名，要么不信任——防止 `../../别处` 这类路径
 *  从设置里传进来（正常走下拉框选不出这种值，但主进程这边不该只靠渲染进程乖乖守规矩）。
 *  校验不过就退回第一个真实存在的人设文件，不让调用方（读文件内容 / shell.openPath）
 *  碰到 personasDir() 以外的路径。 */
function sanitizePersonaName(name: string): string {
  const dir = personasDir();
  const resolved = path.resolve(dir, name || '');
  const rel = path.relative(dir, resolved);
  const staysInside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (staysInside && name.endsWith('.md') && fs.existsSync(resolved)) return name;
  const fallback = listPersonas()[0];
  return fallback ?? 'default.md';
}

export function personaFilePath(name: string): string {
  return path.join(personasDir(), sanitizePersonaName(name));
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
