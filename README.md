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
- 峰谷：北京时间工作日 9:00-12:00、14:00-18:00 为高峰（空闲价的 2 倍），**周末与中国法定节假日整天按空闲**（`lib/usage.js` 的 `CN_STATUTORY_HOLIDAYS`，按国务院通知逐年扩表）
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

> **今日花费 = 内部统计，含子代理会话与重启前的历史**：数字取自分时段账本（实时折叠**所有**会话 + 启动/按需补扫已落盘会话），而不是"当前在线会话"。所以主会话派发出去的子代理（subagent）开销、以及进程重启前今天已经花掉的部分，都算在内。

### 💴 会话费用 pill（输入框下方）
与官方 token 用量 pill 同排显示本会话累计费用，点击展开明细弹层：**缓存命中 / 缓存未命中 / 输出**三桶金额、高峰与空闲各自累计、计价调用数，并带实时「谷 / 峰」徽标。金额与任务完成气泡、余额按钮共用同一套价目与计费口径（`lib/usage.js` 为唯一内核，`costUsage` 投影供浏览器读取）。

> **金额含子会话**：DSH 的 `costUsage` 投影只折叠**本条会话自己的日志**，而子代理是独立会话，所以光靠投影会漏掉它们。宿主半侧按会话树（`sessionPersistence` 的 `parentSession` 血统）汇总后代会话的开销，经 `GET /api/whale-pet/subtree-cost` 提供给前端叠加；明细弹层里单列一行「子会话」。

> DSH **0.1.6-alpha.2** 起，官方把输入框下方的统计区改成了横向 flex 行（官方 stats pill + **上下文占用计** + 本费用 pill 同排，`gap:12px`）。本插件的费用条目已按新契约声明为一个普通行内 flex 项，间距与垂直居中交给官方 dock；旧版 DSH 下它会退化成自己居中一行（不会与官方行重叠）。

### 💴 本轮费用 pill（每条回复的动作行）
就在官方「用量 X tok」旁边多一枚「费用 ≈¥x.xx」，点开是**这一轮**的缓存命中 / 缓存未命中 / 输出三桶金额与高峰 / 空闲拆分。数据来自同一个 `costUsage` 投影的 `byTurn`，与会话累计同源；**本轮派发出去的子代理开销按"子会话创建时刻落在哪一轮"归到该轮**（明细里同样单列「子会话」）。

### ☁️ 明日天气（☁️ 按钮）
主打明日预报（今日天气抬头就能看见 😄），支持中文城市名 / 自动定位，**WWO 天气码本地中文映射**（wttr.in 返回的是 WWO 三位码：113=晴、116=局部多云、122=阴）。

> 宿主半侧用 Node 的 `fetch` 直接请求 wttr.in，**不经过 shell**：Windows / Linux / macOS 行为一致，也不需要为「网络」申请沙箱策略（0.3.6 起）。

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

> **🧩 兼容性（0.3.4）**：本版本针对 **DSH 0.1.7-alpha.1** 验证（隔离实例实测：`apply()` 正常激活、`/pet/*` 与全部 `/api/whale-pet/*` 路由 200、真实浏览器里桌宠渲染 + 两枚费用 pill 正常 + 工作/停止动画联动正常 + 控制台零报错）。本次适配的是它同时改掉的三处服务契约。
>
> **✅ 追加验证：DSH 0.2.0-rc.1 无需改代码**。0.1.7-alpha.1 → 0.2.0-rc.1 之间，本插件真正调用的服务（`dsh-settings`、`dsh-session-projection`、`dsh-jobs`、`dsh-host-webserver`、`dsh-home-paths`、`dsh-session-persistence`、`dsh-shell`、`dsh-sandbox`、`client-locale`、`client-ui-slots`）**源码零改动**（只有 README.i18n / package.json 变更）；`agent/status`、`session/event` 事件名与 `/plugins/<entryId>/client.js` 客户端 bundle 契约均保留；`mode`/`headless`/`executablePath` 等配置字段不变。全套自检（32 项）在 0.2.0-rc.1 检出上通过，故本次只把 `peerDependencies` 的 DSH 范围对齐到 `^0.2.0-rc.1`。
>
> **⚠️ 0.1.7 的三处破坏性变更（0.3.2 及更早在 0.1.7 上会整体失效）**：
> 1. **`dsh-settings`**：`SettingsProvider` → `SettingsForms`，**删掉了 `ctx.settings.register()` / `get()`**；
> 2. **`dsh-jobs`**：**删掉了 `ctx.jobs.onJobDone()`**，改成 `ctx.jobs.events.subscribe(filter, listener)`，结算经 `settled` 事件（带 `job` 投影与 `cause`）；
> 3. **`dsh-shell`**：**`run(spec)` → `execute(spec)`**，且 `execute()` 返回的是进程句柄，完整前台结果要再 `await handle.result()`。
>
> 老代码在 `apply()` 里抛 `TypeError` → DSH 判定该 entry **"did not activate"** → 表现就是**桌宠整个消失**（连浏览器半侧都不挂）。0.3.3 逐一适配（settings 走 profile 表单模型 + `.volatile()` + `ctx.fiber.config` 解包；jobs 走事件流并保留 old-API 回退；shell 兼容 `execute()/run()` 两条路径），并且**把每段可选功能的装配各自兜住**——以后再有单个 API 漂移，只会丢掉那一个功能（日志一条 warn），不会让桌宠从页面上消失。
> `package.json` 的 `peerDependencies` 随 DSH 的 alpha 线走（`^0.2.0-rc.1`）：npm/pnpm 的 semver 规则要求 peer 范围里必须点名**同 patch 的预发布版本**才能算满足，所以每次 DSH 换 alpha 线这条范围也要跟着更新。**DSH ≥0.2.0 起这条范围不只是警告**：运行时会在启动前做兼容性预检，范围不满足则该 bundle 被拒绝加载（`skipping profile bundle`，桌宠完全不出现），需在 profile 目录授权 exact-version 豁免或把范围升到当前版本线。
> 升级后如要跑一遍兼容性自检（**只有源码工作区带 `scripts/`，npm 包里不含**）：`cd D:\deepseek-harness && node --import tsx/esm "<源码工作区>\dsh-whale-pet\scripts\verify-dsh-0.1.7.mjs"`（32 项检查：settings API 形状、`apply()` 激活、inject 全覆盖、零功能跳过、7 条路由、子会话计费端到端、volatile 解包、`/state` 权威 running、jobs 事件流、shell execute/result）。

---

## ⚙️ 配置

打开 DSH 设置 →「桌宠配置」面板即可调整全部选项（即时生效并在下次写回时落进 profile 补丁）：

> **DSH ≥0.1.7 的配置存放位置变了**：0.1.6 及更早写 `$DSH_HOME/settings.yaml` 的 `whale-pet:` 段；0.1.7 起改为 **profile 补丁**（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）里该插件条目的 `config`。升级后旧 `settings.yaml` 会被 DSH 一次性改名成 `settings.yaml.imported`，第三方插件的段不会被自动导入，需要手工搬：
>
> ```yaml
> # ~/.dsh/profiles/web/cordis.patch.yml
> - id: pet
>   config:
>     city: 济南
>     roam: false
> ```

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

### 0.3.6（未发布）
- **修复：触摸屏上宠物拖拽不可用**（[issue #4](https://github.com/yanzwzz/dsh-whale-girl-pet/issues/4)）。根因是 `.dsh-pet-video` 少了 `touch-action:none`：拖拽走 Pointer Events（`pointerdown` 只记起点 + `setPointerCapture`，`pointermove` 超过 5px 才算拖拽，`pointerup` 收尾），触屏上浏览器会先把这一按当成平移/缩放手势并随即发出 `pointercancel`，而 `onPointerCancel` 正好接到收尾逻辑 —— 拖拽在起步前就被结束。桌面端没有这层手势拦截，所以只在触摸屏复现。看板标题与缩放手柄一直是这么写的，只有宠物本体漏了。新增 `test/client-bundle.test.mjs` 不变式：视频必须含 `touch-action:none`、拖拽必须仍走四个 Pointer Events 处理器、`setPointerCapture` 仍在，并顺带锁住看板两处同类写法。
- **修复：天气 / 余额查询在 Linux / macOS 上必然失败**（[issue #2](https://github.com/yanzwzz/dsh-whale-girl-pet/issues/2)）。旧实现把这两段逻辑写成 **Windows PowerShell 脚本**交给 `ctx.get('shell')` 执行，而 DSH 在非 Windows 平台上的 shell 服务是 `bash -c`，第一行 `[Console]::OutputEncoding` 就报「未找到命令」。现在改成宿主半侧用 Node 的 `fetch` 直连：宿主本身就跑在 Node 里（`engines` 要求 ≥22.19），跨平台行为一致，失败时能带回真实的 HTTP 状态，**也不再需要为「网络」申请 `danger-full-access` 沙箱策略**（`runShell()` / `resolvePolicy()` 随之删除）。
  - 整形逻辑抽成零依赖纯函数模块：[`lib/weather.js`](lib/weather.js)（WWO/WMO 码表 + 明日天气选取）、[`lib/balance.js`](lib/balance.js)。返回给浏览器半侧的字段与旧实现**逐字一致**，客户端无需改动。
  - 顺带修掉一个**真实缺陷**：wttr.in 的 `weatherCode` 是 **WWO 码**（113=晴、116=局部多云、122=阴），而旧码表是 WMO 的，WMO 表里 `>= 95 → ⛈️/雷雨` 会把所有三位码吞掉 —— 表现就是**天气图标永远是 ⛈️、描述永远是「雷雨」**（issue #2 报告里真机复测的输出 `"icon":"⛈️","tomorrowDesc":"雷雨"` 正是这个 bug 的指纹）。现在 `>= 100` 走 `WWO_TABLE`（标准 48 码 + 实测出现的 149=霾），`< 100` 仍按 WMO 表兼容。
  - 自动定位的地名反查失败不再让整条失败：依次退回 wttr 站点名、「当前位置」（旧实现会因此连天气都不显示）。
  - 新增单测 [`test/weather.test.mjs`](test/weather.test.mjs) 与 [`test/balance.test.mjs`](test/balance.test.mjs)；`scripts/verify-dsh-0.1.7.mjs` 第 7 段由「必须调到 `shell.execute`」改为「**一次都不能调到 shell**」，并断言失败信息里不再出现 bash / PowerShell 语法错误特征。
- **修复：宠物动画被 KDE 的 plasma-browser-integration 注册成 MPRIS 播放器，抢走全局媒体键**（[issue #3](https://github.com/yanzwzz/dsh-whale-girl-pet/issues/3)）。该扩展（Firefox 扩展 + native host，**不需要 Plasma 桌面**）用 `MutationObserver` 扫 document，把「正在播放且时长 ≥ 8s」的 `<video>`/`<audio>` 注册为 MPRIS 播放器；宠物动画是循环播放的长视频，于是 `playerctl` 里出现的是它 —— `xesam:title 待机呼吸休闲`、`xesam:url …/pet/thumb/待机呼吸休闲.webm` —— 而 MPRIS 服务名全局唯一，网易云这类播放器就再也注册不上。
  - 两个动画 `<video>` 现在建在 `.dsh-pet-stage` 的 **shadow root**（`mode: 'closed'`）里：shadow 内的节点对 document 级扫描不可见（观察器不跨边界、`querySelectorAll` 也不进 shadow），媒体事件又都不是 composed 事件，MPRIS 因此看不到宠物。用 `closed` 让 `element.shadowRoot` 也返回 `null`（连「shadow 感知」的扫描也拿不到），引用由模块级 `WeakMap` 按舞台元素持有 —— shadow root 一旦建立无法移除，而 StrictMode 会把 effect 跑两遍，所以复用同一份并 `replaceChildren` 覆盖内部节点。
  - **朝向镜像改用 CSS 自定义属性桥接**：video 进入 shadow 后 `.dsh-pet-root[data-facing="right"] .dsh-pet-video` 这类跨边界后代选择器失效，而 `:host-context()` 在 Firefox/Safari 从未实现（且已移出规范）。现在由祖先设 `--dsh-pet-flip:-1`，shadow 内写 `transform:scaleX(var(--dsh-pet-flip,1))`（自定义属性能穿透 shadow 继承）。
  - **交互改成原生监听 + 最新闭包转发**：React 的合成事件委托在 root 容器上、沿 light DOM 祖先链匹配 props，而 shadow 里冒出来的 pointer/click 虽然会穿出边界（composed），target 却被 retarget 成 host（`.dsh-pet-stage`）—— props 永远匹配不上。现在两个 video 手工创建、原生 `addEventListener`，事件转发到每帧刷新的 `handlersRef`（避免绑在首次渲染的过期闭包上；`setPointerCapture` 的 `currentTarget` 仍是 video 本身）。
  - 样式仍是**单一来源**：同一份 CSS 文本既注入 `document.head`，也注入 shadow，避免两处手抄漂移。播放逻辑（`switchTo` 的 `src`/`load()`/`classList`/`play()`/`pause()`/`onended`）操作的一直是元素引用，**未做任何改动**。
  - `test/client-bundle.test.mjs` 新增静态不变式：必须 `attachShadow` + `mode:'closed'`、不得再有 `h('video'`、必须有 `replaceChildren`/`WeakMap`、**不得出现 `:host-context`**、必须有 `--dsh-pet-flip` 桥接、事件必须走 `handlersRef`，并断言 shadow 的 effect 声明在 `switchTo` 的 effect **之前**（顺序错了首次挂载会空白）。

### 0.3.5
- **修复：法定节假日被误按高峰计价，费用最高虚高一倍**。官方定价页口径是「高峰 = UTC 周一至周五的 01:00-04:00 与 06:00-10:00（北京 9:00-12:00、14:00-18:00），**周末与中国法定节假日整天低峰**」，而原先的 `isPeakBeijing()` 只判了周末、没有节假日表 —— 于是春节/国庆这类落在工作日的长假会被按高峰算，1M 未命中输入 + 1M 输出在 9/10 档下会从实际的 **5 元虚报成 10 元**。
- 新增 `CN_STATUTORY_HOLIDAYS`（[`lib/usage.js`](lib/usage.js)），按国务院办公厅《关于 2026 年部分节假日安排的通知》（国办发明电〔2025〕7 号）逐条录入 2026 年 **33 个放假日**；客户端 `lib/client.js` 的 `isPeakNow()` 同步镜像同一张表（浏览器半侧拿不到宿主模块，只能复制，已加注释互指）。
- **调休上班的周末仍按低峰**：官方以"UTC 周一至周五"判工作日，2026-01-04(日)、02-14/02-28/05-09/09-20/10-10(六) 这些补班日仍是日历周末，官方定价页明确 "including weekends ... in full"，所以这些日期有意不入表。
- 新增单测 [`test/holiday-peak.test.mjs`](test/holiday-peak.test.mjs)（10 项）：节假日整天低峰、调休补班日低峰、节前节后工作日不受影响、北京时间跨日切分、非法时间戳不抛错、**宿主与客户端两份实现逐时刻对拍**（2026 全年 + 2027 初，约 4700 个时刻，含 09:00/12:00/14:00/18:00 边界分钟）、以及端到端断言"节假日 5 元 vs 工作日 10 元"。
- **维护点**：该表需按年扩（2027 年安排预计 2026 年 11 月前后公布）。缺年份只会把法定假日误判成高峰（偏高），不会反向少算。看板底纹/费用弹层文案已同步注明"周末与法定节假日整天低峰"。

### 0.3.4
- **修复：Agent 工作时宠物可能永远停在随机（待机）状态 —— 也就是"手动点停止后收不到停止状态"那个现象**。根因有两层：
  1. **客户端状态机漏洞（主因）**：`handleEnded` 里工作中只列举了「开始工作 / 点击回应 / 拖拽」几种动画，**其余一次性动画播完一律掉进随机链 `pickNext()`**；而 `busyRef.current` 此时已经是 `true`，后续 `mood:'working'` 会被 `if (!busyRef.current)` 挡成空操作 —— 宠物就永远随机下去，而 Agent 的状态早已不再变化（`agent/status` 是**边沿触发**，只发变化）。多 Agent 交错（子代理 running/idle 穿插）、或叫醒/通知动画被打断时最容易踩到。现在：工作中任何"非工作链"动画播完都直接回到工作轮播。
  2. **缺少"电平"事实（结构性）**：状态转移全靠边沿事件，漏一条就永久失步。现在 `GET /api/whale-pet/state` 每次轮询都带上从 Agent 注册表现算的 **`running`** 布尔；客户端每 800ms 对一次账——事件丢了会被自动纠正，`busy` 与动画脱钩（卡在待机链）也会被拉回工作轮播。
- **补齐收工三态的顺序**：打断/结束时**先播「工作结束」**（坐→站），播完再进入随机链。原先 `applyMood('idle')` 是直接跳到「待机」，把「工作结束」这一态整个跳掉了；现在只有真的从"工作中"退出时才播它（本来就空闲时不会多播一次），并且同一批次里的完成气泡不会让同一个动画重播（`playNotice` 遇到当前已在播的动画只出气泡、不重启视频）。
- 说明：**点停止后 DSH 本身也要等收敛**才把 Agent 置为 idle（实测约 16 秒，其间 DSH 自己的输入框也仍然显示「停止生成」）。宠物是忠实跟随这个事实的，不是宠物自己卡住；上面的修复解决的是"事实已经变了但宠物没跟上"。
- 自检脚本增至 **32 项**（新增 `/state` 带 `running` 的断言）。

### 0.3.3
- **适配 DSH 0.1.7-alpha.1（三处破坏性变更，0.3.2 在 0.1.7 上整体失效）**：
  - **`dsh-settings`**：`SettingsProvider` → `SettingsForms`，`ctx.settings.register()` / `get()` 被删除。老代码在 `apply()` 里同步抛 `TypeError`；
  - **`dsh-jobs`**：`ctx.jobs.onJobDone()` 被删除，改成 `ctx.jobs.events.subscribe(filter, listener)` + `settled` 事件（`job` 投影 / `cause`）；
  - **`dsh-shell`**：`run(spec)` → `execute(spec)`，且 `execute()` 返回进程句柄，前台结果要再 `await handle.result()`。

  任一处在 `apply()` 里抛错，DSH 就判定该 entry **"did not activate"**，表现是**桌宠整个消失**（连浏览器半侧都不挂）——0.3.3 的第一版适配只修了 settings，漏掉 jobs/shell 时就是这个症状。现在：
  - `Config` 逐字段标 `.volatile()`（0.1.7 只把 volatile 字段放进设置表单，也只有它们能被 `mutate()` 写回）；
  - 读值改为从 `ctx.fiber.config` **递归解包** volatile 引用（注意：volatile 是逐字段包装、只有 `.get()`，写入用 `Symbol.for('cosmokit.volatile.write')`，没有 `.set()`）；
  - 写回按 **profile 里这条插件行的 id** 寻址（`entryIdOf()` 从 loader entry 取，退回 `pet`），不再是写死的 `whale-pet`；
  - 后台任务：优先 `jobs.events.subscribe({ owners: 'all' })`，只在 `settled` 且 `cause !== 'teardown'` 时提醒；老版本退回 `onJobDone`；
  - shell：新增 `runShell()`，兼容 `execute()+result()` 与旧版 `run()`；
  - **每段可选功能的装配各自兜住**（`safe(ctx, label, fn)` + `apply` 外层兜底）：以后单个 API 漂移只丢那一个功能并记一条 warn，不再让桌宠消失；
  - `peerDependencies` 升到 `^0.1.7-alpha.1`。
- **修复：内部统计的金额不含子会话**。DSH 的 `costUsage` 投影只折叠**本条会话自己的日志**，子代理是独立会话，所以会话费用 pill / 本轮费用 pill 天然漏掉它们。现在：
  - 账本（`lib/usage-ledger.js`）额外按会话 id 记一份累计（`sessionCost(id)`，与时间桶同步加/减，替换语义一致）；
  - 新增 `lib/subtree.js`（纯逻辑）按 `parentSession` 血统建会话树、汇总全部后代会话的开销；在线会话取不到的子代理由 `sessionPersistence` 的落盘 header 补全；
  - 新增只读接口 `GET /api/whale-pet/subtree-cost?session=<id>`；会话 pill 把后代合计叠加进总额，本轮 pill 按"子会话创建时刻落在哪一轮"归到该轮，明细里单列「子会话」。
- **修复：同时查询余额和今日用量的按钮**（💰）。除了上面那条让路由重新注册，今日花费的口径也从"只扫当前在线会话"改成**读分时段账本**：覆盖所有会话（含子代理）并带历史补扫，重启后今天早段的花费不再丢；账本不可用时自动退回旧口径。`dashboardHistory` 从关改成开时也会按需补跑一次历史扫描。
- **修复：数据看板 / 费用弹层背景变成半透明（看穿了）**。DSH 0.1.7 把 `--dsw-specific-menu` 从 `rgba(248,249,250,.94)` 改成了**半透明**（浅色 `.58` / 深色 `rgba(48,49,54,.5)`），并且样式规范要求"用这个填充的高层级表面必须在同一条规则里应用 `backdrop-filter: var(--dsw-menu-backdrop-filter)`"（官方 `ui-chat` 的 `stat-dialog.module.css` 就是成对写的）。宠物这两块面板只取了颜色、没配滤镜，于是就"看穿"了。现在改用官方 `Modal` 内容同款的**不透明**层表面 `--dsw-alias-bg-layer-2`（配同一个 `--dsw-elevation-prominent`），并回退到同样不透明的 `--dsw-alias-bg-module-platform` 以防 token 再漂移。实测：浅色面板 `rgb(255,255,255)`、深色 `rgb(44,44,46)`，内层统计卡 `rgb(245,246,247)` / `rgb(53,54,56)` 仍有层次，`backdrop-filter: none`。
- 单测 76 → **88 项**：新增 `test/subtree.test.mjs`（会话树 / 后代枚举 / 环形血统防御 / 按轮归集 / 账本按会话累计 / "今日用量含子会话"回归）。
- 新增 `scripts/verify-dsh-0.1.7.mjs`：对着**真实的** `dsh-settings` 源码跑 **30 项**兼容性自检（API 形状、`apply()` 激活、**inject 全覆盖断言**、**零功能跳过断言**、7 条路由、子会话计费端到端、volatile 解包、jobs 事件流、shell `execute()/result()`），下次 DSH 升级可直接复用。
- 新增 `.research/pet-diag-probe.mjs`（工作区里的诊断探针）：把 profile 起在隔离端口 3099，打印启动输出里的 `did not activate` / `TypeError`、用 token 换 cookie 逐条打桌宠路由 —— 就是它定位出 `jobs.onJobDone is not a function` 的。

### 0.3.2
- **修复：输入框下方的费用 pill 在 DSH 0.1.6-alpha.2 下「歪了」**。官方把 composer dock 包成了横向 flex 行（`InputBar.module.css` 的 `.dock{display:flex;align-items:center;justify-content:center;gap:12px}`），并把「上下文占用」计也放进这一行；而本插件的费用条目还在用旧布局的覆盖式定位（`width:100%` + `max-width` + `margin:-20px auto 0` + `padding` + `justify-content:flex-end`）。进了横向 flex 行之后，负 margin 会把自己整块上移 20px，`width:100%` 还会挤扁同排的官方 stats / 上下文条目 —— 这就是错位。现在它就是一个普通行内 flex 项（`display:inline-flex;flex:none;align-items:center`），间距与垂直居中交给官方 dock，和官方条目自然同排。
- **兼容性对齐 DSH 0.1.6-alpha.2**：`peerDependencies` 里的 DSH 包从 `^0.1.0-rc.6` 更新为 `^0.1.6-alpha.2`（按 semver 的预发布规则，旧范围**不满足** 0.1.6-alpha.2，`pnpm install` 会提示未满足 peer）；README 增补兼容性说明。宿主半侧经实测确认（`/api/whale-pet/usage` 正常返回），`costUsage` 投影、`sessionPersistence` 补扫、四个槽位注册与官方 API 均无破坏性变更；本轮费用 pill 的尺寸口径与官方 `TurnUsagePanel` 仍逐项一致。
- 单测 75 → **76 项**：新增一条 composer dock 契约回归（费用条目不得再带 `width:100%` / `margin:-20px` / `--dsh-chat-content-width` / `--dsh-composer-side-clearance` 等旧布局写法）。
- **修 `scripts/sync-install.ps1`：本机同时存在两份已安装副本**——`~/.dsh/profiles/node_modules/dsh-whale-girl-pet`（根级）与 `~/.dsh/profiles/web/node_modules/dsh-whale-girl-pet`（**web profile 真正加载的那份**）。只同步一份就会出现"重启了但现象没变"（本次就先把修复同步到了根级那份，白重启一次）。脚本现在默认同步**全部**已存在副本、收尾逐字节校验，并提示哪一份是 profile 实际加载的。

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

