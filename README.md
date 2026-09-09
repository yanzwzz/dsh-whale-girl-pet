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

### 💰 余额 & 今日用量（💸 按钮）
余额 + 今日消耗 tokens + 今日花费（峰谷分开计费，并按命中/未命中/输出三桶拆分），调用官方余额接口。

### 💴 会话费用 pill（输入框下方）
与官方 token 用量 pill 同排显示本会话累计费用，点击展开明细弹层：**缓存命中 / 缓存未命中 / 输出**三桶金额、高峰与空闲各自累计、计价调用数，并带实时「谷 / 峰」徽标。金额与任务完成气泡、余额按钮共用同一套价目与计费口径（`lib/usage.js` 为唯一内核，`costUsage` 投影供浏览器读取）。

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
番茄钟提醒（间隔可调）· 深夜关怀 · 随机小剧场 · **漫游开关** · **按钮位置（左/右）** · 长任务阈值 · 天气城市，全部即时生效、重启不丢。

### 🎨 46+ 透明动画
全部透明 WebM（VP9 alpha），双缓冲交叉淡入切换零空白，落地对齐统一，支持 `prefers-reduced-motion`。

---

## 📦 安装

```sh
# 从 npm 市场安装
dsh plugin --profile web add dsh-whale-girl-pet

# 或从本地 tarball 安装
dsh plugin --profile web add dsh-whale-girl-pet-0.1.2.tgz
```

重启 `dsh web`，刷新浏览器页面，桌宠出现在右下角。

---

## ⚙️ 配置

打开 DSH 设置 →「桌宠配置」面板即可调整全部选项（即时生效并写入 `settings.yaml`）：

| 配置 | 说明 | 默认 |
|------|------|------|
| 番茄钟提醒 | 每 N 分钟提醒休息 | 开 / 25 分钟 |
| 深夜关怀 | 23:00-05:00 每 20 分钟提醒早睡 | 开 |
| 随机小剧场 | 随机冒 DS 梗台词 | 开 |
| 漫游走动 | 关闭后桌宠不乱跑 | 开 |
| 按钮位置 | ☁️💰🍪 放宠物左侧/右侧 | 左侧 |
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

### 0.2.0
- **新增会话费用 pill**：输入框下方统计行，与官方 token 用量 pill 同排；点击展开缓存命中 / 未命中 / 输出三桶金额、高峰与空闲累计、计价调用数，带实时谷 / 峰徽标。
- **新增本轮费用 pill**：每条回复的动作行，就在官方「用量 X tok」旁边；点开是这一轮的三桶金额与峰谷拆分。
- **计费口径修正**：适配 DSH 0.1.5 的事件（`assistant/message.usage` + `assistant/message` / `assistant/attempt` 嵌入 stream 的 usage），重试按两次调用计费；周末全天按空闲计价。
- **价目同步**：2026-09-10 12:00 起 flash 系列新价（空闲 0.02 / 1 / 4 元每百万 tokens，高峰 2 倍）；跨换价的会话按每条用量当时的价目计费。
- 用量与计费抽成 `lib/usage.js`（零依赖）与 `lib/cost-projection.js`，加 32 项单测。

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

