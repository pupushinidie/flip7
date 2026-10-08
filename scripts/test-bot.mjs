#!/usr/bin/env node
/**
 * 翻七陪玩机器人（本地联调、线上在服务器上连 localhost 测试用）。
 *
 * 用法：
 *   node scripts/test-bot.mjs host <昵称> [人数=4] [--normal] [--start-at=N]   建房（默认残酷模式），打印房间码；
 *                                                                            给了 --start-at 就在凑够 N 人时自动开局
 *   node scripts/test-bot.mjs join <房间码> <昵称>                            加入房间
 *   node scripts/test-bot.mjs fill <房间码> <人数> [昵称前缀=机器人]           一次加入好几个机器人
 *
 * 环境变量：BOT_URL（默认 http://localhost:3010）、BOT_DELAY（每步之前等多少毫秒，默认 700）、
 *          BOT_PATH（socket.io 路径，默认 /socket.io）、BOT_REMATCH=0（终局后不同意再来一局）。
 * 策略：面前数字少于 3–5 张、爆牌概率低于 35% 就要牌；冻结给本轮分最高的对手，翻三给牌最多的对手，
 *      修饰牌留给自己，二次机会给第一个能给的人；翻七时罚总分最高的对手。每次 ack 之后都按最新状态重新判断。
 */
import { io } from "socket.io-client";

const URL = process.env.BOT_URL ?? "http://localhost:3010";
const DELAY = Number(process.env.BOT_DELAY ?? 700);
const PATH = process.env.BOT_PATH ?? "/socket.io";

const [mode, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const positional = args.filter((arg) => !arg.startsWith("--"));
const startAt = Number([...flags].find((flag) => flag.startsWith("--start-at="))?.split("=")[1] ?? 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cardKey = (card) => (card.kind === "number" ? `n${card.value}` : card.kind === "plus" ? `plus${card.value}` : card.kind);

function bustChance(game, player) {
  if (player.secondChance || game.deckCount === 0) return 0;
  return player.numbers.reduce((sum, card) => sum + (game.deckLeft[cardKey(card)] ?? 0), 0) / game.deckCount;
}

function roundScore(player) {
  if (player.status === "busted") return 0;
  const numbers = player.numbers.reduce((sum, card) => sum + card.value, 0);
  const plus = player.modifiers.reduce((sum, card) => sum + (card.kind === "plus" ? card.value : 0), 0);
  return (numbers + plus) * (player.modifiers.some((card) => card.kind === "times2") ? 2 : 1);
}

function runBot(name, setup) {
  const socket = io(URL, { path: PATH, transports: ["websocket"], reconnection: true });
  let room = null;
  let acting = false;
  let lastKey = "";
  const threshold = 3 + Math.floor(Math.random() * 3);
  const log = (...items) => console.log(`[${name}]`, ...items);

  const myPlayerId = () => room?.members.find((member) => member.id === socket.id)?.playerId;

  async function act() {
    if (acting || !room) return;
    const game = room.game;
    if (room.rematch && game?.phase === "finished") {
      if (!room.rematch.acceptedIds.includes(socket.id) && process.env.BOT_REMATCH !== "0") {
        acting = true;
        await sleep(DELAY);
        socket.emit("room:rematch", true, () => { acting = false; });
      }
      return;
    }
    if (!game || game.phase !== "playing") return;
    const me = myPlayerId();
    const myIndex = game.players.findIndex((player) => player.id === me);
    const key = `${game.version}:${game.stage}`;
    let command = null;
    if (game.stage === "roundEnd") {
      if (!game.ready.includes(me)) command = { type: "READY" };
    } else if (game.actor === myIndex) {
      const player = game.players[myIndex];
      if (game.stage === "turn") {
        const risk = bustChance(game, player);
        command = player.numbers.length < threshold && risk < 0.35 ? { type: "HIT" } : { type: "STAY" };
        if (player.numbers.length === 0) command = { type: "HIT" };
      } else if (game.stage === "flip7Choice") {
        const others = game.players.filter((p) => p.id !== me).sort((a, b) => b.score - a.score);
        command = { type: "FLIP7", target: others[0]?.id ?? null };
      } else if (game.stage === "target") {
        const card = game.pending.at(-1).card;
        const options = targets(game, myIndex, card);
        const opponents = options.filter((index) => index !== myIndex);
        let pick = options[0];
        if (card.kind === "freeze") pick = opponents.sort((a, b) => roundScore(game.players[b]) - roundScore(game.players[a]))[0] ?? myIndex;
        else if (card.kind === "flipThree") pick = opponents.sort((a, b) => game.players[b].numbers.length - game.players[a].numbers.length)[0] ?? myIndex;
        else if (card.kind === "plus" || card.kind === "times2") pick = myIndex;
        command = { type: "TARGET", target: game.players[pick].id };
      }
    }
    if (!command || key === lastKey) return;
    acting = true;
    lastKey = key;
    await sleep(DELAY);
    socket.emit("game:command", command, (response) => {
      acting = false;
      if (!response.ok) {
        log("被拒绝：", command.type, response.error);
        lastKey = "";
      } else {
        room = response.data;
      }
      void act(); // ack 之后按最新状态再判断一次
    });
  }

  function targets(game, chooser, card) {
    const n = game.players.length;
    const order = Array.from({ length: n }, (_, k) => (chooser + 1 + k) % n);
    const active = (index) => game.players[index].status === "active";
    if (card.kind === "freeze" || card.kind === "flipThree") return order.filter(active);
    if (card.kind === "secondChance") return order.filter((index) => index !== chooser && active(index) && !game.players[index].secondChance);
    return order;
  }

  socket.on("connect", () => {
    if (room) return;
    setup(socket, (snapshot) => {
      room = snapshot;
      void act();
    }, log);
  });
  socket.on("room:updated", (snapshot) => {
    room = snapshot;
    if (startAt && room.status === "waiting" && room.members.length >= startAt && room.members.find((m) => m.id === socket.id)?.isHost) {
      socket.emit("room:start", (response) => log(response.ok ? "开局" : `开局失败：${response.error}`));
    }
    if (room.game?.phase === "finished" && room.game.finalResult && !room.rematch?.acceptedIds.length) {
      const scores = room.game.players.map((player) => `${player.name} ${player.score}`).join(" / ");
      log("终局：", scores, "胜者", room.game.finalResult.winners.join(","));
    }
    void act();
  });
  socket.on("room:closed", ({ reason }) => {
    log("房间关闭：", reason);
    process.exit(0);
  });
  socket.on("connect_error", (error) => log("连不上：", error.message));
  return socket;
}

if (mode === "host") {
  const [name = "房主机器人", capacity = "4"] = positional;
  runBot(name, (socket, done, log) => {
    socket.emit("room:create", { name, capacity: Number(capacity), brutal: !flags.has("--normal") }, (response) => {
      if (!response.ok) {
        log("建房失败：", response.error);
        process.exit(1);
      }
      log("房间码", response.data.code);
      console.log(`ROOM ${response.data.code}`);
      done(response.data);
    });
  });
} else if (mode === "join" || mode === "fill") {
  const code = positional[0];
  const count = mode === "fill" ? Number(positional[1] ?? 1) : 1;
  const prefix = mode === "fill" ? positional[2] ?? "机器人" : positional[1] ?? "机器人";
  for (let k = 0; k < count; k += 1) {
    const name = mode === "fill" ? `${prefix}${k + 1}` : prefix;
    runBot(name, (socket, done, log) => {
      socket.emit("room:join", { name, code }, (response) => {
        if (!response.ok) {
          log("加入失败：", response.error);
          return;
        }
        log("已加入", code);
        done(response.data);
      });
    });
    await sleep(150);
  }
} else {
  console.log("用法见文件开头的注释。");
  process.exit(1);
}
