/** 美术资源（art/export.py 导出到 public/art/）、座位色和数字牌的颜色。 */
const BASE = `${import.meta.env.BASE_URL}art/`;

export const art = {
  hero: `${BASE}hero.png`,
  /** 牌桌背景，按房间码选一张。 */
  backdrops: [`${BASE}backdrop-1.png`, `${BASE}backdrop-2.png`, `${BASE}backdrop-3.png`],
  /** 32px 小图标：行动牌、修饰牌、爆掉、翻七、牌背徽记。 */
  freeze: `${BASE}freeze.png`,
  flipThree: `${BASE}flip3.png`,
  secondChance: `${BASE}second.png`,
  coins: `${BASE}coins.png`,
  double: `${BASE}double.png`,
  bust: `${BASE}bust.png`,
  flip7: `${BASE}flip7.png`,
  emblem: `${BASE}emblem.png`,
  /** 座位头像 0–9（32px）。 */
  avatar: (index: number) => `${BASE}avatar-${index % 10}.png`,
  /** 爆掉的烟雾、翻七的烟花：横排帧条（见 art/export.py）。 */
  bustFx: `${BASE}fx-bust.png`,
  flip7Fx: `${BASE}fx-flip7.png`,
};

/** 动画帧条的帧数（和 art/export.py 一致）。 */
export const FX_FRAMES = { bust: 8, flip7: 8 } as const;

/** 座位色：10 种，开局按入座顺序分。 */
export const SEAT_COLORS = [
  "#e5533f", // 红
  "#3b82f0", // 蓝
  "#44b860", // 绿
  "#f0c030", // 黄
  "#a35ee8", // 紫
  "#f08a2e", // 橙
  "#2ec4c4", // 青
  "#ef6fb0", // 粉
  "#9ccc3a", // 黄绿
  "#c8ccd6", // 银
] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length]!;
}

/** 数字牌 0–12 的数字颜色（米色牌面上要看得清，相邻数字颜色不同）。 */
export const NUMBER_COLORS = [
  "#5f6b7a", // 0 灰
  "#8a5a2b", // 1 棕
  "#c8322c", // 2 红
  "#d9631c", // 3 橙
  "#a8820c", // 4 土黄
  "#5c8a1e", // 5 草绿
  "#1d8a4a", // 6 绿
  "#0f8078", // 7 青
  "#1f63a8", // 8 蓝
  "#3a3fa8", // 9 靛
  "#7a3aa8", // 10 紫
  "#b02f7f", // 11 洋红
  "#b8121f", // 12 深红
] as const;

/** 按房间码选背景，同一个房间每次一样。 */
export function backdropFor(code: string): string {
  let hash = 0;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return art.backdrops[hash % art.backdrops.length]!;
}
