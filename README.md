# 幸运数字（Lucky Numbers）

2–4 人的数字排布桌游，网页联机版。规则书在 `~/Desktop/游戏规则/幸运数字.md`。线上 https://gulugagame.com/lucky/ 。

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3009，网页 :5182
npm test             # 规则引擎（11 个用例，含 400 局随机模拟）
npm run typecheck
```

## 规则要点

- 每人 4×4 棋盘，每一行从左到右、每一列从上到下严格递增（同行同列不能重复）。第一个摆满 16 格的人获胜。
- 牌池 1–20 每个数字的份数 = 玩家人数。开局每人盲抽 4 张，从小到大摆在对角线上（规则书的「简易开局」）。
- 每回合二选一：从牌池盲抽一张（放上棋盘或弃到桌面），或拿桌面上的一张明牌（必须放上棋盘）。放牌可以放进空格，也可以换下已有的牌，换下的牌放到桌面。

规则书没写死、这里这样处理的地方：

| 情况 | 处理 |
| --- | --- |
| 牌池抽光 | 抽到最后一张的那个回合结束后立刻结算：棋盘上牌最多的人获胜，一样多就并列 |
| 桌面上的明牌放不进自己的棋盘 | 不能拿（拿了必须放，所以界面上不让点） |
| 从牌池抽的牌别人看不看得到 | 看不到，放下或弃掉后才公开 |
| 限时 | 每一步 45 秒。还没选：从牌池抽一张直接弃掉；手里是抽来的牌：弃掉；手里是拿来的明牌：放到第一个能放的位置（优先空格） |
| 变体 | Michael 开局、Bruno 变体、多局计分都没做 |

## 目录

- `packages/game`：纯函数规则引擎（`engine.ts`、`board.ts` 的 `canPlace` / `legalCells`）和测试。
- `apps/server`：Socket.IO 房间、计时、重连、语音信令（和其他游戏同一套）。
- `apps/web`：React 网页。`GameBoard.tsx` 是牌桌，数字牌 = PixelLab 画的空白牌面 + 像素字体数字。
- `art/`：`art.py` 生成候选（首页主图、牌面、四叶草图标），`selection.json` 记选中的，`export.py` 导出到 `apps/web/public/art/`。

## 画面：白天版和夜间版

只有像素风一种画面（原始版本已删掉），配色分夜间（深色，默认）和白天（白底）两种。顶栏「切换白天版 / 切换夜间版」随时切换，只影响自己看到的画面，记在浏览器的 `gm-pixel-theme` 里；gulugagame.com 上的大厅和各个游戏同源，共用这一个选择。

- 夜间配色就是 `app-pixel.css`（首页和等候房间）和 `lucky.css`（牌桌）本身。白天版不单独写：`apps/web/day-theme.ts`（Vite 插件）在构建时把这些样式里和颜色有关的声明照抄一份，选择器前加 `:root[data-theme="day"]`，按 `apps/web/day-palette.ts` 的调色表换成白天的颜色。改夜间样式时白天版自动跟着变，只有新出现的深色需要在调色表里补一行。
- 机械换色不合适的地方在 `apps/web/src/theme-day.css` 里手写。
- `index.html` 里一小段脚本在样式生效前就给 `<html>` 加上 `data-theme="day"`，打开页面不会先闪一下深色；切换逻辑和按钮在 `src/theme.tsx`。

## 部署

服务器上 `~/lucky`，pm2 进程 `lucky`（端口 3009），网页在 `/var/www/lucky`，Caddy `handle_path /lucky/*`（也在付费网关 `@games` 里）。本机运行 `~/projects/deploy.sh lucky`（服务器拉 GitHub 上的 main）。

pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动一个 `node --import tsx` 进程跑服务端（不经过 `npm start`）。端口和密钥存在 pm2 里，不进仓库。
