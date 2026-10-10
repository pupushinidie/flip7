import { describe, expect, it } from "vitest";
import { botCommand } from "./bot.js";
import { legalActions, redactGameForViewer } from "./engine.js";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  sameCommand,
  TUTORIAL_DECK,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
} from "./tutorial.js";
import type { GameState } from "./types.js";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = tutorialApply(game, TUTORIAL_SELF, step.expect);
    if (step.kind === "watch") for (const move of step.moves) game = tutorialApply(game, tutorialActor(game)!, move);
  }
  return game;
}

const stepIndex = (id: string) => {
  const at = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (at === -1) throw new Error(`没有步骤 ${id}`);
  return at;
};
/** 走完 id 这一步之后的局面。 */
const after = (id: string) => playScript(stepIndex(id) + 1);
const player = (game: GameState, id: string) => game.players.find((candidate) => candidate.id === id)!;
const numbers = (game: GameState, id: string) => player(game, id).numbers.map((card) => card.value);

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法、轮到的是对的人，高亮的东西在界面上看得见，牌序正好用完", () => {
    let game = createTutorialGame("小蒲");
    const startDeck = game.deckCount;
    for (const step of TUTORIAL_STEPS) {
      if (step.anchor) expect(anchorVisible(game, step.anchor, TUTORIAL_SELF), `「${step.id}」高亮的 ${step.anchor} 看不见`).toBe(true);
      if (step.kind === "do") {
        expect(tutorialActor(game), `「${step.id}」不是轮到你`).toBe(TUTORIAL_SELF);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect)), `「${step.id}」这一步不合法`).toBe(true);
        game = tutorialApply(game, TUTORIAL_SELF, step.expect);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = tutorialActor(game);
          expect(actor && actor !== TUTORIAL_SELF, `「${step.id}」该对手走的时候轮到了 ${actor}`).toBe(true);
          expect(legalActions(game, actor!).some((command) => sameCommand(command, move)), `「${step.id}」里对手的 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = tutorialApply(game, actor!, move);
        }
      }
    }
    // 剧本摆好的牌正好翻完：开局发掉 3 张，之后每一张都翻出来，没有多翻一张
    expect(startDeck + 3 - game.deckCount).toBe(TUTORIAL_DECK.length);
    expect(game.phase).toBe("finished");
  });

  it("第 6 轮：×2 给了咕噜二号，冻结它，咕噜一号重复 11 爆掉，你停牌拿 20 分", () => {
    const start = createTutorialGame("小蒲");
    expect(start.round).toBe(6);
    expect(start.config.brutal).toBe(false);
    expect(numbers(start, "p1")).toEqual([8]);
    expect(tutorialActor(start)).toBe(TUTORIAL_SELF);

    expect(player(after("rivals1"), "p3").modifiers.map((card) => card.kind)).toEqual(["times2"]);
    const freeze = playScript(stepIndex("freeze"));
    expect(freeze.stage).toBe("target");
    expect(freeze.pending.at(-1)).toMatchObject({ type: "target", card: { kind: "freeze" } });
    // 三人都还在要牌：三个都能选
    expect(legalActions(freeze, TUTORIAL_SELF)).toHaveLength(3);
    expect(player(after("freezeTwo"), "p3").status).toBe("frozen");

    const bust = after("rivalBust");
    expect(player(bust, "p2").status).toBe("busted");
    expect(player(bust, "p2").bustCard?.value).toBe(11);
    expect(tutorialActor(bust)).toBe(TUTORIAL_SELF);

    const end = after("stay");
    expect(end.stage).toBe("roundEnd");
    expect(end.players.map((one) => one.lastRound?.total)).toEqual([20, 0, 12]);
    expect(end.players.map((one) => one.score)).toEqual([192, 178, 166]);
  });

  it("点「下一轮」两个咕噜跟着准备，第 7 轮立刻开始，你发到二次机会", () => {
    const round = after("ready");
    expect(round.round).toBe(7);
    expect(round.stage).toBe("turn");
    expect(player(round, "p1").secondChance).not.toBeNull();
    expect(round.players[round.dealer]!.id).toBe(TUTORIAL_SELF);
    expect(tutorialActor(round)).toBe("p2");
  });

  it("第 7 轮：翻三逼爆咕噜一号，二次机会挡掉重复的 12，咕噜二号翻七，你 204 比 202 赢", () => {
    const give = playScript(stepIndex("flipThree"));
    expect(give.pending.at(-1)).toMatchObject({ type: "target", card: { kind: "flipThree" } });
    expect(legalActions(give, TUTORIAL_SELF)).toHaveLength(3);
    expect(numbers(give, "p2")).toEqual([10, 12, 11]);

    const flipped = after("flipThree");
    expect(player(flipped, "p2").status).toBe("busted");
    expect(player(flipped, "p2").bustCard?.value).toBe(11);
    // 只翻了两张就停下
    expect(flipped.events.filter((event) => event.type === "Drew" && event.via === "flip3")).toHaveLength(2);

    const saved = after("hit5");
    expect(saved.events.some((event) => event.type === "Saved" && event.player === TUTORIAL_SELF)).toBe(true);
    expect(player(saved, "p1").status).toBe("active");
    expect(player(saved, "p1").secondChance).toBeNull();
    expect(numbers(saved, "p1")).toEqual([12]);

    expect(numbers(playScript(stepIndex("stay2")), "p3")).toHaveLength(5);

    const end = after("rivals6");
    expect(end.events.some((event) => event.type === "Flip7" && event.player === "p3")).toBe(true);
    expect(end.phase).toBe("finished");
    expect(end.players.map((one) => one.lastRound?.total)).toEqual([12, 0, 36]);
    expect(end.players.map((one) => one.score)).toEqual([204, 178, 202]);
    expect(end.finalResult?.winners).toEqual([TUTORIAL_SELF]);
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) expect(step.say.trim().length).toBeGreaterThan(0);
  });

  it("教程不改输入的局面；同一剧本走两遍结果一样", () => {
    const start = createTutorialGame("小蒲");
    const copy = structuredClone(start);
    tutorialApply(start, TUTORIAL_SELF, { type: "HIT" });
    expect(start).toEqual(copy);
    expect(playScript().players.map((one) => one.score)).toEqual(playScript().players.map((one) => one.score));
  });

  it("练习局：三人都交给人机，150 局都能正常打完", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 150; seed += 1) {
      let game = createPracticeGame("小蒲", seed);
      let moves = 0;
      // 每一步都 expect 会慢到超时，用普通判断，出错时记下来
      while (game.phase === "playing" && moves < 5000) {
        const actor = tutorialActor(game);
        if (!actor) break;
        const command = botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        game = tutorialApply(game, actor, command);
        moves += 1;
      }
      if (game.phase !== "finished" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步）`);
    }
    expect(stuck).toEqual([]);
  }, 60_000);
});
