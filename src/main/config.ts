import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_SETTINGS, PetSettings } from '../shared/types';

let cached: PetSettings | null = null;

function configPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): PetSettings {
  if (cached) return cached;
  let loaded: PetSettings = { ...DEFAULT_SETTINGS };
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const saved = JSON.parse(raw);
    // proactive 是嵌套对象，不能只整体浅合并——不然旧版本存下来的 settings.json 缺了新加的
    // 字段（比如 titleFilterWords）时，这里 saved.proactive 会把默认值整个顶掉，新字段变成
    // undefined，后面用到的地方（比如 parseFilterWords）就会炸。嵌套这层单独再合并一次默认值。
    loaded = {
      ...DEFAULT_SETTINGS,
      ...saved,
      proactive: { ...DEFAULT_SETTINGS.proactive, ...saved.proactive },
    };
  } catch {
    // 文件不存在或损坏时用默认值，不当成致命错误。
  }
  cached = loaded;
  return loaded;
}

export function saveSettings(settings: PetSettings): void {
  cached = settings;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

export function updateSettings(patch: Partial<PetSettings>): PetSettings {
  const next = { ...loadSettings(), ...patch };
  saveSettings(next);
  return next;
}
