// 纯几何/坐标计算：地面线、夹取范围、探头贴边坐标、点击区域判定、peekHome 的坐标反算。
//
// 这些函数刻意不碰 DOM、也不读 pet.ts 里的全局状态（workArea / spriteSize / 留白比例都当参数传进来），
// 所以既能被 pet.js 直接调用，也能脱离 Electron 单独验算（见 tests/geometry.test.js）——
// 探头留白这几个比例是手工调出来的，改成参数化之后至少能被测试锁住，不会重构时悄悄挪位。

interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PeekPadding {
  leftPaddingFrac: number;
  rightPaddingFrac: number;
  bottomPaddingFrac: number;
  homeScale: number;
}

const GEOMETRY = {
  /** 站在这条 y 上（窗口左上角的 y），角色脚底正好贴着工作区底部。 */
  groundY(workArea: GeometryRect, spriteSize: number): number {
    return workArea.y + workArea.height - spriteSize;
  },

  clampX(x: number, workArea: GeometryRect, spriteSize: number): number {
    return Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - spriteSize);
  },

  clampY(y: number, workArea: GeometryRect, spriteSize: number): number {
    return Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - spriteSize);
  },

  /** 探头贴边时窗口该放的 x：把素材里留白也算进去，让角色实际画面贴到屏幕真边缘。 */
  peekWindowX(
    side: 'left' | 'right',
    workArea: GeometryRect,
    spriteSize: number,
    padding: PeekPadding
  ): number {
    if (side === 'left') return workArea.x - padding.leftPaddingFrac * spriteSize;
    return workArea.x + workArea.width - spriteSize + padding.rightPaddingFrac * spriteSize;
  },

  /** home-peek 贴底边时窗口该放的 y，同样把底部留白让出去；整体缩小后留白的实际像素也跟着变小。 */
  peekWindowYBottom(workArea: GeometryRect, spriteSize: number, padding: PeekPadding): number {
    return (
      GEOMETRY.groundY(workArea, spriteSize) +
      padding.bottomPaddingFrac * padding.homeScale * spriteSize
    );
  },

  /** object-fit: contain 下，图片实际渲染的矩形（相对窗口左上角）。素材都是 512×512 正方形，
   * 和正方形窗口同比例，理论上不会有留白，这里还是按通用公式算，换非正方形素材也不会错。 */
  containRect(
    natW: number,
    natH: number,
    boxW: number,
    boxH: number
  ): { left: number; top: number; width: number; height: number; scale: number } {
    const scale = Math.min(boxW / natW, boxH / natH);
    const width = natW * scale;
    const height = natH * scale;
    return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height, scale };
  },

  /** 贴不贴着左/右边缘，用于判断要不要探头。不是边缘返回 null。 */  edgeSideAt(
    x: number,
    workArea: GeometryRect,
    spriteSize: number,
    thresholdPx: number
  ): 'left' | 'right' | null {
    if (x - workArea.x <= thresholdPx) return 'left';
    if (workArea.x + workArea.width - spriteSize - x <= thresholdPx) return 'right';
    return null;
  },

  /** ASSETS.md §0：先匹配尾巴，再匹配肚子，都不命中算头——所以这里永远有返回值，不会是 null。 */  zoneAt(
    clientX: number,
    clientY: number,
    spriteSize: number,
    zones: Record<'head' | 'tail' | 'belly', ZoneRect>
  ): 'head' | 'tail' | 'belly' {
    const fx = clientX / spriteSize;
    const fy = clientY / spriteSize;
    if (fy >= zones.tail.y) return 'tail';
    const belly = zones.belly;
    if (fy >= belly.y && fx >= belly.x && fx <= belly.x + belly.w) return 'belly';
    return 'head';
  },

  /** home-peek 用 CSS transform 整体缩小了（锚点底部居中），
   * 点击穿透判定要按同样的变换把窗口坐标换算回原图空间，不然摸不准她。 */
  peekHomeUntransform(
    clientX: number,
    clientY: number,
    spriteSize: number,
    homeScale: number
  ): { x: number; y: number } {
    return {
      x: (clientX - spriteSize / 2) / homeScale + spriteSize / 2,
      y: (clientY - spriteSize * (1 - homeScale)) / homeScale,
    };
  },

  /**
   * 抛出物理的竖直碰撞：**上下都要夹**。
   *
   * 只夹地面是不行的：往上甩会让窗口整个飞出屏幕上边，而窗口完全离开可视区域后
   * Chromium 会把 requestAnimationFrame 节流掉（背景节流），物理循环就停在半空——
   * 用户看到的是"把她往上甩，她飞出去再也不掉下来"。实测踩到过（y 到了 -20653，
   * 之后又一次停在 y=-263 不动）。所以上面也照样夹住并反弹。
   *
   * 返回夹取后的 y 和速度；bounced 表示发生了真正的反弹（要跟着摩擦），
   * resting 表示速度太小、就地停住（调用方可以把水平速度也归零）。
   */
  bounceVertically(
    y: number,
    velY: number,
    workArea: GeometryRect,
    spriteSize: number,
    damping: number,
    minBounceSpeed = 60
  ): { y: number; velY: number; bounced: boolean; resting: boolean } {
    if (y < workArea.y) {
      if (velY < -minBounceSpeed) {
        return { y: workArea.y, velY: -velY * damping, bounced: true, resting: false };
      }
      return { y: workArea.y, velY: 0, bounced: false, resting: true };
    }
    const ground = GEOMETRY.groundY(workArea, spriteSize);
    if (y > ground) {
      if (velY > minBounceSpeed) {
        return { y: ground, velY: -velY * damping, bounced: true, resting: false };
      }
      return { y: ground, velY: 0, bounced: false, resting: true };
    }
    return { y, velY, bounced: false, resting: false };
  },
};

// 浏览器里顶层 const 本来就能被别的 <script> 看到；这一行是为了让 Node 跑测试时也能拿到
// （Node 的每个文件有自己的模块作用域，看不到别的文件顶层 const）。浏览器里 globalThis 就是 window。
(globalThis as unknown as { GEOMETRY: typeof GEOMETRY }).GEOMETRY = GEOMETRY;
