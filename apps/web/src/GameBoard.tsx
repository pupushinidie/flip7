import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  bustChance,
  scorePlayer,
  targetsFor,
  type Card,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyRoomSnapshot,
  type Player,
} from "@flip7/game";
import { art, backdropFor, FX_FRAMES, seatColor } from "./art.js";
import { ACTION_HELP, CardBack, CardView, cardIcon, cardName } from "./cards.js";
import GameRules from "./GameRules.js";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onDissolve: () => void;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  // now 可能比 anchor.at 早（计时器上一跳），不能让剩余时间比服务端给的还多。
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

const STATUS_LABEL: Record<Player["status"], string> = { active: "要牌中", stayed: "停牌", frozen: "冻结", busted: "爆了" };

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 轮开始，${name(event.dealer)}当庄家`;
    case "Drew":
      if (event.via === "deal") return `${name(event.player)}发到 ${cardName(event.card)}`;
      if (event.via === "flip3") return `${name(event.player)}翻三：${cardName(event.card)}`;
      return `${name(event.player)}要牌：${cardName(event.card)}`;
    case "Busted":
      return `${name(event.player)}又摸到 ${event.card.value}，爆了！`;
    case "Saved":
      return `${name(event.player)}用二次机会挡掉了重复的 ${event.card.value}`;
    case "Stayed":
      return event.forced ? `牌摸光了，${name(event.player)}只能停牌` : `${name(event.player)}停牌`;
    case "Frozen":
      return event.by === event.target ? `${name(event.by)}冻结了自己` : `${name(event.by)}冻结了${name(event.target)}`;
    case "FlipThree":
      return event.by === event.target ? `${name(event.by)}让自己连翻三张` : `${name(event.by)}让${name(event.target)}连翻三张`;
    case "SecondChanceGiven":
      return `${name(event.by)}把二次机会给了${name(event.target)}`;
    case "ModifierGiven":
      return event.by === event.target ? `${name(event.by)}留下了 ${cardName(event.card)}` : `${name(event.by)}把 ${cardName(event.card)} 给了${name(event.target)}`;
    case "Discarded":
      return `${name(event.player)}的${cardName(event.card)}作废`;
    case "Flip7":
      return `${name(event.player)}凑齐 7 张不同的数字，翻七！`;
    case "Flip7Choice":
      return event.target === null ? `${name(event.player)}拿走翻七奖励 +15` : `${name(event.player)}让${name(event.target)}本轮 −15`;
    case "Reshuffled":
      return `牌堆摸光了，弃牌堆 ${event.count} 张洗成新牌堆`;
    case "TurnTimedOut":
      return `${name(event.player)}超时，自动处理`;
    case "RoundEnded":
      return `第 ${event.round} 轮结束${event.reason === "flip7" ? "（有人翻七）" : ""}`;
    case "GameEnded":
      return `${event.winners.map(name).join("、")}获胜！`;
    default:
      return null;
  }
}

/** 每张新牌的出场顺序（按事件先后），用来错开翻牌动画；爆掉、翻七等印章跟在对应的牌后面出现。 */
interface Fresh {
  readonly cards: Map<number, number>;
  readonly stamps: Map<string, number>;
  readonly steps: number;
}

function freshFrom(events: readonly GameEvent[]): Fresh {
  const cards = new Map<number, number>();
  const stamps = new Map<string, number>();
  let step = 0;
  for (const event of events) {
    if (event.type === "Drew") cards.set(event.card.id, step++);
    else if (event.type === "Busted" || event.type === "Flip7" || event.type === "Frozen" || event.type === "Saved") {
      const who = event.type === "Frozen" ? event.target : event.player;
      stamps.set(`${event.type}:${who}`, Math.max(0, step - 1));
    }
  }
  return { cards, stamps, steps: step };
}

const STEP_MS = 260;

/** 座位网格：按可用空间和人数选列数，让牌尽量大（数字字号 12 的整数倍、图标 32 的整数倍）。 */
interface Layout {
  cols: number;
  /** side：座位够宽时名字和分数放在左边、牌放在右边；stack：名字在上、牌在下。 */
  side: boolean;
  cw: number;
  cf: number;
  ci: number;
  mobile: boolean;
}

const SLOTS = 8; // 7 张数字牌 + 1 张修饰牌的位置
const GAP = 4;
const SEAT_PAD_X = 20;
const SEAT_OVERHEAD_Y = 66; // 座位的标题行 + 内边距 + 间距
const SIDE_HEAD_W = 196; // side 布局里左边名字和分数那一栏
const SIDE_OVERHEAD_Y = 20;

function cardSizes(cw: number): Pick<Layout, "cw" | "cf" | "ci"> {
  const width = Math.max(30, Math.floor(cw));
  const cf = Math.max(24, Math.floor((width * 0.6) / 12) * 12);
  const ci = width >= 80 ? 64 : 32;
  return { cw: width, cf, ci };
}

function pickLayout(width: number, height: number, count: number, mobile: boolean): Layout {
  const cellWidth = (cols: number) => (width - (cols - 1) * 10) / cols;
  const rowCard = (rowWidth: number) => (rowWidth - (SLOTS - 1) * GAP) / SLOTS;
  if (mobile) return { cols: 1, side: false, mobile, ...cardSizes(Math.min(rowCard(cellWidth(1) - SEAT_PAD_X), 64)) };
  let best = { cols: 1, side: false, cw: 0 };
  for (let cols = 1; cols <= count; cols += 1) {
    const rows = Math.ceil(count / cols);
    const cellW = cellWidth(cols);
    const cellH = (height - (rows - 1) * 10) / rows;
    const stack = Math.min(rowCard(cellW - SEAT_PAD_X), (cellH - SEAT_OVERHEAD_Y) / 1.4);
    const side = Math.min(rowCard(cellW - SEAT_PAD_X - SIDE_HEAD_W), (cellH - SIDE_OVERHEAD_Y) / 1.4);
    if (stack > best.cw + 0.5) best = { cols, side: false, cw: stack };
    if (side > best.cw + 0.5) best = { cols, side: true, cw: side };
  }
  return { cols: best.cols, side: best.side, mobile, ...cardSizes(Math.min(best.cw, 168)) };
}

function useSeatLayout(count: number): [React.RefObject<HTMLDivElement | null>, Layout] {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>({ cols: 2, side: false, cw: 48, cf: 24, ci: 32, mobile: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const mobile = window.innerWidth < 760;
      const next = pickLayout(element.clientWidth, element.clientHeight, count, mobile);
      setLayout((previous) => (previous.cols === next.cols && previous.cw === next.cw && previous.side === next.side && previous.mobile === next.mobile ? previous : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [count]);
  return [ref, layout];
}

/** 背景图 512×288，按整数倍放大到盖满屏幕。 */
function useBackdropSize(): string {
  const compute = () => {
    const scale = Math.max(1, Math.ceil(Math.max(window.innerWidth / 512, window.innerHeight / 288)));
    return `${512 * scale}px ${288 * scale}px`;
  };
  const [size, setSize] = useState(compute);
  useEffect(() => {
    const update = () => setSize(compute());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

function Avatar({ player }: { player: Player }) {
  return (
    <span className="f7-avatar" style={{ "--seat": seatColor(player.color) } as CSSProperties}>
      <img src={art.avatar(player.color)} alt="" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
    </span>
  );
}

function Seat({
  game,
  index,
  me,
  online,
  fresh,
  pickable,
  hint,
  onPick,
}: {
  game: GameState;
  index: number;
  me: boolean;
  online: boolean;
  fresh: Fresh;
  pickable: boolean;
  hint: string | null;
  onPick: () => void;
}) {
  const player = game.players[index]!;
  const live = scorePlayer(game, index);
  const roundOver = game.stage === "roundEnd" || game.phase === "finished";
  const isActor = game.phase === "playing" && game.actor === index;
  const delay = (id: number) => fresh.cards.get(id);
  const stampDelay = (type: string) => fresh.stamps.get(`${type}:${player.id}`);
  const cardStyle = (id: number): CSSProperties | undefined => {
    const order = delay(id);
    return order === undefined ? undefined : { animationDelay: `${order * STEP_MS}ms` };
  };
  const status = player.flip7 ? "flip7" : player.status;
  const stampAt = player.flip7 ? stampDelay("Flip7") : player.status === "busted" ? stampDelay("Busted") : player.status === "frozen" ? stampDelay("Frozen") : undefined;
  const stampStyle = stampAt === undefined ? undefined : ({ animationDelay: `${(stampAt + 1) * STEP_MS}ms` } as CSSProperties);
  const empty = Math.max(0, 7 - player.numbers.length - (player.bustCard ? 1 : 0));
  const classes = ["f7-seat", `st-${status}`, me ? "me" : "", isActor ? "actor" : "", !online ? "offline" : "", pickable ? "pickable" : "", index === game.dealer ? "dealer" : ""].join(" ");
  const body = (
    <>
      <header className="f7-seat-head">
        <Avatar player={player} />
        <span className="f7-seat-name">
          <strong>{me ? `${player.name}（你）` : player.name}</strong>
          <small>
            {index === game.dealer && <em className="f7-tag dealer">庄</em>}
            {!online && <em className="f7-tag off">离线</em>}
            {player.secondChance && <img className="f7-chip-icon" src={art.secondChance} alt="二次机会" title={ACTION_HELP.secondChance} />}
            {player.actions.map((card) => <img key={card.id} className="f7-chip-icon" src={cardIcon(card.kind)!} alt={cardName(card)} title={ACTION_HELP[card.kind as "freeze"]} />)}
            <span className={`f7-status s-${status}`}>{player.flip7 ? "翻七！" : isActor && game.stage === "turn" ? "思考中" : STATUS_LABEL[player.status]}</span>
          </small>
        </span>
        {pickable && hint && <span className="f7-pick-hint">{hint}</span>}
        <span className="f7-seat-score" title="本轮得分 / 总分">
          <b className={live.total < 0 ? "neg" : ""}>{roundOver && player.lastRound ? (player.lastRound.total >= 0 ? `+${player.lastRound.total}` : player.lastRound.total) : live.total}</b>
          <i>总 {player.score}</i>
        </span>
      </header>
      <div className="f7-row">
        {player.numbers.map((card) => <CardView key={card.id} card={card} className={delay(card.id) !== undefined ? "fresh" : ""} style={cardStyle(card.id)} />)}
        {player.bustCard && <CardView key={player.bustCard.id} card={player.bustCard} className={`dup ${delay(player.bustCard.id) !== undefined ? "fresh" : ""}`} style={cardStyle(player.bustCard.id)} title={`重复的 ${player.bustCard.value}，爆了`} />}
        {Array.from({ length: empty }, (_, k) => <span key={`e${k}`} className="f7-card slot" aria-hidden="true" />)}
        {player.modifiers.length > 0 && <span className="f7-row-gap" aria-hidden="true" />}
        {player.modifiers.map((card) => <CardView key={card.id} card={card} className={delay(card.id) !== undefined ? "fresh" : ""} style={cardStyle(card.id)} />)}
      </div>
      {(status === "busted" || status === "flip7" || status === "frozen") && (
        <span className={`f7-stamp s-${status}`} style={stampStyle} aria-hidden="true">
          <span className="f7-stamp-inner">
            {status === "busted" && <span className="f7-fx bust" style={{ ...stampStyle, "--frames": FX_FRAMES.bust, backgroundImage: `url(${art.bustFx})` } as CSSProperties} />}
            <b>
              {status === "flip7" ? (
                <span className="f7-fx flip7" style={{ ...stampStyle, "--frames": FX_FRAMES.flip7, backgroundImage: `url(${art.flip7Fx})` } as CSSProperties} />
              ) : (
                <img src={status === "busted" ? art.bust : art.freeze} alt="" />
              )}
              {status === "busted" ? "爆了" : status === "flip7" ? "翻七" : "冻结"}
            </b>
          </span>
        </span>
      )}
    </>
  );
  const style = { "--seat": seatColor(player.color) } as CSSProperties;
  return pickable ? (
    <button type="button" className={classes} style={style} onClick={onPick}>{body}</button>
  ) : (
    <section className={classes} style={style} aria-label={`${player.name}的牌`}>{body}</section>
  );
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onDissolve }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const myId = member?.playerId ?? "";
  const isHost = member?.isHost ?? false;
  const myIndex = game.players.findIndex((player) => player.id === myId);
  const me = game.players[myIndex];
  const actor = game.players[game.actor];
  const myMove = game.phase === "playing" && game.actor === myIndex && myIndex !== -1;
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === myId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const online = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId)?.connected ?? false;
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const send = (command: GameCommand) => { if (!busy) onCommand(command); };

  // 只在 version 变了的时候播新牌动画（聊天也会推整个房间状态）；刚进房间 / 重连时不播。
  const fresh = useMemo<Fresh>(
    () => (game.version === firstVersion.current ? { cards: new Map(), stamps: new Map(), steps: 0 } : freshFrom(game.events)),
    [game.version],
  );

  // 座位顺序：从自己开始按座位往下数。
  const order = useMemo(() => {
    const n = game.players.length;
    const start = Math.max(0, myIndex);
    return Array.from({ length: n }, (_, k) => (start + k) % n);
  }, [game.players.length, myIndex]);
  const [seatsRef, layout] = useSeatLayout(game.players.length);

  // 选目标
  const top = game.pending.at(-1);
  const giving: Card | null = game.stage === "target" && top?.type === "target" ? top.card : null;
  const targets = useMemo(() => (giving && game.actor >= 0 ? targetsFor(game, game.actor, giving) : []), [game.version, giving]);
  const canPick = (index: number) => myMove && ((giving !== null && targets.includes(index)) || (game.stage === "flip7Choice" && index !== myIndex));
  const pickHint = (index: number): string | null => {
    if (!canPick(index)) return null;
    const self = index === myIndex;
    if (game.stage === "flip7Choice") return "罚他 −15";
    switch (giving?.kind) {
      case "freeze":
        return self ? "冻结自己" : "冻结他";
      case "flipThree":
        return self ? "自己翻三" : "让他翻三";
      default:
        return self ? "留给自己" : "给他";
    }
  };
  const pick = (index: number) => {
    const id = game.players[index]!.id;
    if (game.stage === "flip7Choice") send({ type: "FLIP7", target: id });
    else send({ type: "TARGET", target: id });
  };

  // 键盘：H / 空格 要牌，S 停牌，N 下一轮。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (myMove && game.stage === "turn" && (key === "h" || key === " ")) {
        event.preventDefault();
        send({ type: "HIT" });
      } else if (myMove && game.stage === "turn" && key === "s") {
        send({ type: "STAY" });
      } else if (game.stage === "roundEnd" && game.phase === "playing" && key === "n" && !game.ready.includes(myId)) {
        send({ type: "READY" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 在后台时标题提示轮到你了
  useEffect(() => {
    const base = "翻七 · 在线对战";
    const needsMe = myMove || (game.stage === "roundEnd" && game.phase === "playing" && !game.ready.includes(myId));
    document.title = myMove && document.hidden ? `【轮到你】${base}` : base;
    const onVisibility = () => { document.title = needsMe && document.hidden && myMove ? `【轮到你】${base}` : base; };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.title = base;
    };
  }, [myMove, game.stage, game.version]);

  // 动作记录：断线重连后用 history 补上。
  const log = useMemo(() => {
    const lines: { key: string; text: string }[] = [];
    const history = game.history;
    const offset = game.version * 1000;
    history.forEach((event, index) => {
      const text = describeEvent(event, nameOf);
      if (text) lines.push({ key: `${offset - history.length + index}`, text });
    });
    return lines.reverse();
  }, [game.version]);
  const [sideTab, setSideTab] = useState<"log" | "chat">("log");
  const [chatSeen, setChatSeen] = useState(room.chat.length);
  useEffect(() => { if (sideTab === "chat") setChatSeen(room.chat.length); }, [sideTab, room.chat.length]);
  const unread = sideTab === "chat" ? 0 : Math.max(0, room.chat.length - chatSeen);

  const [hideSummary, setHideSummary] = useState(false);
  useEffect(() => setHideSummary(false), [game.round, game.phase]);

  const risk = me && me.status === "active" ? bustChance(game, me) : null;
  const live = myIndex >= 0 ? scorePlayer(game, myIndex) : null;
  const backdrop = backdropFor(room.code);
  const backdropSize = useBackdropSize();

  let headline: string;
  let detail = "";
  if (game.phase === "finished") headline = "对局结束";
  else if (game.stage === "roundEnd") {
    headline = `第 ${game.round} 轮结算`;
    detail = game.ready.includes(myId) ? `等其他人（${game.ready.length}/${game.players.length}）` : "看完结算点「下一轮」";
  } else if (myMove && game.stage === "turn") {
    headline = "轮到你了";
    detail = me && me.numbers.length > 0 ? `要牌还是停牌？现在停牌本轮得 ${live?.total ?? 0} 分。` : "要牌还是停牌？你面前还没有数字牌。";
  } else if (myMove && giving) {
    headline = `把「${cardName(giving)}」交给谁？`;
    detail = `${ACTION_HELP[giving.kind as "freeze"]}。点亮着的座位，或下面的名字。`;
  } else if (myMove && game.stage === "flip7Choice") {
    headline = "你翻七了！";
    detail = "自己拿 +15，或者让一位对手本轮 −15。";
  } else if (actor) {
    const who = actor.name;
    headline = game.stage === "turn" ? `轮到 ${who}` : game.stage === "flip7Choice" ? `${who} 翻七了！` : `${who} 在给「${cardName(giving!)}」选目标`;
    detail = game.stage === "turn" ? `${who}在想要牌还是停牌` : game.stage === "flip7Choice" ? "在选 +15 还是罚人 −15" : ACTION_HELP[giving!.kind as "freeze"];
  } else headline = "";

  return (
    <div
      className={layout.mobile ? "f7-screen mobile" : "f7-screen"}
      style={{ "--backdrop": `url(${backdrop})`, "--bs": backdropSize } as CSSProperties}
    >
      <header className="f7-topbar">
        {brand}
        <div className="f7-round">
          <span>第 <b>{game.round}</b> 轮</span>
          <span className="f7-goal">先到 {game.config.targetScore} 分</span>
          {game.config.brutal && <span className="f7-brutal" title="残酷模式：修饰牌可以给任何人；翻七可以改成罚一位对手 −15">残酷</span>}
        </div>
        <div className="f7-topbar-right">
          {themeToggle}
          <GameRules brutal={game.config.brutal} />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>

      <div className="f7-layout">
        <div
          className={["f7-seats", layout.side ? "side" : "", layout.cw >= 72 ? "big-cards" : ""].join(" ")}
          ref={seatsRef}
          style={{ "--cols": layout.cols, "--cw": `${layout.cw}px`, "--cf": `${layout.cf}px`, "--ci": `${layout.ci}px` } as CSSProperties}
        >
          {order.map((index) => (
            <Seat
              key={game.players[index]!.id}
              game={game}
              index={index}
              me={index === myIndex}
              online={online(game.players[index]!.id)}
              fresh={fresh}
              pickable={canPick(index)}
              hint={pickHint(index)}
              onPick={() => pick(index)}
            />
          ))}
          {game.stage === "roundEnd" && game.phase === "playing" && !hideSummary && (
            <RoundSummary game={game} myId={myId} secondsLeft={secondsLeft} busy={busy} onReady={() => send({ type: "READY" })} onHide={() => setHideSummary(true)} />
          )}
        </div>

        <aside className="f7-side">
          <section className={myMove || (game.stage === "roundEnd" && !game.ready.includes(myId)) ? "f7-panel f7-action mine" : "f7-panel f7-action"}>
            <div className="f7-action-head">
              {actor && game.stage !== "roundEnd" && <i className="f7-dot" style={{ background: seatColor(actor.color) }} />}
              <h2>{headline}</h2>
              {game.phase === "playing" && secondsLeft !== null && <b className={secondsLeft <= 10 ? "f7-timer low" : "f7-timer"}>{secondsLeft}s</b>}
            </div>
            {detail && <p className="f7-action-detail">{detail}</p>}

            {myMove && game.stage === "turn" && (
              <div className="f7-buttons">
                <button className="primary-button f7-hit" type="button" disabled={busy} onClick={() => send({ type: "HIT" })}>要牌<small>H</small></button>
                <button className="quiet-button f7-stay" type="button" disabled={busy} onClick={() => send({ type: "STAY" })}>停牌<small>S</small></button>
              </div>
            )}
            {myMove && giving && (
              <div className="f7-target-list">
                <CardView card={giving} className="f7-giving" />
                <div>
                  {targets.map((index) => {
                    const player = game.players[index]!;
                    const odds = player.status === "active" ? Math.round(bustChance(game, player) * 100) : null;
                    return (
                      <button key={player.id} type="button" className="quiet-button" disabled={busy} onClick={() => pick(index)}>
                        <i className="f7-dot" style={{ background: seatColor(player.color) }} />
                        {index === myIndex ? "自己" : player.name}
                        <small>本轮 {scorePlayer(game, index).total}{odds !== null && giving.kind === "flipThree" ? ` · 每张爆 ${odds}%` : ""}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {myMove && game.stage === "flip7Choice" && (
              <div className="f7-target-list flip7">
                <button className="primary-button" type="button" disabled={busy} onClick={() => send({ type: "FLIP7", target: null })}>自己 +15</button>
                <div>
                  {game.players.map((player, index) => index === myIndex ? null : (
                    <button key={player.id} type="button" className="quiet-button" disabled={busy} onClick={() => pick(index)}>
                      <i className="f7-dot" style={{ background: seatColor(player.color) }} />{player.name}<small>总 {player.score} · 罚 −15</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {game.stage === "roundEnd" && game.phase === "playing" && (
              <div className="f7-buttons">
                <button className="primary-button" type="button" disabled={busy || game.ready.includes(myId)} onClick={() => send({ type: "READY" })}>
                  {game.ready.includes(myId) ? "已准备" : "下一轮"}<small>N</small>
                </button>
                {hideSummary && <button className="quiet-button" type="button" onClick={() => setHideSummary(false)}>看结算</button>}
              </div>
            )}

            <div className="f7-deck">
              <CardBack />
              <div>
                <span>牌堆 <b>{game.deckCount}</b></span>
                <span>弃牌 {game.discardCount}</span>
              </div>
              {risk !== null && (
                <div className={risk >= 0.35 ? "f7-risk high" : "f7-risk"} title="牌堆里和你面前数字重复的牌占多少">
                  <span>再要一张爆掉</span>
                  <b>{me?.secondChance ? "0%" : `${Math.round(risk * 100)}%`}</b>
                </div>
              )}
            </div>
            {(error || shownNotice) && <p className={error ? "f7-feedback error" : "f7-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
          </section>

          <section className="f7-panel f7-tabs">
            <div className="f7-tab-bar" role="tablist">
              <button type="button" role="tab" aria-selected={sideTab === "log"} className={sideTab === "log" ? "active" : ""} onClick={() => setSideTab("log")}>动作记录</button>
              <button type="button" role="tab" aria-selected={sideTab === "chat"} className={sideTab === "chat" ? "active" : ""} onClick={() => setSideTab("chat")}>
                聊天{unread > 0 && <em>{unread}</em>}
              </button>
            </div>
            {sideTab === "log" ? (
              <ul className="f7-log">{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>
            ) : (
              <div className="f7-chat">{chat}</div>
            )}
          </section>
        </aside>
      </div>
      {game.phase === "finished" && <FinalDialog game={game} room={room} myId={myId} onRematch={onRematch} />}
    </div>
  );
}

function scoreParts(game: GameState, index: number): string {
  const result = game.players[index]!.lastRound;
  if (!result) return "";
  if (result.busted) return result.penalty ? `爆了 · 被罚 ${result.penalty}` : "爆了";
  const parts = [`数字 ${result.numbers}`];
  if (result.plus) parts.push(`+${result.plus}`);
  if (result.doubled) parts.push("×2");
  if (result.bonus) parts.push(`翻七 +${result.bonus}`);
  if (result.penalty) parts.push(`被罚 ${result.penalty}`);
  return parts.join(" · ");
}

function RoundSummary({ game, myId, secondsLeft, busy, onReady, onHide }: {
  game: GameState;
  myId: string;
  secondsLeft: number | null;
  busy: boolean;
  onReady: () => void;
  onHide: () => void;
}) {
  const rows = game.players.map((player, index) => ({ player, index })).sort((a, b) => b.player.score - a.player.score);
  const target = game.config.targetScore;
  const ready = game.ready.includes(myId);
  return (
    <section className="f7-summary" aria-label={`第 ${game.round} 轮结算`}>
      <header>
        <h2>第 {game.round} 轮结算</h2>
        <button className="quiet-button" type="button" onClick={onHide}>看牌桌</button>
      </header>
      <ol>
        {rows.map(({ player, index }) => {
          const result = player.lastRound!;
          return (
            <li key={player.id} className={player.id === myId ? "mine" : ""}>
              <i className="f7-dot" style={{ background: seatColor(player.color) }} />
              <span className="f7-sum-name">{player.name}{player.id === myId ? "（你）" : ""}<small>{scoreParts(game, index)}</small></span>
              <b className={result.total < 0 ? "neg" : result.total === 0 ? "zero" : ""}>{result.total >= 0 ? `+${result.total}` : result.total}</b>
              <span className="f7-sum-total">
                <strong>{player.score}</strong>
                <span className="f7-bar"><i style={{ width: `${Math.max(0, Math.min(100, (player.score / target) * 100))}%` }} /></span>
              </span>
            </li>
          );
        })}
      </ol>
      <footer>
        <button className="primary-button" type="button" disabled={busy || ready} onClick={onReady}>
          {ready ? `等其他人 ${game.ready.length}/${game.players.length}` : "下一轮"}{secondsLeft !== null && <small>{secondsLeft}s</small>}
        </button>
      </footer>
    </section>
  );
}

function FinalDialog({ game, room, myId, onRematch }: { game: GameState; room: LobbyRoomSnapshot; myId: string; onRematch: (accept: boolean) => void }) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const won = (id: string) => result.winners.includes(id);
  const rows = [...game.players].sort((a, b) => b.score - a.score);
  const title = won(myId) ? (result.winners.length > 1 ? "并列获胜！" : "你赢了！") : `${result.winners.map((id) => game.players.find((p) => p.id === id)?.name).join("、")} 获胜`;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel f7-final" role="dialog" aria-modal="true" aria-labelledby="f7-final-title">
        <img className="f7-final-icon" src={art.flip7} alt="" />
        <h2 id="f7-final-title">{title}</h2>
        <p className="f7-muted">打了 {game.round} 轮，有人到了 {game.config.targetScore} 分，总分最高者获胜。</p>
        <ol className="f7-standings">
          {rows.map((player, rank) => (
            <li key={player.id} className={won(player.id) ? "winner" : ""}>
              <span className="f7-rank">{rank + 1}</span>
              <i className="f7-dot" style={{ background: seatColor(player.color) }} />
              <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
              <b>{player.score}</b>
            </li>
          ))}
        </ol>
        {room.rematch && (
          <div className="f7-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
