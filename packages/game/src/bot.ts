import { cardKey, legalActions, scorePlayer, targetsFor } from "./engine.js";
import type { Card, GameCommand, GameState, Player } from "./types.js";

/**
 * 人机（「普通」难度）：只看桌上公开的东西（所有牌都是明着翻的，牌堆里各种牌还剩几张也是公开的 deckLeft）。
 *
 * 要牌还是停牌：按牌堆里剩下的牌逐种算「再要一张」的期望——
 * 重复的数字（没有二次机会）爆掉，丢掉本轮已有的分；新数字、+N、×2 加分，凑齐 7 张再加翻七奖励；
 * 行动牌按小的固定值算。期望为正就要牌。快赢了就收手，别人快赢了就多拼一点。
 *
 * 交牌：冻结给本轮分最少的对手（把他卡在低分）；翻三给「爆掉概率 × 本轮分」最大的对手；
 * 多出来的二次机会给总分最低的对手；残酷模式的修饰牌给自己（自己爆了就给已经爆掉的人，等于作废）。
 * 残酷模式翻七：总分领先的对手快到终点时罚他 −15，否则自己 +15。
 */

/** 爆掉时的损失再乘这个系数：略微保守。 */
const RISK = 1.1;
/** 别人这一轮可能就赢的时候，爆掉的损失只算这么多（多拼一点）。 */
const DESPERATE_RISK = 0.6;
const SECOND_CHANCE_VALUE = 3;

function indexOf(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

/** 牌堆里剩下的牌：[样子, 张数]。 */
function deckCards(state: GameState): { card: Pick<Card, "kind" | "value">; count: number }[] {
  const cards: { card: Pick<Card, "kind" | "value">; count: number }[] = [];
  for (let value = 0; value <= 12; value += 1) cards.push({ card: { kind: "number", value }, count: state.deckLeft[cardKey({ kind: "number", value })] ?? 0 });
  for (const value of [2, 4, 6, 8, 10]) cards.push({ card: { kind: "plus", value }, count: state.deckLeft[cardKey({ kind: "plus", value })] ?? 0 });
  for (const kind of ["times2", "freeze", "flipThree", "secondChance"] as const) cards.push({ card: { kind, value: 0 }, count: state.deckLeft[kind] ?? 0 });
  return cards.filter((entry) => entry.count > 0);
}

/** 再要一张的期望得分变化。 */
function hitValue(state: GameState, me: number, risk: number): number {
  const player = state.players[me]!;
  const current = scorePlayer(state, me).total;
  const numbers = player.numbers.reduce((sum, card) => sum + card.value, 0);
  const plus = player.modifiers.reduce((sum, card) => sum + (card.kind === "plus" ? card.value : 0), 0);
  const doubled = player.modifiers.some((card) => card.kind === "times2");
  const factor = doubled ? 2 : 1;
  const have = new Set(player.numbers.map((card) => card.value));
  const deck = deckCards(state);
  const total = deck.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return -1;
  let expected = 0;
  for (const { card, count } of deck) {
    let delta = 0;
    switch (card.kind) {
      case "number":
        if (have.has(card.value)) delta = player.secondChance ? -SECOND_CHANCE_VALUE : -current * risk;
        else delta = card.value * factor + (player.numbers.length === 6 ? state.config.flip7Bonus : 0);
        break;
      case "plus":
        delta = card.value * factor;
        break;
      case "times2":
        delta = doubled ? 0 : numbers + plus;
        break;
      case "secondChance":
        delta = player.secondChance ? 0 : SECOND_CHANCE_VALUE;
        break;
      default:
        // 冻结、翻三：自己拿到可以交给对手，算一点好处
        delta = 1;
    }
    expected += (delta * count) / total;
  }
  return expected;
}

function decideHit(state: GameState, me: number): boolean {
  const player = state.players[me]!;
  const current = scorePlayer(state, me).total;
  const target = state.config.targetScore;
  const others = state.players.filter((_, index) => index !== me);
  const best = Math.max(...others.map((other) => other.score));
  // 现在收手就到终点而且领先：收手
  if (player.score + current >= target && player.score + current > best) return false;
  // 有对手这一轮可能冲线（总分 + 本轮已有的分到终点）：多拼一点
  const threatened = state.players.some((other, index) =>
    index !== me && other.status !== "busted" && other.score + scorePlayer(state, index).total >= target);
  return hitValue(state, me, threatened ? DESPERATE_RISK : RISK) > 0;
}

/** 本轮继续要牌爆掉的概率（只看重复数字）。 */
function bustRisk(state: GameState, player: Player): number {
  if (player.secondChance) return 0;
  const total = Object.values(state.deckLeft).reduce((sum, count) => sum + count, 0);
  if (total === 0) return 0;
  return player.numbers.reduce((sum, card) => sum + (state.deckLeft[cardKey(card)] ?? 0), 0) / total;
}

function chooseTarget(state: GameState, me: number, card: Card): number {
  const options = targetsFor(state, me, card);
  const opponents = options.filter((index) => index !== me);
  const round = (index: number) => scorePlayer(state, index).total;
  const pick = (candidates: number[], score: (index: number) => number) =>
    candidates.reduce((best, index) => (score(index) > score(best) ? index : best), candidates[0]!);
  switch (card.kind) {
    case "freeze":
      // 卡住本轮分最少的对手；同样少就挑总分高的
      return opponents.length > 0 ? pick(opponents, (index) => -round(index) + state.players[index]!.score / 1000) : options[0]!;
    case "flipThree":
      // 逼对手连翻三张：本轮分多、容易爆的最划算
      return opponents.length > 0 ? pick(opponents, (index) => bustRisk(state, state.players[index]!) * (round(index) + 5)) : options[0]!;
    case "secondChance":
      return pick(options, (index) => -state.players[index]!.score);
    default: {
      // 修饰牌：给自己；自己爆了就给已经爆掉的人（等于作废），没有就给总分最低的人
      if (options.includes(me) && state.players[me]!.status !== "busted") return me;
      const busted = options.filter((index) => state.players[index]!.status === "busted" && index !== me);
      if (busted.length > 0) return busted[0]!;
      return pick(options, (index) => -state.players[index]!.score);
    }
  }
}

function flip7Target(state: GameState, me: number): string | null {
  const player = state.players[me]!;
  const leader = state.players
    .filter((_, index) => index !== me)
    .reduce((best, other) => (other.score > best.score ? other : best));
  const close = leader.score >= state.config.targetScore - 40;
  return close && leader.score > player.score ? leader.id : null;
}

/** 轮到 playerId 做决定时人机的下一步；不用它做决定返回 null（结算画面的「下一轮」由服务端替人机处理）。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const actions = legalActions(state, playerId);
  if (actions.length === 0) return null;
  const me = indexOf(state, playerId);
  switch (state.stage) {
    case "turn":
      return decideHit(state, me) ? { type: "HIT" } : { type: "STAY" };
    case "target": {
      const top = state.pending.at(-1);
      if (top?.type !== "target") return actions[0]!;
      return { type: "TARGET", target: state.players[chooseTarget(state, me, top.card)]!.id };
    }
    case "flip7Choice":
      return { type: "FLIP7", target: flip7Target(state, me) };
    default:
      return { type: "READY" };
  }
}
