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
    loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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
