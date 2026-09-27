// 桌宠右键菜单的内容，自绘 HTML 菜单（不用系统原生菜单），配合 SPEC 5.1 的要求。
// 和 pet.ts 一样不用 import/export，直接当普通脚本跑。

interface Window {
  menuAPI: {
    onInit(callback: (data: { doNotDisturb: boolean }) => void): void;
    selectAction(id: string): void;
    close(): void;
  };
}

interface MenuItemDef {
  id: string;
  label: string;
  disabled?: boolean;
  checkbox?: boolean;
  divider?: boolean;
}

const ITEMS: MenuItemDef[] = [
  { id: 'chat', label: '💬 聊天', disabled: true },
  { id: 'feed', label: '🍪 投喂' },
  { id: 'poke', label: '👉 戳一下' },
  { id: 'praise', label: '✨ 夸夸' },
  { id: 'dnd', label: '🌙 勿扰模式', checkbox: true, divider: true },
  { id: 'hide', label: '🙈 隐藏' },
  { id: 'settings', label: '⚙️ 设置', disabled: true },
];

const root = document.getElementById('menu') as HTMLDivElement;
let doNotDisturb = false;

function render(): void {
  root.innerHTML = '';
  for (const item of ITEMS) {
    if (item.divider) {
      const divider = document.createElement('div');
      divider.className = 'menu-divider';
      root.appendChild(divider);
    }

    const btn = document.createElement('button');
    btn.className = 'menu-item' + (item.disabled ? ' disabled' : '');

    const label = document.createElement('span');
    label.textContent = item.label;
    btn.appendChild(label);

    if (item.checkbox) {
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = doNotDisturb ? '✓' : '';
      btn.appendChild(check);
    } else if (item.disabled) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '阶段2';
      btn.appendChild(badge);
    }

    if (!item.disabled) {
      btn.addEventListener('click', () => window.menuAPI.selectAction(item.id));
    }
    root.appendChild(btn);
  }
}

window.menuAPI.onInit((data) => {
  doNotDisturb = data.doNotDisturb;
  render();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.menuAPI.close();
});

render();
