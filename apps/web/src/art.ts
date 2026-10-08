/** 美术资源（art/export.py 导出到 public/art/）和座位色。 */
const BASE = `${import.meta.env.BASE_URL}art/`;

export const art = {
  hero: `${BASE}hero.png`,
  tile: `${BASE}tile.png`,
  clover: `${BASE}clover.png`,
};

/** 座位色：红、蓝、绿、黄，开局按入座顺序分。 */
export const SEAT_COLORS = ["#e5533f", "#3b82f0", "#44b860", "#f0c030"] as const;

export function seatColor(index: number): string {
  return SEAT_COLORS[index % SEAT_COLORS.length]!;
}
