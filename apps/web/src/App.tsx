import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { CAPACITY_OPTIONS, type Capacity, type GameCommand, type LobbyRoomSnapshot, type PublicRoomSummary } from "@flip7/game";
import { art, seatColor } from "./art.js";
import { CardView } from "./cards.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [brutal, setBrutal] = useState(true);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom(snapshot);
    const handleRoomError = (message: string) => setError(message);
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity, brutal }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("对局已开始，祝你好运。" );
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。" );
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const changeBrutal = (value: boolean) => roomCommand((ack) => socket.emit("room:settings", { brutal: value }, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。" );
    } catch {
      setNotice("请手动复制房间码。" );
    }
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main className="app-shell f7-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <main className="app-shell f7-room">
        <header className="topbar">
          <Brand />
          <div className="topbar-right">
            {themeToggle}
            <GameRules brutal={room.brutal} />
            <ConnectionStatus connected={connected} />
          </div>
        </header>
        <RoomView
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          onCopyCode={copyRoomCode}
          onLeave={leaveRoom}
          onStart={startGame}
          onKick={kickMember}
          onDissolve={dissolveRoom}
          onBrutal={changeBrutal}
          chat={<RoomChat room={room} voice={voice} />}
        />
        {confirmDialog}
      </main>
    );
  }

  return (
    <main className="app-shell f7-home">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          {themeToggle}
          <GameRules />
          <ConnectionStatus connected={connected} />
        </div>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> 在线对战 · 3–10 人 · 测试版</div>
          <h1>翻七</h1>
          <p className="welcome-description">
            一轮一轮地翻牌：每次决定再要一张，还是见好就收。翻到和面前重复的数字就爆掉，这一轮白干；
            凑齐 7 张不同的数字就是「翻七」，额外 +15。冻结、翻三、二次机会可以塞给别人。先到 200 分的那一轮打完，总分最高的人获胜。
          </p>
          <img className="f7-hero" src={art.hero} alt="" />
          <div className="f7-showcase" aria-hidden="true">
            {[1, 4, 7, 9, 12].map((value) => <CardView key={value} card={{ kind: "number", value }} />)}
            <CardView card={{ kind: "plus", value: 8 }} />
            <CardView card={{ kind: "freeze", value: 0 }} />
            <CardView card={{ kind: "secondChance", value: 0 }} />
          </div>
        </div>

        <div className="f7-home-side">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="entry-card-heading">
              <div>
                <span className="section-kicker">准备开始</span>
                <h2 id="entry-title">进入牌桌</h2>
              </div>
              <span className="step-indicator">01 <i /> 02</span>
            </div>

            <div className="mode-switch" role="tablist" aria-label="选择房间操作">
              <button
                className={mode === "create" ? "mode-tab active" : "mode-tab"}
                type="button"
                role="tab"
                aria-selected={mode === "create"}
                onClick={() => { setMode("create"); setError(""); }}
              >
                创建房间
              </button>
              <button
                className={mode === "join" ? "mode-tab active" : "mode-tab"}
                type="button"
                role="tab"
                aria-selected={mode === "join"}
                onClick={() => { setMode("join"); setError(""); }}
              >
                加入房间
              </button>
            </div>

            <form className="entry-form" onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="player-name">你的昵称</label>
              <input
                id="player-name"
                className="text-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="输入 2–18 个字符"
                minLength={2}
                maxLength={18}
                autoComplete="nickname"
                required
              />

              {mode === "create" ? (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                  <div className="capacity-options f7-seats-pick" id="room-capacity" role="group" aria-label="选择房间人数">
                    {CAPACITY_OPTIONS.map((seats) => (
                      <button
                        key={seats}
                        type="button"
                        className={capacity === seats ? "capacity-option selected" : "capacity-option"}
                        aria-pressed={capacity === seats}
                        onClick={() => setCapacity(seats)}
                      >
                        <strong>{seats}</strong>
                        <span>人</span>
                      </button>
                    ))}
                  </div>
                  <label className="field-label field-label-spaced" htmlFor="room-mode">玩法</label>
                  <BrutalOptions id="room-mode" value={brutal} onChange={setBrutal} />
                  <p className="field-hint">至少 3 位玩家后，房主即可开始。</p>
                </>
              ) : (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                  <input
                    id="room-code"
                    className="text-input room-code-input"
                    value={roomCode}
                    onChange={(event) => setRoomCode(normalizeRoomCode(event.target.value))}
                    placeholder="例如：7KQ2TX"
                    autoComplete="off"
                    maxLength={6}
                    required
                  />
                  <p className="field-hint">房间码为 6 位字母或数字，不含易混淆字符。掉线后用原昵称和房间码可回到进行中的对局。</p>
                </>
              )}

              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

              <button className="primary-button" type="submit" disabled={!canSubmit}>
                {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建私人房间" : "加入牌桌"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            <div className="entry-footnote"><span className="lock-icon">◇</span> 默认邀请制 · 房主可以设为公开</div>
          </section>
          <OnlineRooms rooms={lobbyRooms} connected={connected} busy={busy} onJoin={joinListed} />
        </div>
      </section>
    </main>
  );
}

function BrutalOptions({ id, value, onChange, disabled = false }: { id?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="capacity-options f7-mode-options" id={id} role="group" aria-label="选择玩法">
      {[
        { brutal: true, title: "残酷模式", note: "修饰牌能塞给别人，翻七可罚人 −15" },
        { brutal: false, title: "普通模式", note: "修饰牌自己拿，翻七 +15" },
      ].map((option) => (
        <button
          key={option.title}
          type="button"
          disabled={disabled}
          className={value === option.brutal ? "capacity-option selected" : "capacity-option"}
          aria-pressed={value === option.brutal}
          onClick={() => onChange(option.brutal)}
        >
          <strong>{option.title}</strong>
          <span>{option.note}</span>
        </button>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="翻七首页">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-name">翻七<span> PUSH YOUR LUCK</span></span>
    </a>
  );
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "服务已连接" : "连接中…"}
    </div>
  );
}

function RoomView({
  room,
  busy,
  error,
  notice,
  onCopyCode,
  onLeave,
  onStart,
  onKick,
  onDissolve,
  onBrutal,
  chat,
}: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onDissolve: () => void;
  onBrutal: (value: boolean) => void;
  chat: ReactNode;
}) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);

  return (
    <section className="room-layout">
      <div className="room-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {room.status === "waiting" ? "等待大厅" : "对局已创建"}</div>
          <h1>{spectating ? "你在观战。" : room.status === "waiting" ? "牌桌准备中。" : "好戏即将开始。"}</h1>
          <p>{spectating ? "等房主开始对局；有空座位时可以坐下一起玩。" : room.status === "waiting" ? "把房间码分享给朋友，等大家就位后开始。" : "对局马上开始。"}</p>
        </div>
        <div className="room-heading-actions">
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
          <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
            {spectating ? "离开观战" : "离开房间"}
          </button>
        </div>
      </div>

      {room.status === "waiting" ? (
        <div className="room-grid">
          <section className="room-panel room-code-panel">
            <div className="panel-label">房间码 <span>仅分享给朋友</span></div>
            {room.code ? (
              <>
                <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码">
                  {room.code}<span aria-hidden="true">⧉</span>
                </button>
                <div className="room-code-caption">点击复制 · 6 位邀请代码</div>
              </>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
          </section>

          <section className="room-panel player-panel">
            <div className="panel-topline">
              <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
              <span className="waiting-pill"><i /> 等待中</span>
            </div>
            <div className={room.capacity > 5 ? "player-list f7-two-cols" : "player-list"}>
              {room.members.map((member, index) => (
                <div className="player-row" key={member.id}>
                  <div className="player-avatar f7-member-avatar" style={{ background: seatColor(index) } as CSSProperties}>
                    <img src={art.avatar(index)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                    <span>{member.name.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div className="player-details">
                    <strong>{member.name}{member.id === socket.id ? <small>你</small> : null}</strong>
                    <span>{member.isHost ? "房主" : "已加入"}</span>
                  </div>
                  {member.isHost && <span className="host-badge">房主</span>}
                  {isHost && !member.isHost && (
                    <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                  )}
                </div>
              ))}
              {Array.from({ length: openSeats }, (_, index) => (
                <div className="player-row open-seat" key={`open-${index}`}>
                  <div className="empty-avatar"><span>＋</span></div>
                  <div className="player-details"><strong>等待玩家加入</strong><span>{room.access.open ? "公开房间，路过的人也能加入" : "分享房间码邀请朋友"}</span></div>
                </div>
              ))}
            </div>
            <div className="f7-room-mode">
              <span className="field-label">玩法{isHost ? "（房主可改）" : ""}</span>
              <BrutalOptions value={room.brutal} onChange={onBrutal} disabled={!isHost} />
            </div>
            <p className="field-hint">每个决定限时 30 秒，超时自动停牌；先到 200 分的那一轮打完，总分最高者获胜。</p>
            <RoomSettingsPanel room={room} />
            <SeatSwitch room={room} />
            <div className="room-actions">
              {isHost ? (
                <button className="primary-button" type="button" onClick={onStart} disabled={busy || room.members.length < 3}>
                  {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}<span aria-hidden="true">↗</span>
                </button>
              ) : (
                <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等待房主开始对局"}</div>
              )}
              {isHost && room.members.length < 3 && <p className="field-hint centered">还需要至少 {3 - room.members.length} 位玩家加入。</p>}
            </div>
          </section>
          <div className="f7-room-chat">{chat}</div>
        </div>
      ) : null}

      {error && <p className="feedback feedback-error room-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success room-feedback" role="status">{notice}</p>}
      <div className="room-secure-note"><span>◇</span> {room.access.open ? "公开房间：首页列表里的人可以直接加入空座位。" : "邀请制：要有房间码才能加入；首页列表不显示房间码。"}</div>
    </section>
  );
}

export default App;
