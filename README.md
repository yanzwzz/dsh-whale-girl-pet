# 🐋 dsh-whale-girl-pet — DeepSeek 娘桌宠

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-DeepSeek%20Harness%20Web-8A2BE2">
  <img alt="version" src="https://img.shields.io/npm/v/dsh-whale-girl-pet?label=npm&color=blue">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-orange">
  <img alt="assets" src="https://img.shields.io/badge/assets-46%2B%20animations-ff69b4">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/preview-idle.gif" width="150" alt="待机">
  <img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/preview-work.gif" width="150" alt="工作">
  <img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/preview-done.gif" width="150" alt="收工庆祝">
</p>

> 一只住在 DeepSeek Harness Web 界面右下角的「Q 版蓝发鲸鱼女仆（DeepSeek 娘）」桌宠。
> 她会在你工作时敲键盘、摸鱼时偷懒、任务完成时庆祝，还能报今日 Token 消耗与花费、查天气、喂她吃「TOKEN 小鱼干」。


---

## ✨ 功能特色

### 🖥️ 工作链路（Agent 干活时全程陪伴）
| 场景 | 动画 |
|------|------|
| 🟢 开工 | 「开始工作」：变出悬浮电脑桌 → 站姿开敲 |
| 🔄 工作中轮播 | 「认真工作 / 工作摸鱼 / 工作思考 / 摸鱼被抓」每 10.5s 随机切换 |
| 🎉 收工 | 「工作结束」：伸懒腰 → 比耶庆祝 |
| 😤 忙时点击 | 「工作被打扰」：惊到 → 嫌弃 → 继续干 |
| ⏰ 长任务超时 | 「长时间工作看表」：看表叹气（阈值可调） |

### 📊 任务完成统计气泡
每轮任务结束自动弹出多行排版，花费按 **缓存命中 / 缓存未命中 / 输出** 三桶分别列出：
```
任务完成啦！
用时 2分35秒
消耗 1.2M tokens
花费 ≈¥3.21
· 缓存命中 ≈¥0.28
· 缓存未命中 ≈¥0.02
· 输出 ≈¥2.91
```
- 用量按 DeepSeek 官方价目估算，**按每条用量的事件时间选档**：跨换价、跨峰谷的一次任务也能算准
- 峰谷：北京时间工作日 9:00-12:00、14:00-18:00 为高峰（空闲价的 2 倍），周末全天按空闲
- **2026-09-10 12:00 起 flash 系列调价**：空闲 0.02 / 1 / 4（元每百万 tokens），高峰为其 2 倍；pro 维持现价
- 缓存写入按未命中价计（对应官方 `prompt_cache_miss_tokens`）
- 统计包含子代理会话

### 📈 数据看板 · 分时段花费（📊 按钮）
宠物侧边按钮组的第四枚按钮，点开是一块**手写内联 SVG 看板（零图表依赖）**，回答「钱花在哪段时间」：

**两种视图 × 两种指标**

| | 今日分时 | 近 7 天 |
|---|---|---|
| 横轴 | 今天已过去的每个**北京小时** | 最近 N 个**北京日**（N 可在设置面板调 1–30） |
| 竖轴 | 该小时花费 / token | 该天花费 / token |
| 切换 | 「花费 ↔ token」一键切换，右侧「⟳」手动刷新 | 同左 |

**图怎么读**

- **三桶堆叠柱**：每根柱按「缓存命中（蓝）/ 缓存未命中（橙）/ 输出（紫）」分三段 → 一眼看出这段时间是"重输入"还是"重输出"
- **结构化坐标**：Y 轴 4 档刻度 + 网格线；柱顶数值只标**最高的几根 + 当前格**（token 视图 ≤12 格时全标），避免 24 格糊成一片
- **高峰底纹**：高峰计价时段（价 ×2）铺一层橙色底纹——柱色让给三桶，不再一身兼两职
- **当前时段高亮**：当前小时/今天加描边
- 鼠标悬停任意柱有完整 tooltip：金额、token、三桶明细、调用次数、峰谷

**汇总格（5 格）**

`近 24 小时` · `今日` · **`均值`** · `输入` · `输出`

- **均值**：写"平均每小时 ¥0.14 / 平均每天 ¥6.84"，**跟随当前视图与指标自动切换**，并对"屏幕上这批柱"取平均（不会出现图里 24 格、均值却按 7 天算的错位）
- **缓存命中率**：prompt 侧口径 `cacheRead / (input + cacheWrite + cacheRead)`，直接回答"这段时间省不省"
- 每格还带副行：tokens、调用次数、输出花费等

**面板随手放**

- 默认尺寸 **720×480**、默认位置**视口居中**（视口更小则按 `视口 − 24` 自动收窄，不会顶到屏幕边）
- **按住头部**拖到任意位置；**右下角**拖拽缩放（300×200 起）
- 位置与尺寸存 `localStorage`，刷新/重开都记得；**双击头部**恢复默认尺寸与居中
- 记忆带**版本号**，改动默认值时会自动作废旧记忆，不会出现"新默认值被老记忆盖住"

**数据从哪来**

- **实时**：宿主侧 `ctx.on('session/event')` 增量折叠，每条事件 O(1)，不轮询、不写盘
- **历史**：启动时用 `sessionPersistence` **补扫已落盘会话**（含重启前的今天早上），面板底部显示"已补扫 N 个会话 · M 条事件"
- **去重**：两条路径共用「每会话已见 seq 集合 + 调用身份（message.id / seq）」双重去重，先来后到都不重复计数；重试按两次调用计费
- 补扫失败只降级为"仅本次运行统计"并在面板底部说明，不影响其他功能
- 只读接口：`GET /api/whale-pet/usage`（可选 `?hours=1..24&days=1..30`），响应 `no-store`，约 10 KB

**健壮性**：弹层容器经 `portalContainer()` 校验（非真实 DOM 元素时退回内联渲染，避开 React `#200`），整个看板包在错误围栏里——看板自身出错只会显示错误文本，绝不会把桌宠打挂。

> 实现拆成三块：`lib/usage-ledger.js`（分时段账本，纯逻辑）、宿主路由 `/api/whale-pet/usage`、浏览器侧 `client.js` 内的 SVG 图表与布局 hook。

### 💰 余额 & 今日用量（💰 按钮）
余额 + 今日消耗 tokens + 今日花费（峰谷分开计费，并按命中/未命中/输出三桶拆分），调用官方余额接口。顺手播一段「翻钱包」动画，结果汇入头顶气泡。

### 💴 会话费用 pill（输入框下方）
与官方 token 用量 pill 同排显示本会话累计费用，点击展开明细弹层：**缓存命中 / 缓存未命中 / 输出**三桶金额、高峰与空闲各自累计、计价调用数，并带实时「谷 / 峰」徽标。金额与任务完成气泡、余额按钮共用同一套价目与计费口径（`lib/usage.js` 为唯一内核，`costUsage` 投影供浏览器读取）。

> DSH **0.1.6-alpha.2** 起，官方把输入框下方的统计区改成了横向 flex 行（官方 stats pill + **上下文占用计** + 本费用 pill 同排，`gap:12px`）。本插件的费用条目已按新契约声明为一个普通行内 flex 项，间距与垂直居中交给官方 dock；旧版 DSH 下它会退化成自己居中一行（不会与官方行重叠）。

### 💴 本轮费用 pill（每条回复的动作行）
就在官方「用量 X tok」旁边多一枚「费用 ≈¥x.xx」，点开是**这一轮**的缓存命中 / 缓存未命中 / 输出三桶金额与高峰 / 空闲拆分。数据来自同一个 `costUsage` 投影的 `byTurn`，与会话累计同源。

### ☁️ 明日天气（☁️ 按钮）
主打明日预报（今日天气抬头就能看见 😄），支持中文城市名 / 自动定位，WMO 天气码本地中文映射。

### 🍪 投喂互动
吃「TOKEN」压字小鱼干（30 秒冷却），点击/双击/拖拽各有专属动画。

### 😴 睡眠系统
空闲 5 分钟自动入睡三连（进入睡眠 → 持续睡觉循环 → 被叫醒）。

### 🕐 时间感知
- 8:00–10:00 睡眼惺忪 · 12:00 吃盒饭（每天一次）· 23:00–3:00 迷糊犯困

### ⚙️ 设置面板（DSH 设置 → 桌宠配置）
番茄钟提醒（间隔可调）· 深夜关怀 · 随机小剧场 · **漫游开关** · **按钮位置（左/右）** · **看板历史补扫开关** · **看板窗口天数** · 长任务阈值 · 天气城市，全部即时生效、重启不丢。

### 🎨 46+ 透明动画
全部透明 WebM（VP9 alpha），双缓冲交叉淡入切换零空白，落地对齐统一，支持 `prefers-reduced-motion`。

---

## 📦 安装

```sh
# 从 npm 市场安装（推荐）
dsh plugin --profile web add dsh-whale-girl-pet

# 或从本地 tarball 安装
dsh plugin --profile web add dsh-whale-girl-pet-0.3.0.tgz
```

重启 `dsh web`，刷新浏览器页面，桌宠出现在右下角。

> **⚠️ 改动客户端 bundle 后必须重启 `dsh web`**：DSH 在启动时就把插件的浏览器半侧载入内存，不是每次从磁盘读。只刷新页面看不到新代码。
> 宿主半侧（路由、计费、`lib/*.js`）同理，任何 `lib/` 下的改动都需要重启进程。

> **🧩 兼容性（0.3.2）**：本版本针对 **DSH 0.1.6-alpha.2** 验证——宿主半侧的 `/pet` 与 `/api/whale-pet/*` 路由、`costUsage` 投影、`sessionPersistence` 补扫、槽位注册（`shell.overlay` / `settings.section` / `conversation.composer.dock` / `conversation.chat.assistant-actions`）在该版本上均正常；本次适配的是它把 composer dock 改成横向 flex 行、并把上下文占用计放进这一行的布局变更。
> `package.json` 的 `peerDependencies` 随 DSH 的 alpha 线走（`^0.1.6-alpha.2`）：npm/pnpm 的 semver 规则要求 peer 范围里必须点名**同 patch 的预发布版本**才能算满足，所以每次 DSH 换 alpha 线（如 0.1.7-alpha.1）这条范围也要跟着更新，否则 `pnpm install` 会提示未满足 peer（只是警告，不影响安装与运行）。

---

## ⚙️ 配置

打开 DSH 设置 →「桌宠配置」面板即可调整全部选项（即时生效并写入 `settings.yaml`）：

| 配置 | 说明 | 默认 |
|------|------|------|
| 番茄钟提醒 | 每 N 分钟提醒休息 | 开 / 25 分钟 |
| 深夜关怀 | 23:00-05:00 每 20 分钟提醒早睡 | 开 |
| 随机小剧场 | 随机冒 DS 梗台词 | 开 |
| 漫游走动 | 关闭后桌宠不乱跑 | 开 |
| 按钮位置 | ☁️💰🍪📊 放宠物左侧/右侧 | 左侧 |
| 看板历史补扫 | 关掉则只统计本次运行的用量 | 开 |
| 看板窗口天数 | 日趋势保留并展示的天数 | 7 天 |
| 长任务提醒阈值 | 工作超过 N 分钟提醒 | 10 分钟 |
| 天气城市 | 留空 = 自动定位 | 空 |

---

## 🎞️ 动画目录（46+）

- **待机/随机**：待机呼吸休闲、东张西望、悠闲哼歌、超大伸懒腰、玩魔方、敲桌面、下蹲压缩、哈欠连天、玩玩具汽车、吐泡泡、女仆屈膝、被吓一跳、跳跃抓东西、360° 展示、偷吃零食、玩游戏气急败坏、尾巴拍地、打瞌睡惊醒、偷吃Token、打喷嚏、喝奶茶、女仆扫除、空白举牌、举牌不是大肥鱼、闲得无聊打游戏…
- **工作**：开始工作、认真工作、工作摸鱼、工作思考、摸鱼被抓、工作结束、工作被打扰、长时间工作看表
- **睡眠**：睡觉第一段、睡觉第二段（循环）、睡觉第三段
- **时间感知**：睡眼惺忪、吃盒饭、迷糊犯困
- **按钮**：看天气、翻钱包、吃小鱼干、看表叹气
- **交互**：点击回应 ×3、被鼠标拖拽悬空反馈、摸头（双击）

> 电脑上印着鲸鱼剪影 logo，工作链动画同一会话生成保证一致。

---

## 📝 更新记录

### 0.3.2
- **修复：输入框下方的费用 pill 在 DSH 0.1.6-alpha.2 下「歪了」**。官方把 composer dock 包成了横向 flex 行（`InputBar.module.css` 的 `.dock{display:flex;align-items:center;justify-content:center;gap:12px}`），并把「上下文占用」计也放进这一行；而本插件的费用条目还在用旧布局的覆盖式定位（`width:100%` + `max-width` + `margin:-20px auto 0` + `padding` + `justify-content:flex-end`）。进了横向 flex 行之后，负 margin 会把自己整块上移 20px，`width:100%` 还会挤扁同排的官方 stats / 上下文条目 —— 这就是错位。现在它就是一个普通行内 flex 项（`display:inline-flex;flex:none;align-items:center`），间距与垂直居中交给官方 dock，和官方条目自然同排。
- **兼容性对齐 DSH 0.1.6-alpha.2**：`peerDependencies` 里的 DSH 包从 `^0.1.0-rc.6` 更新为 `^0.1.6-alpha.2`（按 semver 的预发布规则，旧范围**不满足** 0.1.6-alpha.2，`pnpm install` 会提示未满足 peer）；README 增补兼容性说明。宿主半侧经实测确认（`/api/whale-pet/usage` 正常返回），`costUsage` 投影、`sessionPersistence` 补扫、四个槽位注册与官方 API 均无破坏性变更；本轮费用 pill 的尺寸口径与官方 `TurnUsagePanel` 仍逐项一致。
- 单测 75 → **76 项**：新增一条 composer dock 契约回归（费用条目不得再带 `width:100%` / `margin:-20px` / `--dsh-chat-content-width` / `--dsh-composer-side-clearance` 等旧布局写法）。

### 0.3.1
- **修复：双击头部复位失效**（0.3.0 的回归）。表现是"双击后位置不动，但关掉面板再打开才回默认位置"——根因是复位走了 `place({})`，那个空对象被当成**尺寸覆盖参数**，而位置仍取自内存里的旧布局，于是只"清了记忆、没改位置"。现在复位会**先清空内存布局、再按空布局落定**，当场回到默认尺寸 + 视口居中。
- **新增 `scripts/sync-install.ps1`（开发用）**：把工作区同步到已安装副本并校验，同时判断当前 `dsh web` 进程是否需要重启。profile 里装的是**副本**而非软链，漏同步会造成"重启了但现象没变"的假象（0.3.0 收尾时就踩过一次）。
- 单测 73 → **75 项**：新增两条复位语义回归（正面：清空后复位回默认居中；反面：带着旧布局落定位置不变），并加了一组 jsdom 端到端验证（拖动 → 双击复位 → 再拖 → 再复位，确认幂等）。

### 0.3.0
- **新增「数据看板」（📊 按钮）**：气泡旁的新按钮，点开是分时段花费看板
  - `今日分时`（北京小时轴）/ `近 7 天`（北京日轴）两种视图，`花费 ↔ token` 一键切换
  - **三桶堆叠柱**（缓存命中 / 未命中 / 输出）+ **Y 轴 4 档刻度 + 网格线**，高峰时段铺橙色底纹，当前时段高亮
  - 汇总 5 格：近 24 小时 / 今日 / **均值**（平均每小时·每天，随视图与指标切换）/ 输入 / 输出，并带 **缓存命中率**（prompt 侧口径）与调用次数
  - 面板默认 **720×480 视口居中**，可**拖动头部移位置**、**右下角缩放**，双击头部复位；位置尺寸存 `localStorage`，记忆带版本号
  - 数据实时折叠 + **启动补扫已落盘会话**（重启不丢当天早段），双路径去重不重复计数；新增只读接口 `GET /api/whale-pet/usage`
- **新增 `lib/usage-ledger.js`**：分时段账本（北京小时桶 + 日桶、调用身份去重、替换语义、保留窗口），零依赖
- **新增设置项**：`看板历史补扫`、`看板窗口天数`
- **健壮性**：弹层容器经 `portalContainer()` 校验（避开 React `#200`，该错误会打挂整个 `shell.overlay` 导致桌宠消失）；看板包在错误围栏里
- 单测从 32 项增到 **73 项**：新增账本折叠口径、看板布局/记忆/版本迁移、柱状图与画布结构等回归用例

### 0.2.0
- **新增会话费用 pill**：输入框下方统计行，与官方 token 用量 pill 同排；点击展开缓存命中 / 未命中 / 输出三桶金额、高峰与空闲累计、计价调用数，带实时谷 / 峰徽标。
- **新增本轮费用 pill**：每条回复的动作行，就在官方「用量 X tok」旁边；点开是这一轮的三桶金额与峰谷拆分。
- **计费口径修正**：适配 DSH 0.1.5 的事件（`assistant/message.usage` + `assistant/message` / `assistant/attempt` 嵌入 stream 的 usage），重试按两次调用计费；周末全天按空闲计价。
- **价目同步**：2026-09-10 12:00 起 flash 系列新价（空闲 0.02 / 1 / 4 元每百万 tokens，高峰 2 倍）；跨换价的会话按每条用量当时的价目计费。
- 用量与计费抽成 `lib/usage.js`（零依赖）与 `lib/cost-projection.js`，加 32 项单测。

<details>
<summary>更早版本（0.1.x）</summary>

- **0.1.6**：适配 DSH 0.1.2-alpha.4 Session API（`snapshotEvents` 取代 `events` getter），修复花费/用量恒为 0。
- **0.1.5**：0.1.4 废弃并还原 0.1.2；移除对 `dsh-settings` `settingsNamespace` 导出的依赖（改用字面量命名空间）。
- **0.1.3**：周末全天按空闲计价（2026-08-23 规则）。
- **0.1.2**：天气 / 余额查询强制 `danger-full-access` 沙箱策略（需要网络）。

</details>

---

## 🧩 项目结构

```
dsh-whale-girl-pet/
├── lib/
│   ├── index.js            宿主半侧：/pet 动画路由、/api/whale-* 接口、settings 命名空间、投影注册
│   ├── usage.js            用量与计费内核（价目表 + 事件折叠 + 三桶费用，零依赖）★唯一计费口径
│   ├── usage-ledger.js     分时段账本（北京小时/日桶、去重、保留窗口）—— 看板数据源
│   ├── cost-projection.js  costUsage 会话投影（费用 pill / 本轮费用 pill 读取）
│   ├── client.js           浏览器半侧：桌宠本体、气泡、按钮组、看板弹窗与布局、设置面板
│   └── types/              TypeScript 类型声明（纯类型，不影响运行时）
├── assets/thumb/           360×360 播放用动画（随包发布）
├── assets/preview/         README 预览图 / 收款码
├── scripts/
│   └── sync-install.ps1    开发用：把工作区同步到已安装副本，并判断要不要重启 dsh web
├── test/                   单测（node --test，不发布）
└── cordis.patch.yml        bundle patch：把插件行挂进 DSH 配置树
```

**唯一的计费口径**：`lib/usage.js`。任务完成气泡、余额按钮、会话/本轮费用 pill、数据看板四处的金额全部由它算出，所以它们永远一致。

---

## 🛠️ 开发

```sh
node --test "test/*.test.mjs"     # 跑单测（76 项，零依赖，只用 node:test）
```

- 客户端 bundle 是**手写**的 `window.__ModuleLoader__.load({ id, factory })` 形态，零构建步骤。
- ⚠️ **改完必须同步到已安装副本，再重启 `dsh web`**：profile 里装的是**副本**（不是软链），插件 bundle 又在进程启动时就载入内存。漏掉同步会出现"重启了但现象没变"这种极难查的假象（本仓库开发过程中真的踩过一次）。脚本一步搞定，并顺带判断当前进程是否需要重启：

  ```powershell
  pwsh -File scripts/sync-install.ps1            # 同步 + 校验 + 提示是否需重启
  pwsh -File scripts/sync-install.ps1 -CheckOnly # 只校验（有差异时退出码 1）
  ```

- 确认页面跑的是哪版代码：浏览器控制台打印
  `localStorage.getItem('dsh-whale-pet.dashboard-layout')`，看**记忆版本号**（当前 `v:5`）。
- 计费口径改动请同步更新 `test/usage.test.mjs` / `test/usage-ledger.test.mjs`；看板布局改动请更新 `test/dashboard-layout.test.mjs`（它用 `vm` 从 `client.js` 里抠出工厂源码来跑，**测的就是线上那份代码**）。

---

## 📄 许可证

[MIT](./LICENSE)

---

## 🪙 请 DeepSeek 吃口 Token

喜欢这只桌宠的话，可以投喂她吃口 Token（完全自愿，不影响任何功能）～

<img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/qr-donate.png" width="180" alt="投喂 Token">

---

## 🎞️ 制作新动画

制作新动画视频请参考 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。

