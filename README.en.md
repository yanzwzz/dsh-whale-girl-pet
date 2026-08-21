# 🐋 dsh-whale-girl-pet — DeepSeek-chan Desktop Pet

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-DeepSeek%20Harness%20Web-8A2BE2">
  <img alt="version" src="https://img.shields.io/npm/v/dsh-whale-girl-pet?label=npm&color=blue">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-orange">
  <img alt="assets" src="https://img.shields.io/badge/assets-46%2B%20animations-ff69b4">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/preview-idle.gif" width="150" alt="idle">
  <img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/preview-work.gif" width="150" alt="working">
  <img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/preview-done.gif" width="150" alt="celebrating">
</p>

> A chibi blue-haired whale-girl maid ("DeepSeek-chan") living in the bottom-right corner of your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. She types along while you work, slacks off when you do, celebrates when tasks finish — and can report today's token usage & cost, check tomorrow's weather, or eat a "TOKEN" fish snack.

---

## ✨ Features

### 🖥️ Work chain (accompanies your agent)
| Moment | Animation |
|--------|-----------|
| 🟢 Start | "Start working": summons a floating desk → types standing |
| 🔄 Working loop | "Working hard / Slacking / Thinking / Caught slacking", rotates every 10.5s |
| 🎉 Finish | "End of work": stretch → victory "V" |
| 😤 Click while busy | "Interrupted at work": startled → annoyed → back to typing |
| ⏰ Long task | "Checking watch": sighs at the clock (threshold configurable) |

### 📊 Per-task completion bubble
```
Task done!
Duration 2m35s
Tokens 1.2M
Cost ≈¥3.21
```
- Estimated from official DeepSeek pricing, **peak/off-peak aware** (peak 9:00-12:00 / 14:00-18:00 Beijing, since 2026-08-17)
- Includes subagent sessions

### 💰 Balance & today's usage (💸 button)
Account balance + today's tokens + today's cost (peak/off-peak split), via the official balance API.

### ☁️ Tomorrow's weather (☁️ button)
Tomorrow-first forecast; supports Chinese city names / auto-locate; WMO codes mapped to Chinese locally.

### 🍪 Feeding
Eats a "TOKEN" fish snack (30s cooldown). Click / double-click / drag each have dedicated animations.

### 😴 Sleep system
Auto-sleeps after 5 idle minutes (fall asleep → sleeping loop → woken up).

### 🕐 Time-aware
- 8:00–10:00 groggy · 12:00 lunch box (once/day) · 23:00–3:00 dozing off

### ⚙️ Settings panel (DSH Settings → Pet Config)
Pomodoro (interval adjustable) · late-night care · random chatter · **roam toggle** · **button side (left/right)** · long-task threshold · weather city. All live, persisted to `settings.yaml`.

### 🎨 46+ transparent animations
All transparent WebM (VP9 alpha), double-buffered crossfade with zero blank frames, unified ground alignment, `prefers-reduced-motion` friendly.

---

## 📦 Install

```sh
dsh plugin --profile web add dsh-whale-girl-pet
# or from a tarball
dsh plugin --profile web add dsh-whale-girl-pet-0.1.3.tgz
```

Restart `dsh web` and refresh the browser — the pet appears bottom-right.

---

## ⚙️ Configuration

See DSH Settings → "Pet Config" (all options live, saved to `settings.yaml`):

| Option | Description | Default |
|--------|-------------|---------|
| Pomodoro | Remind to rest every N minutes | on / 25 min |
| Late-night care | 23:00-05:00 reminder every 20 min | on |
| Random chatter | Random DS memes | on |
| Roam | Disable random wandering | on |
| Button side | ☁️💰🍪 on left/right of pet | left |
| Long-task threshold | Warn after N minutes | 10 min |
| Weather city | Empty = auto-locate | — |

---

## 🎞️ Animation catalog (46+)

- **Idle/random**: breathing idle, look-around, humming, stretch, Rubik's cube, desk tap, squat, yawn, toy car, bubbles, maid curtsey, startled, jump-grab, 360° spin, snack theft, gaming tantrum, tail slap, doze-jolt, token theft, sneeze, bubble tea, sweeping, blank sign, "Not a fat whale" sign, gaming…
- **Work**: start working, working hard, slacking, thinking, caught slacking, end of work, interrupted, watch check
- **Sleep**: fall asleep, sleeping loop, wake up
- **Time-aware**: groggy, lunch box, dozing
- **Buttons**: weather, wallet, fish snack, watch sigh
- **Interaction**: click responses ×3, drag, head pat (double-click)

> The laptop carries a whale-silhouette logo; work-chain animations are generated in one session for consistency.

---

## 📄 License

[MIT](./LICENSE)

---

## 🪙 Feed DeepSeek a Token

Enjoy this pet? Feed her a Token to say thanks (completely voluntary, no features affected)～

<img src="https://raw.githubusercontent.com/yanzwzz/dsh-whale-girl-pet/main/assets/preview/qr-donate.png" width="180" alt="Feed a Token">

---

## 🎞️ Making new animations

For creating new animation videos, please refer to [dsh-pet](https://github.com/PC2005-cloud/dsh-pet).

