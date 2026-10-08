import type { CSSProperties } from "react";
import type { Card, CardKind } from "@flip7/game";
import { art, NUMBER_COLORS } from "./art.js";

/** 牌的中文名（动作记录、提示里用）。 */
export function cardName(card: Pick<Card, "kind" | "value">): string {
  switch (card.kind) {
    case "number":
      return String(card.value);
    case "plus":
      return `+${card.value}`;
    case "times2":
      return "×2";
    case "freeze":
      return "冻结";
    case "flipThree":
      return "翻三";
    case "secondChance":
      return "二次机会";
  }
}

export const ACTION_HELP: Record<Exclude<CardKind, "number">, string> = {
  freeze: "冻结：目标立刻停牌，按已有的牌计分",
  flipThree: "翻三：目标必须连翻 3 张，翻到重复就爆",
  secondChance: "二次机会：抵消一次爆掉（重复的牌和它一起弃掉）",
  plus: "修饰牌：结算时加分",
  times2: "×2：结算时把分数翻倍",
};

export function cardIcon(kind: CardKind): string | null {
  switch (kind) {
    case "freeze":
      return art.freeze;
    case "flipThree":
      return art.flipThree;
    case "secondChance":
      return art.secondChance;
    default:
      return null;
  }
}

interface CardViewProps {
  readonly card: Pick<Card, "kind" | "value">;
  readonly className?: string;
  readonly style?: CSSProperties | undefined;
  readonly title?: string;
}

/**
 * 一张牌。尺寸由外层的 CSS 变量决定：--cw 牌宽、--cf 数字字号（12 的整数倍）、--ci 图标边长（32 的整数倍）。
 * 数字牌 = 米色牌面 + 这个数字的颜色；修饰牌是金色牌面；行动牌是图标。
 */
export function CardView({ card, className = "", style, title }: CardViewProps) {
  const name = cardName(card);
  if (card.kind === "number") {
    return (
      <span
        className={`f7-card num ${className}`}
        style={{ "--c": NUMBER_COLORS[card.value] ?? "#333", ...style } as CSSProperties}
        title={title ?? name}
        aria-label={name}
      >
        <b>{card.value}</b>
      </span>
    );
  }
  if (card.kind === "plus" || card.kind === "times2") {
    return (
      <span className={`f7-card mod ${card.kind} ${className}`} style={style} title={title ?? ACTION_HELP[card.kind]} aria-label={name}>
        <b>{name}</b>
      </span>
    );
  }
  return (
    <span className={`f7-card act ${card.kind} ${className}`} style={style} title={title ?? ACTION_HELP[card.kind]} aria-label={name}>
      <img src={cardIcon(card.kind)!} alt="" />
      <small>{name}</small>
    </span>
  );
}

/** 牌背：深蓝条纹 + 金色徽记。 */
export function CardBack({ className = "" }: { className?: string }) {
  return (
    <span className={`f7-card back ${className}`} aria-label="牌背">
      <img src={art.emblem} alt="" />
    </span>
  );
}
