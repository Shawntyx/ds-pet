// 桌宠右键菜单的内容，自绘 HTML 菜单（不用系统原生菜单），配合 SPEC 5.1 的要求。
// 和 pet.ts 一样不用 import/export，直接当普通脚本跑。
// 运行时代码整体包一层 IIFE：这几个渲染脚本都是全局脚本，顶层标识符共享同一个作用域，
// 不包一层的话换个文件写个同名变量就会跟别的文件撞车报错。

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

(function () {
  // 小鲸鱼尾巴标记：分隔线中间的那一点缀，呼应她本人尾鳍的形状，不是随手找的图标。
  const TAIL_SVG =
    '<svg viewBox="0 0 24 22" width="13" height="12" aria-hidden="true">' +
    '<path d="M12 21C12 21 3.5 17 2 11C4.5 11.5 8 12.5 10.3 10.2C8.7 7.5 8.7 4 12 1' +
    'C15.3 4 15.3 7.5 13.7 10.2C16 12.5 19.5 11.5 22 11C20.5 17 12 21 12 21Z" ' +
    'fill="currentColor"/></svg>';

  const ITEMS: MenuItemDef[] = [
    { id: 'chat', label: '💬 聊天' },
    { id: 'balance', label: '💰 查余额' },
    { id: 'feed', label: '🍪 投喂' },
    { id: 'praise', label: '✨ 夸夸' },
    { id: 'dnd', label: '🌙 勿扰模式', checkbox: true, divider: true },
    { id: 'hide', label: '🙈 隐藏' },
    { id: 'settings', label: '⚙️ 设置' },
    // 点击/拖拽偶尔会被别的也用"透明穿透"技巧的桌宠类 App 搅乱，这个入口比翻系统托盘
    // 找图标更可靠——因为右键菜单这条路恰好是那种状况下还能正常用的（不受影响的是松开/
    // 右键类消息，按下才会失灵，参见 main.ts 里 recreateMainWindow 的注释）。
    { id: 'recreate', label: '🔄 重新创建窗口（点击失灵时用）', divider: true },
    { id: 'quit', label: '❌ 关闭' },
  ];

  const root = document.getElementById('menu') as HTMLDivElement;
  let doNotDisturb = false;

  function render(): void {
    root.innerHTML = '';
    for (const item of ITEMS) {
      if (item.divider) {
        const divider = document.createElement('div');
        divider.className = 'menu-divider';
        divider.innerHTML = '<span class="menu-divider-tail">' + TAIL_SVG + '</span>';
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
})();
