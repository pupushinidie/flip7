/**
 * 翻七和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botCommand, bustChance, scorePlayer, type GameState } from "@flip7/game";
import { cardName } from "./cards.js";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "flip7";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个按钮（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 「提示」：让人机从你的位置算一步（所有牌都是明牌，它看到的就是你看到的），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase !== "playing") return { say: "这局已经结束了。", anchor: null };
  const me = game.players.findIndex((player) => player.id === playerId);
  const player = game.players[me];
  if (!player) return { say: "你不在这局里。", anchor: null };
  if (game.actor !== me) {
    const actor = game.players[game.actor];
    return { say: actor ? `等 ${actor.name} 走完再问我。` : "看完结算点「下一轮」。", anchor: null };
  }
  const command = botCommand(game, playerId);
  if (!command) return { say: "现在不用你做决定。", anchor: null };
  const round = scorePlayer(game, me).total;
  const nameOf = (id: string) => (id === playerId ? "自己" : game.players.find((one) => one.id === id)?.name ?? "?");

  if (command.type === "HIT" || command.type === "STAY") {
    const risk = bustChance(game, player);
    if (command.type === "STAY") {
      const finish = player.score + round >= game.config.targetScore;
      return {
        say: "我会停牌。",
        note: finish ? `停牌这一轮你就到 ${game.config.targetScore} 分了，而且领先，别冒险。` : `再要一张有 ${percent(risk)} 会爆掉，这轮的 ${round} 分不值得拿去赌。`,
        anchor: "stay",
      };
    }
    const note = player.secondChance ? "你手里有二次机会，翻到重复也能挡一次。"
      : player.numbers.length === 6 ? `再来一张不同的数字就是翻七（+15），爆掉的概率是 ${percent(risk)}。`
      : round === 0 ? "你面前还没有分，要牌不会亏。"
      : `再要一张爆掉的概率是 ${percent(risk)}，比起能多拿的分，还值得翻。`;
    return { say: "我会再要一张。", note, anchor: "hit" };
  }

  if (command.type === "TARGET") {
    const top = game.pending.at(-1);
    const card = top?.type === "target" ? top.card : null;
    const target = game.players.find((one) => one.id === command.target)!;
    const targetIndex = game.players.indexOf(target);
    const theirs = scorePlayer(game, targetIndex).total;
    const anchor = `target:${command.target}`;
    const give = card ? `「${cardName(card)}」` : "这张牌";
    switch (card?.kind) {
      case "freeze":
        return command.target === playerId
          ? { say: "我会冻结自己。", note: "冻结自己等于停牌，保住这一轮的分。", anchor }
          : { say: `我会冻结 ${target.name}。`, note: `${target.name}这一轮只有 ${theirs} 分，冻住它，它就只能拿这么多。`, anchor };
      case "flipThree":
        return command.target === playerId
          ? { say: "只能让自己翻三了。", note: "没有别人还在要牌。", anchor }
          : { say: `我会让 ${target.name} 翻三。`, note: `它有 ${theirs} 分、每张爆 ${percent(bustChance(game, target))}，连翻三张最容易爆掉。`, anchor };
      case "secondChance":
        return { say: `我会把二次机会给 ${target.name}。`, note: "你手里已经有一张，多出来的只能送人：送给总分最低的人，别帮领先的人。", anchor };
      default:
        return command.target === playerId
          ? { say: `我会把${give}留给自己。`, note: "修饰牌只加分，不会让人爆掉。", anchor }
          : { say: `我会把${give}给 ${nameOf(command.target)}。`, note: target.status === "busted" ? "你已经爆了，给同样爆掉的人等于作废，谁也不帮。" : "给总分最低的人，别帮领先的人。", anchor };
    }
  }

  if (command.type === "FLIP7") {
    if (command.target === null) return { say: "我会自己拿 +15。", note: "没有对手快到终点，加给自己最划算。", anchor: "flip7:self" };
    return { say: `我会罚 ${nameOf(command.target)} −15。`, note: "它总分领先、快到终点了，拉它一把比自己多 15 分更有用。", anchor: `flip7:${command.target}` };
  }
  return { say: "看完结算点「下一轮」。", anchor: null };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "bust-self": { title: "第一次爆掉？", text: "翻到和面前重复的数字就爆掉，这一轮 0 分，以前的总分不受影响。下次先看右边「再要一张爆掉」的概率。" },
  saved: { title: "二次机会救了你", text: "重复的牌和二次机会一起弃掉，你接着玩。每人最多拿一张，再翻到要送给别人。" },
  "frozen-self": { title: "你被冻结了", text: "被冻结就是被迫停牌：这一轮按你现在的牌计分，不能再要。" },
  "flip3-self": { title: "有人让你翻三", text: "你要一口气连翻三张，翻到重复就爆；翻到的行动牌等三张都翻完再处理。" },
  "flip7-self": { title: "你翻七了！", text: "7 张不同的数字：这一轮立刻结束，你额外 +15。" },
  "flip7-other": { title: "有人翻七", text: "凑齐 7 张不同数字的人额外 +15，这一轮立刻结束，没爆的人照常计分。" },
  give: { title: "这张牌要交给一个人", text: "点亮着的座位或右边的名字。冻结、翻三一般给对手；冻结自己等于停牌。" },
  "round-end": { title: "一轮结束", text: "没爆的人把本轮分加进总分。有人总分到 200，那一轮打完就结束，总分最高者赢。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  for (const event of game.events) {
    if (event.type === "Busted" && event.player === selfId) ids.push("bust-self");
    if (event.type === "Saved" && event.player === selfId) ids.push("saved");
    if (event.type === "Frozen" && event.target === selfId && event.by !== selfId) ids.push("frozen-self");
    if (event.type === "FlipThree" && event.target === selfId && event.by !== selfId) ids.push("flip3-self");
    if (event.type === "Flip7") ids.push(event.player === selfId ? "flip7-self" : "flip7-other");
    if (event.type === "RoundEnded") ids.push("round-end");
  }
  const me = game.players.findIndex((player) => player.id === selfId);
  if (game.phase === "playing" && game.stage === "target" && game.actor === me) ids.push("give");
  return ids;
}
