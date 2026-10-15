// 气泡 / 右键菜单 / 聊天面板往哪儿摆（纯函数，见 tests/popupPlacement.test.js）。
//
// 之前是拿"桌宠窗口"的矩形去算的，但那个窗口是个 220×220 的正方形，角色周围有大量透明留白
// （探头姿势还会整体缩到 0.75 倍），所以气泡看起来会飘得离人物很远，或者在某些位置被屏幕边缘切掉。
// 现在渲染进程会把"角色实际画面"的矩形（anchor）报上来，这里只按 anchor 算。
//
// 规则（SPEC 5.1/5.3：贴边时要自适应屏幕）：
//   - 气泡：默认摆正上方；人物贴着左右边缘（旁边没地方放气泡）时改摆到旁边，绝不越出工作区。
//   - 侧边面板（右键菜单/聊天面板）：默认摆人物右边，右边放不下就摆左边，垂直方向夹进工作区。

export interface PlacementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacementSize {
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
}

const DEFAULT_GAP = 8;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 水平方向夹进工作区（宁可贴着边缘，也不要露到屏幕外面）。 */
function clampX(x: number, size: PlacementSize, workArea: PlacementRect): number {
  return clamp(x, workArea.x, workArea.x + workArea.width - size.width);
}

function clampY(y: number, size: PlacementSize, workArea: PlacementRect): number {
  return clamp(y, workArea.y, workArea.y + workArea.height - size.height);
}

/** 人物中线偏左就优先往右放，反之往左放——用来在两侧都放得下时选更自然的一边。 */
function clampBoth(placement: Placement, size: PlacementSize, workArea: PlacementRect): Placement {
  return {
    x: clampX(placement.x, size, workArea),
    y: clampY(placement.y, size, workArea),
  };
}

export function placeBubble(
  anchor: PlacementRect,
  workArea: PlacementRect,
  bubble: PlacementSize,
  gap = DEFAULT_GAP
): Placement {
  const roomLeft = anchor.x - workArea.x;
  const roomRight = workArea.x + workArea.width - (anchor.x + anchor.width);
  const needSide = roomLeft < bubble.width + gap || roomRight < bubble.width + gap;

  // 人物贴着左/右边缘（气泡摆上方也会被挤到屏幕外）时改摆到旁边：
  // 哪边宽裕就摆哪边，这样"人物在最左边 → 气泡出现在右边"。
  if (needSide) {
    const canRight = roomRight >= bubble.width + gap;
    const canLeft = roomLeft >= bubble.width + gap;
    if (canRight || canLeft) {
      const side: 'left' | 'right' = canRight && (!canLeft || roomRight >= roomLeft) ? 'right' : 'left';
      return clampBoth(
        {
          x: side === 'right' ? anchor.x + anchor.width + gap : anchor.x - bubble.width - gap,
          y: anchor.y + anchor.height / 2 - bubble.height / 2, // 和人物垂直居中对齐
        },
        bubble,
        workArea
      );
    }
  }

  // 默认：正上方；上方放不下（人物贴着屏幕顶边）就改摆下方
  let y = anchor.y - bubble.height - gap;
  if (y < workArea.y) y = anchor.y + anchor.height + gap;
  return clampBoth(
    { x: anchor.x + anchor.width / 2 - bubble.width / 2, y },
    bubble,
    workArea
  );
}

/** 侧边面板（右键菜单、聊天面板）：默认摆人物右边，右边放不下才翻到左边，垂直夹进工作区。 */
export function placeSidePanel(
  anchor: PlacementRect,
  workArea: PlacementRect,
  panel: PlacementSize,
  gap = DEFAULT_GAP
): Placement {
  const roomRight = workArea.x + workArea.width - (anchor.x + anchor.width);
  const roomLeft = anchor.x - workArea.x;
  const canRight = roomRight >= panel.width + gap;
  const canLeft = roomLeft >= panel.width + gap;

  // 默认右边；两边都放不下时也先按右边算，最后统一夹进工作区
  const x = canRight || !canLeft ? anchor.x + anchor.width + gap : anchor.x - panel.width - gap;

  // 垂直方向跟人物的上沿对齐（菜单习惯），放不下就上移
  let y = anchor.y;
  if (y + panel.height > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - panel.height;
  }
  return clampBoth({ x, y }, panel, workArea);
}
