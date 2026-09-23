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
Multi-line report at the end of every task, with the cost split into **cache hit / cache miss / output**:
```
Task done!
Duration 2m35s
Tokens 1.2M
Cost ≈¥3.21
· cache hit ≈¥0.28
· cache miss ≈¥0.02
· output ≈¥2.91
```
- Estimated from official DeepSeek pricing, priced **per usage event by its own timestamp**, so a task spanning a price change or a peak/off-peak boundary still adds up
- Peak/off-peak: weekdays 9:00-12:00 / 14:00-18:00 Beijing time are peak (2x the off-peak price); weekends are off-peak all day
- **Flash series repriced from 2026-09-10 12:00 Beijing**: off-peak 0.02 / 1 / 4 CNY per million tokens, peak 2x; pro unchanged
- Cache writes are billed at the cache-miss price (matching `prompt_cache_miss_tokens`)
- Includes subagent sessions

### 📈 Usage dashboard · cost by time (📊 button)
The fourth button beside the pet opens a **hand-written inline SVG dashboard (zero chart dependencies)** that answers "when did the money go?".

**Two views × two metrics**

| | Today by hour | Last N days |
|---|---|---|
| X axis | Each **Beijing hour** of today so far | The last N **Beijing days** (N configurable 1–30) |
| Y axis | Cost / tokens for that hour | Cost / tokens for that day |
| Toggle | "cost ↔ tokens", plus a "⟳" refresh | same |

**How to read it**

- **Stacked bars**: each bar splits into cache hit (blue) / cache miss (orange) / output (purple) → see at a glance whether a period was input-heavy or output-heavy
- **Structured scale**: 4 Y-axis ticks + gridlines; value labels only on the tallest few bars plus the current one (all bars when ≤12 in token view)
- **Peak band**: peak-rate hours (rate ×2) get an orange background band, so bar colour is free to encode the three buckets
- **Current period** is outlined
- Hover any bar for a full tooltip: cost, tokens, per-bucket amounts, calls, peak/off-peak

**Summary cards (5)**

`Last 24h` · `Today` · **`Average`** · `Input` · `Output`

- **Average** reads "avg per hour ¥0.14 / avg per day ¥6.84" and follows the current view and metric; it averages exactly the bars on screen
- **Cache hit rate** uses the prompt-side formula `cacheRead / (input + cacheWrite + cacheRead)`
- Each card carries a sub-line with tokens, call count or output cost

**Placing the panel**

- Default size **720×480**, default position **centered in the viewport** (shrinks to `viewport − 24` on small windows)
- **Drag the header** to move it, **drag the bottom-right corner** to resize (from 300×200)
- Position and size persist in `localStorage`; **double-click the header** to reset to the default size and centered position
- The stored layout is versioned, so changing the defaults invalidates old memory instead of being shadowed by it

**Where the numbers come from**

- **Live**: the host folds `ctx.on('session/event')` incrementally — O(1) per event, no polling, no disk writes
- **History**: at boot the plugin backfills persisted sessions via `sessionPersistence` (so this morning survives a restart); the panel footer reports how many sessions/events were scanned
- **Deduplication**: both paths share a per-session seen-seq set plus a call identity (`message.id` / seq), so order never double-counts; retries are billed as two calls
- A failed backfill only degrades to "this run only" and says so in the panel footer
- Read-only endpoint: `GET /api/whale-pet/usage` (optional `?hours=1..24&days=1..30`), `no-store`, ~10 KB

**Robustness**: the portal container is validated by `portalContainer()` (falls back to inline rendering, avoiding React `#200`, which would otherwise take down the whole `shell.overlay` entry), and the dashboard sits inside an error boundary.

### 💰 Balance & today's usage (💰 button)
Account balance + today's tokens + today's cost (peak/off-peak split, plus the hit/miss/output breakdown), via the official balance API.

> **"Today's cost" is an internal estimate that includes subagent sessions and pre-restart history**: it comes from the time-bucketed ledger (live folding across **all** sessions plus an on-demand back-scan of persisted sessions), not from "whatever sessions happen to be live". So subagent spend and anything already spent earlier today before a restart are both counted.

### 💴 Session cost pill (under the composer)
A cost pill next to the shipped token-usage pill shows the session's running cost; click it for the **cache hit / cache miss / output** breakdown, the peak vs off-peak totals, the priced-call count, and a live peak/off-peak badge. It shares one pricing kernel (`lib/usage.js`) and the `costUsage` projection with the task bubble and the balance button.

> **The amount includes sub-sessions.** DSH's `costUsage` projection folds **this session's own log only**, and a subagent is a separate session, so the projection alone would miss it. The host half walks the session tree (`parentSession` lineage from `sessionPersistence`), sums every descendant, and serves it over `GET /api/whale-pet/subtree-cost`; the pill adds it to the total and the detail dialog lists a "Sub-sessions" row.

> Since DSH **0.1.6-alpha.2** the shipped composer dock is a horizontal flex row (shipped stats pill + **context-occupancy meter** + this cost pill, `gap:12px`). The cost entry is declared as an ordinary inline flex item: the dock owns the gap and the vertical centering. On older DSH builds it degrades to its own centered row instead of overlapping the shipped row.

### 💴 Turn cost pill (each reply's action row)
Next to the shipped "Usage X tok" pill, a "Cost ≈¥x.xx" pill shows **this turn's** cache-hit / cache-miss / output amounts plus its peak/off-peak split, read from the same `costUsage` projection (`byTurn`). Subagents dispatched during that turn are attributed to it by their session's creation time (and listed as a "Sub-sessions" row too).

### ☁️ Tomorrow's weather (☁️ button)
Tomorrow-first forecast; supports Chinese city names / auto-locate; WMO codes mapped to Chinese locally.

### 🍪 Feeding
Eats a "TOKEN" fish snack (30s cooldown). Click / double-click / drag each have dedicated animations.

### 😴 Sleep system
Auto-sleeps after 5 idle minutes (fall asleep → sleeping loop → woken up).

### 🕐 Time-aware
- 8:00–10:00 groggy · 12:00 lunch box (once/day) · 23:00–3:00 dozing off

### ⚙️ Settings panel (DSH Settings → Pet Config)
Pomodoro (interval adjustable) · late-night care · random chatter · **roam toggle** · **button side (left/right)** · **dashboard history backfill** · **dashboard window days** · long-task threshold · weather city. All live, persisted to `settings.yaml`.

### 🎨 46+ transparent animations
All transparent WebM (VP9 alpha), double-buffered crossfade with zero blank frames, unified ground alignment, `prefers-reduced-motion` friendly.

---

## 📦 Install

```sh
dsh plugin --profile web add dsh-whale-girl-pet
# or from a tarball
dsh plugin --profile web add dsh-whale-girl-pet-0.3.0.tgz
```

Restart `dsh web` and refresh the browser — the pet appears bottom-right.

> **⚠️ Restarting `dsh web` is required after any change under `lib/`**: DSH loads a plugin's browser half into memory at boot rather than reading it from disk per request, so refreshing the page alone will not pick up new code (host routes and pricing behave the same way).

> **🧩 Compatibility (0.3.4)**: verified against **DSH 0.1.7-alpha.1** on an isolated instance (`apply()` activates, `/pet/*` and every `/api/whale-pet/*` route returns 200, and in a real browser the pet renders with both cost pills, correct work/stop animation transitions and zero console errors). What this release adapts is that version changing three service contracts at once.
>
> **⚠️ Three 0.1.7 breaking changes (0.3.2 and older stop working entirely on 0.1.7)**:
> 1. **`dsh-settings`**: `SettingsProvider` became `SettingsForms`, and `ctx.settings.register()` / `ctx.settings.get()` were **removed**;
> 2. **`dsh-jobs`**: **`ctx.jobs.onJobDone()` was removed**, replaced by `ctx.jobs.events.subscribe(filter, listener)` with a `settled` event (carrying the `job` projection and `cause`);
> 3. **`dsh-shell`**: **`run(spec)` became `execute(spec)`**, and `execute()` returns a process handle — the full foreground result needs `await handle.result()`.
>
> Any of them throwing inside `apply()` makes DSH mark the entry **"did not activate"** — the symptom is **the pet disappearing entirely** (the browser half does not mount either). 0.3.3 adapts to all three (settings on the profile-form model with `.volatile()` fields and unwrapped `ctx.fiber.config`; jobs on the event stream with an old-API fallback; shell accepting both `execute()` and `run()`), and **isolates every optional feature's assembly**: a single future API drift now only drops that one feature (with a warn log) instead of removing the pet from the page.
> The `peerDependencies` on DSH packages track the current alpha line (`^0.1.7-alpha.1`): npm/pnpm semver only counts a prerelease as satisfying a range when some comparator names a prerelease of the **same patch**, so each new DSH alpha line also needs this range refreshed, otherwise `pnpm install` prints unmet-peer warnings (warnings only — install and runtime are unaffected).
> To re-run the compatibility self-check after an upgrade (**the source workspace ships `scripts/`; the npm tarball does not**): `cd D:\deepseek-harness && node --import tsx/esm "<source workspace>\dsh-whale-pet\scripts\verify-dsh-0.1.7.mjs"` (32 checks: settings API shape, `apply()` activation, full `inject` coverage, zero skipped features, all seven routes, sub-session billing end to end, volatile unwrapping, the `/state` authority flag, the jobs event stream, and shell `execute()/result()`).

---

## ⚙️ Configuration

See DSH Settings → "Pet Config" (all options live, written into the profile patch on the next save):

> **Where settings live changed in DSH ≥ 0.1.7**: 0.1.6 and older wrote a `whale-pet:` section in `$DSH_HOME/settings.yaml`; 0.1.7 writes into the **profile patch** (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) as the `config` of this plugin's entry. On upgrade DSH renames the old `settings.yaml` to `settings.yaml.imported`, and third-party sections are not imported automatically — move them by hand:
>
> ```yaml
> # ~/.dsh/profiles/web/cordis.patch.yml
> - id: pet
>   config:
>     city: 济南
>     roam: false
> ```

| Option | Description | Default |
|--------|-------------|---------|
| Pomodoro | Remind to rest every N minutes | on / 25 min |
| Late-night care | 23:00-05:00 reminder every 20 min | on |
| Random chatter | Random DS memes | on |
| Roam | Disable random wandering | on |
| Button side | ☁️💰🍪📊 on left/right of pet | left |
| Dashboard history backfill | Off = only count this run | on |
| Dashboard window days | Days kept in the daily trend | 7 |
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

## 📝 Changelog

### 0.3.4
- **Fixed: while the Agent works the pet can get stuck in the random (idle) state — the same symptom as "clicking stop never reaches the pet".** Two layers:
  1. **A client state-machine hole (the main cause)**: in `handleEnded`, the busy path only listed "start work / click / drag"; **every other one-shot animation fell through to the random chain (`pickNext()`)**. `busyRef.current` was already `true` at that point, so a later `mood:'working'` was swallowed by `if (!busyRef.current)` — the pet roams randomly forever while the Agent's status never changes again (`agent/status` is **edge-triggered**: it only reports changes). Interleaved agents (a subagent's running/idle pair) or an interrupted wake/notice animation are the easiest ways in. Now any non-work-chain animation that ends while busy returns straight to the work rotation.
  2. **No level-triggered fact (structural)**: state came only from edge events, so one missed event meant permanent desync. `GET /api/whale-pet/state` now carries a **`running`** boolean recomputed from the Agent registry on every poll; the client reconciles every 800ms, so a dropped event is corrected automatically and a `busy` flag that drifted away from the animation chain is pulled back into the work rotation.
- **Completed the wind-down order**: on an interrupt/stop the pet now plays **"work finished" first** (sit → stand) and only then enters the random idle chain. `applyMood('idle')` used to jump straight to idle, skipping that state entirely; it now plays only when actually leaving the busy state (a pet that was already idle does not replay it), and a completion bubble in the same batch no longer restarts the same animation (`playNotice` only shows the bubble when the animation is already playing).
- Note: **DSH itself also needs time to converge after you press stop** before the Agent reports idle (measured ~16s, during which DSH's own composer still shows "stop generating"). The pet follows that fact faithfully; what this release fixes is the pet failing to catch up once the fact *has* changed.
- The self-check script grew to **32 checks** (a new assertion that `/state` carries `running`).

### 0.3.3
- **Adapted to DSH 0.1.7-alpha.1 (three breaking changes that take 0.3.2 down entirely on 0.1.7)**:
  - **`dsh-settings`**: `SettingsProvider` → `SettingsForms`; `ctx.settings.register()` / `get()` removed;
  - **`dsh-jobs`**: `ctx.jobs.onJobDone()` removed, replaced by `ctx.jobs.events.subscribe(filter, listener)` with a `settled` event (`job` projection / `cause`);
  - **`dsh-shell`**: `run(spec)` → `execute(spec)`, where `execute()` returns a process handle and the foreground result needs `await handle.result()`.

  Any one of them throwing inside `apply()` makes DSH mark the entry **"did not activate"** — the symptom is **the pet disappearing entirely** (the browser half does not mount either); that is exactly what happened when the first pass of 0.3.3 fixed only settings and missed jobs/shell. Now:
  - every `Config` field is marked `.volatile()` (0.1.7 only surfaces volatile fields in the settings form, and only those can be written by `mutate()`);
  - values are read from `ctx.fiber.config` with volatile references **recursively unwrapped** (note: volatility is per field, the reference only has `.get()`, writing goes through `Symbol.for('cosmokit.volatile.write')` — there is no `.set()`);
  - writes are addressed by the **profile entry id** of this plugin row (`entryIdOf()` reads it from the loader entry, falling back to `pet`) instead of a hard-coded `whale-pet`;
  - job notices prefer `jobs.events.subscribe({ owners: 'all' })` and only report a `settled` event with `cause !== 'teardown'`; older DSH falls back to `onJobDone`;
  - shell goes through a new `runShell()` that accepts both `execute()+result()` and the legacy `run()`;
  - **every optional feature's assembly is isolated** (`safe(ctx, label, fn)` plus an outer guard on `apply`): a future single-API drift now only drops that one feature with a warn log instead of removing the pet;
  - `peerDependencies` moved to `^0.1.7-alpha.1`.
- **Fixed: internal totals excluded subagent sessions.** DSH's `costUsage` projection folds **this session's own log only**, and a subagent is a separate session, so both cost pills silently missed its spend. Now:
  - the ledger (`lib/usage-ledger.js`) keeps a per-session total (`sessionCost(id)`, adjusted in lockstep with the time buckets and under the same replace semantics);
  - `lib/subtree.js` (pure logic) builds the session tree from `parentSession` lineage and sums every descendant; persisted headers fill in subagents no longer live;
  - a new read-only endpoint `GET /api/whale-pet/subtree-cost?session=<id>` feeds the pills: the session pill adds the descendant total, the turn pill attributes subagents to the turn their session was created in, and both dialogs list a "Sub-sessions" row.
- **Fixed: the balance + today's-usage button (💰).** Besides the routes coming back, "today's cost" now reads the **time-bucketed ledger** instead of "sessions that happen to be live": it covers every session (subagents included) with a back-scan of persisted logs, so spend from earlier today is no longer lost after a restart; if the ledger is unusable it falls back to the old live-only path. Flipping `dashboardHistory` from off to on now also triggers the scan on demand.
- **Fixed: the dashboard / cost panel background turned translucent (see-through).** DSH 0.1.7 changed `--dsw-specific-menu` from `rgba(248,249,250,.94)` into a **translucent** fill (light `.58`, dark `rgba(48,49,54,.5)`) and its styling guide requires that "an elevated surface using this fill applies `backdrop-filter: var(--dsw-menu-backdrop-filter)` in the same rule" (the shipped `stat-dialog.module.css` does exactly that). The pet's two panels took only the color and no filter, so they became see-through. They now use the **opaque** layer surface `--dsw-alias-bg-layer-2` that the shipped `Modal` content uses (with the same `--dsw-elevation-prominent`), falling back to the equally opaque `--dsw-alias-bg-module-platform` in case the token drifts again. Measured: panel `rgb(255,255,255)` light / `rgb(44,44,46)` dark, inner stat cards `rgb(245,246,247)` / `rgb(53,54,56)` so the layering survives, `backdrop-filter: none`.
- Tests 76 → **88**: new `test/subtree.test.mjs` (session tree, descendant enumeration, cycle defence, per-turn attribution, per-session ledger totals, and a "today's usage includes sub-sessions" regression).
- New `scripts/verify-dsh-0.1.7.mjs`: **30** compatibility checks run against the **real** `dsh-settings` source (API shape, `apply()` activation, a full-`inject` coverage assertion, a zero-skipped-features assertion, all seven routes, sub-session billing end to end, volatile unwrapping, the jobs event stream, shell `execute()/result()`) — reusable for the next DSH upgrade.
- New `.research/pet-diag-probe.mjs` (a diagnostic probe in the workspace): boots the profile on isolated port 3099, prints `did not activate` / `TypeError` lines from the startup output, exchanges the token for a cookie and hits every pet route — this is what pinpointed `jobs.onJobDone is not a function`.

### 0.3.2
- **Fixed: the session cost pill was crooked under DSH 0.1.6-alpha.2.** That release wrapped the composer dock in a horizontal flex row (`InputBar.module.css`: `.dock{display:flex;align-items:center;justify-content:center;gap:12px}`) and moved the context-occupancy meter into it, while this plugin's cost entry still used the old overlay positioning (`width:100%` + `max-width` + `margin:-20px auto 0` + `padding` + `justify-content:flex-end`). Inside a horizontal flex row the negative margin lifts the whole entry by 20px and `width:100%` squeezes the shipped stats/context entries sharing the row — that is the misalignment. It is now an ordinary inline flex item (`display:inline-flex;flex:none;align-items:center`) so the shipped dock owns the gap and the centering.
- **Compatibility aligned with DSH 0.1.6-alpha.2**: the DSH entries in `peerDependencies` moved from `^0.1.0-rc.6` to `^0.1.6-alpha.2` (under semver's prerelease rule the old range does **not** satisfy 0.1.6-alpha.2, so `pnpm install` reported unmet peers); the README now documents the compatibility contract. The host half was verified live (`/api/whale-pet/usage` answers normally) and the `costUsage` projection, the `sessionPersistence` back-scan, all four slot registrations and the shipped APIs show no breaking change; the turn pill's metrics still match the shipped `TurnUsagePanel` rule for rule.
- Unit tests 75 → **76**: a composer-dock contract regression (the cost entry must not carry `width:100%` / `margin:-20px` / `--dsh-chat-content-width` / `--dsh-composer-side-clearance` again).
- **Fixed `scripts/sync-install.ps1`: this machine carries two installed copies** — `~/.dsh/profiles/node_modules/dsh-whale-girl-pet` (root level) and `~/.dsh/profiles/web/node_modules/dsh-whale-girl-pet` (**the one the web profile actually loads**). Syncing only one produces the "I restarted but nothing changed" symptom (which is what happened first here, costing one pointless restart). The script now syncs **every** existing copy, verifies each byte-for-byte afterwards, and prints which copy the profile loads.

### 0.3.1
- **Fixed: double-clicking the header no longer reset the panel** (a 0.3.0 regression). It looked like "double-click does nothing, but closing and reopening the panel recenters it": the reset called `place({})`, and that empty object was taken as a **size override** while the position still came from the in-memory layout — so the stored memory was cleared but the panel did not move. The reset now clears the in-memory layout first, then re-places against an empty layout and recenters immediately.
- **New `scripts/sync-install.ps1` (dev-only)**: syncs the working tree into the installed profile copy, verifies it, and reports whether the running `dsh web` process needs a restart. The profile holds a **copy**, not a symlink, so a forgotten sync produces the confusing "I restarted but nothing changed" symptom (we hit that once while finishing 0.3.0).
- Unit tests 73 → **75**: two reset-semantics regressions (positive: a cleared layout recenters; negative: placing with a stale layout keeps the old position) plus a jsdom end-to-end pass (drag → double-click reset → drag again → reset again, confirming idempotence).

### 0.3.0
- **New usage dashboard (📊 button)**: a cost-by-time panel next to the pet
  - `Today by hour` (Beijing hours) / `Last 7 days` (Beijing days), with a `cost ↔ tokens` toggle
  - **Stacked three-bucket bars** (cache hit / miss / output) + **4 Y-axis ticks and gridlines**, orange background bands for peak hours, current period outlined
  - Five summary cards: last 24h / today / **average** (per hour or per day, following the view and metric) / input / output, plus **cache hit rate** (prompt-side) and call count
  - Default **720×480, centered**; drag the header to move, drag the corner to resize, double-click the header to reset; position/size persist in `localStorage` with a version tag
  - Live folding plus a **boot-time backfill of persisted sessions** (so this morning survives a restart), deduplicated across both paths; new read-only endpoint `GET /api/whale-pet/usage`
- **New `lib/usage-ledger.js`**: the time-bucketed ledger (Beijing hour/day buckets, call-identity dedup, replace semantics, retention window), zero dependencies
- **New settings**: `dashboard history backfill`, `dashboard window days`
- **Robustness**: the portal container is validated by `portalContainer()` (avoids React `#200`, which used to take down the whole `shell.overlay` entry and make the pet disappear); the dashboard is wrapped in an error boundary
- Unit tests grew from 32 to **73**: ledger folding, dashboard layout/memory/version migration, chart and canvas structure

### 0.2.0
- **Session cost pill**: under the composer, next to the shipped token-usage pill; click for the cache-hit / cache-miss / output breakdown, peak vs off-peak totals, priced-call count, and a live peak/off-peak badge.
- **Turn cost pill**: in each reply's action row, next to the shipped "Usage X tok" pill; opens this turn's three-bucket cost and peak/off-peak split.
- **Accounting fixes for DSH 0.1.5**: reads `assistant/message.usage` plus usage embedded in `assistant/message` / `assistant/attempt` streams; retries are billed as two calls; weekends are off-peak all day.
- **Pricing update**: flash series repriced from 2026-09-10 12:00 Beijing (off-peak 0.02 / 1 / 4 CNY per million tokens, peak 2x); a session spanning a price change is billed per event timestamp.
- Usage/pricing moved into `lib/usage.js` (zero-dependency) and `lib/cost-projection.js`, with 32 unit tests.

<details>
<summary>Earlier releases (0.1.x)</summary>

- **0.1.6**: adapt to the DSH 0.1.2-alpha.4 Session API (`snapshotEvents` instead of the `events` getter), fixing costs/usage always reading zero.
- **0.1.5**: withdraw 0.1.4 and revert to 0.1.2; drop the dependency on the `dsh-settings` `settingsNamespace` export.
- **0.1.3**: weekends billed off-peak all day (2026-08-23 rule).
- **0.1.2**: force the `danger-full-access` sandbox policy for weather/balance queries (they need network).

</details>

---

## 🧩 Project layout

```
dsh-whale-girl-pet/
├── lib/
│   ├── index.js            host half: /pet asset route, /api/whale-* endpoints, settings namespace, projections
│   ├── usage.js            pricing & usage kernel (rate table, event fold, three buckets) ★single source of truth
│   ├── usage-ledger.js     time-bucketed ledger (Beijing hour/day buckets, dedup, retention) — dashboard data
│   ├── cost-projection.js  costUsage session projection (cost pills read this)
│   ├── client.js           browser half: pet, bubbles, button stack, dashboard panel & layout, settings section
│   └── types/              TypeScript declarations (types only)
├── assets/thumb/           360×360 playback animations (shipped)
├── assets/preview/         README previews / donation QR
├── test/                   unit tests (node --test, not published)
└── cordis.patch.yml        bundle patch that mounts the plugin row into the DSH config tree
```

**One pricing kernel**: `lib/usage.js`. The task bubble, the balance button, both cost pills and the dashboard all price through it, so their amounts can never disagree.

---

## 🛠️ Development

```sh
node --test "test/*.test.mjs"     # 76 tests, zero dependencies, node:test only
```

- The browser bundle is a **hand-written** `window.__ModuleLoader__.load({ id, factory })` file with no build step: edit `lib/client.js` and restart `dsh web`.
- To check which bundle the page actually runs, print `localStorage.getItem('dsh-whale-pet.dashboard-layout')` (it carries a version tag).
- Pricing changes belong with `test/usage.test.mjs` / `test/usage-ledger.test.mjs`; layout changes with `test/dashboard-layout.test.mjs`, which extracts the layout factory **from `client.js` itself** and runs it in a `vm`, so it tests the shipped code rather than a copy.

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

