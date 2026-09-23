/**
 * ============================================================================
 * dsh-whale-girl-pet —— DSH 0.1.7 兼容性验证脚本
 * ============================================================================
 *
 * 【它验证什么】
 *   1. 真实的 @deepseek-ai/dsh-settings（0.1.7-alpha.1）上还有没有
 *      `register()` / `get()` —— 0.1.7 把 SettingsProvider 换成了 SettingsForms，
 *      这两个方法被删除，老代码 `ctx.settings.register(...)` 会在 apply 里抛
 *      TypeError 并让整个宿主半侧失效。
 *   2. 用那份真实 API 形状的 ctx 跑 pet.apply()，确认不再抛错，
 *      且该注册的东西都注册了（costUsage 投影 + 全部 HTTP 路由 + 事件监听）。
 *   3. 端到端打一遍 /api/whale-balance 与 /api/whale-pet/subtree-cost：
 *      往 session/event 总线喂"子会话"的用量，检查
 *        - 余额按钮里的「今日花费」走账本、把子会话算进去；
 *        - 子会话费用接口按会话树汇总出金额。
 *   4. POST /api/whale-pet/settings 是否用 profile 里的 entry id 调 mutate()。
 *
 * 【为什么要在 dsh 检出目录里跑】
 *   本插件不打包 @deepseek-ai/* 依赖，靠 profile 的 node_modules 解析；
 *   裸 node 从插件目录跑会找不到 @deepseek-ai/schemastery。用 tsx 并切到
 *   DSH 检出目录，就能拿到检出里的依赖。
 *
 * 运行：
 *   cd D:\deepseek-harness
 *   node --import tsx/esm "D:\SRC\dsh work\dsh-whale-pet\scripts\verify-dsh-0.1.7.mjs"
 */
import { pathToFileURL } from 'node:url'

const PET_ROOT = 'D:/SRC/dsh work/dsh-whale-pet'
const SETTINGS_SRC = 'D:/deepseek-harness/packages/settings/settings/src/index.ts'

const failures = []
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ✔ ${label}`)
  } else {
    failures.push(label)
    console.log(`  ✖ ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ---------------------------------------------------------------------------
// 1. 真实 settings 服务的对外 API
// ---------------------------------------------------------------------------
console.log('\n[1] 真实 @deepseek-ai/dsh-settings 的对外 API')
const settingsModule = await import(pathToFileURL(SETTINGS_SRC).href)
const SettingsForms = settingsModule.SettingsForms
const proto = SettingsForms.prototype
console.log(`  exports: ${Object.keys(settingsModule).sort().join(', ')}`)
console.log(`  prototype: ${Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor').sort().join(', ')}`)
check('没有了 register()（0.1.7 已移除）', typeof proto.register !== 'function')
check('没有了 get()（0.1.7 已移除）', typeof proto.get !== 'function')
check('仍有 mutate() / update() / writable', typeof proto.mutate === 'function'
  && typeof proto.update === 'function'
  && Object.getOwnPropertyDescriptor(proto, 'writable') !== undefined)

// ---------------------------------------------------------------------------
// 2. 用真实 API 形状的 ctx 跑 apply()
// ---------------------------------------------------------------------------
console.log('\n[2] pet.apply() 在 0.1.7 API 形状下能否正常激活')
const pet = await import(pathToFileURL(`${PET_ROOT}/lib/index.js`).href)

const routes = []
const events = new Map()
const registered = { projections: [], settingsWrites: [], jobSubscriptions: [] }
let settingsValue = null
/** settings 服务替身：方法集严格照抄真实 SettingsForms.prototype。 */
const settingsStub = {}
for (const name of Object.getOwnPropertyNames(proto)) {
  if (name === 'constructor') continue
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)
  if (descriptor.get !== undefined) {
    Object.defineProperty(settingsStub, name, { get: () => (name === 'writable' ? true : undefined) })
  } else {
    settingsStub[name] = () => undefined
  }
}
settingsStub.mutate = (ns, ops) => { registered.settingsWrites.push({ ns, ops }); return Promise.resolve() }
settingsStub.describe = () => []

const childEvents = []
const rootEvents = []
const childHeader = { id: 'child-1', parentSession: 'root-1', origin: 'subagent', createdAt: Date.now() }
const rootHeader = { id: 'root-1', createdAt: Date.now() }

/** cosmokit 的 volatile 引用：只有 get()，写入靠 Symbol。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
const volatile = (value) => ({ get: () => value, [VOLATILE_WRITE]: () => {} })

// ---------------------------------------------------------------------------
// 假 ctx：**必须覆盖插件 inject 的每一个服务**。
//
// 【为什么这是硬要求】上一次事故（0.1.7 删掉 jobs.onJobDone）之所以没被这个
// 自检抓到，就是因为这里的 get() 对 'jobs' 返回 undefined —— 插件那段被静默
// 跳过，自检"全绿"，而真实启动时 apply() 抛错、整个 entry 不激活、桌宠消失。
// 所以下面：
//   1. 按 inject 列表**逐一断言**桩里确实有这个服务；
//   2. 用 0.1.7 的真实 API 形状（jobs.events.subscribe / shell.execute / timer.interval）；
//   3. 收集 apply 期间的 logger.warn —— 只要出现"已跳过该功能"就判失败。
// ---------------------------------------------------------------------------
const warnings = []
const logger = {
  info: () => {}, debug: () => {},
  warn: (...args) => { warnings.push(args.map(String).join(' ')) },
  error: (...args) => { warnings.push('ERROR ' + args.map(String).join(' ')) },
}

/** jobs 服务（0.1.7 形状：事件流，没有 onJobDone）。 */
const jobsStub = {
  events: { subscribe: (filter, listener) => { registered.jobSubscriptions.push({ filter, listener }); return () => {} } },
  list: () => [], get: () => undefined, kill: () => 'requested', remove: () => {},
}
/** timer 服务（vendor/cordis-plugin-timer）。 */
const timerStub = { interval: () => () => {}, timeout: () => () => {} }
/** shell 服务（0.1.7 形状：resolve + execute→句柄.result()，没有 run）。 */
const shellCalls = { resolve: 0, execute: 0 }
const shellStub = {
  resolve: (request) => {
    shellCalls.resolve += 1
    return { ...request, workdir: '.', timeoutMs: request.timeoutMs ?? 1000, onExpiry: 'kill', stdoutMaxBytes: request.stdoutMaxBytes ?? 65536, sandboxPolicy: request.sandboxPolicy }
  },
  execute: async () => {
    shellCalls.execute += 1
    // 回一个合法 JSON：验证 execute → 句柄.result() → stdout.text 这条链路真的通
    return { result: async () => ({ exitCode: 0, stdout: { text: '{"ok":false,"error":"stub-shell"}' }, stderr: { text: '' } }) }
  },
}
/** credentials 服务。 */
const credentialsStub = { resolve: async () => undefined }

const ctx = {
  // loader fiber：entry.options.id 就是 settings 表单寻址用的 ns；
  // config 是**逐字段 volatile 包装**的真实形状（loader 解析后的样子）
  fiber: {
    config: {
      city: volatile('济南'),
      roam: volatile(false),
      dashboardWindowDays: volatile(14),
      buttonSide: volatile('left'),
    },
    entry: { options: { id: 'pet' } },
  },
  effect: (fn) => { const result = fn(); return () => { if (typeof result === 'function') result() } },
  on: (name, fn) => { events.set(name, fn) },
  get: (name) => {
    if (name === 'sessions') {
      return {
        list: () => [{ header: rootHeader }, { header: childHeader }],
        get: (id) => (id === 'root-1' ? { snapshotEvents: () => rootEvents } : undefined),
      }
    }
    if (name === 'sessionPersistence') return { list: async () => [{ header: rootHeader }, { header: childHeader }] }
    if (name === 'jobs') return jobsStub
    if (name === 'timer') return timerStub
    if (name === 'shell') return shellStub
    if (name === 'credentials') return credentialsStub
    if (name === 'sandboxPolicy') return { resolve: () => undefined }
    if (name === 'agents') return { roots: () => [], list: () => [{ id: 'agent-1', status: 'running' }] }
    return undefined
  },
  settings: settingsStub,
  sessionProjections: { register: (definition) => { registered.projections.push(definition && definition.key) } },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  logger,
}

// inject 覆盖断言：桩必须为每个声明的服务提供实现，否则插件里那一段会被
// 静默跳过，自检就会"假绿"（上次事故就是这么漏过去的）。
const missingStubs = (pet.inject ?? []).filter(name => ctx.get(name) === undefined && ctx[name] === undefined)
check(`假 ctx 覆盖了 inject 的全部服务（${(pet.inject ?? []).join(', ')}）`, missingStubs.length === 0,
  `缺少桩: ${missingStubs.join(', ')}`)

let applied = true
try {
  const config = pet.Config({})
  settingsValue = config
  pet.apply(ctx, config)
} catch (error) {
  applied = false
  console.log(`  apply() 抛出：${error.constructor.name}: ${error.message}`)
}
check('apply() 不抛错', applied)
check('没有任何功能被"跳过"（warnSkip 零命中）', warnings.filter(w => w.includes('已跳过该功能')).length === 0,
  warnings.join(' | '))
check('后台任务通知订阅了 jobs 事件流（0.1.7 的 jobs.events.subscribe）',
  registered.jobSubscriptions.length > 0, JSON.stringify(registered.jobSubscriptions))
check('注册了 costUsage 投影', registered.projections.includes('costUsage'), JSON.stringify(registered.projections))
for (const path of ['/api/whale-balance', '/api/whale-pet/state', '/api/whale-pet/usage',
  '/api/whale-pet/settings', '/api/whale-pet/subtree-cost', '/api/whale-pet/weather', '/pet']) {
  check(`注册了路由 ${path}`, routes.some(route => route.path === path))
}

// ---------------------------------------------------------------------------
// 3. 端到端：喂子会话用量 → 余额按钮的今日花费 / 子会话费用接口
// ---------------------------------------------------------------------------
console.log('\n[3] 端到端：子会话用量是否进入内部统计')
const onSessionEvent = events.get('session/event')
check('监听了 session/event（账本实时折叠）', typeof onSessionEvent === 'function')

const now = Date.now()
const usage = { inputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 0, outputTokens: 500 }
const feed = (sessionId, header, sink, turn) => {
  const session = { id: sessionId }
  const headerEvent = {
    type: 'request/header', seq: sink.length, time: now,
    data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } },
  }
  const messageEvent = {
    type: 'assistant/message', seq: sink.length + 1, time: now,
    data: { turn, step: 1, usage, message: { id: `${sessionId}-m${turn}` } },
  }
  sink.push(headerEvent, messageEvent)
  onSessionEvent(session, headerEvent)
  onSessionEvent(session, messageEvent)
}
feed('root-1', rootHeader, rootEvents, 1)
feed('child-1', childHeader, childEvents, 1)
/** 打一个路由：返回 `{ status, json }`。 */
const hit = async (path, options = {}) => {
  const route = routes.find(item => item.path === path)
  if (route === undefined) throw new Error(`route ${path} not registered`)
  const chunks = []
  const res = {
    statusCode: 0,
    headers: undefined,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { if (body !== undefined) chunks.push(String(body)) },
  }
  const req = { method: options.method ?? 'GET', url: options.url ?? path }
  await route.handler(req, res)
  const text = chunks.join('')
  let json
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: res.statusCode, json, text }
}

const balance = await hit('/api/whale-balance')
console.log(`  /api/whale-balance → ${balance.status} usage=${JSON.stringify(balance.json && balance.json.usage)}`)
check('余额路由返回了今日用量', balance.json !== undefined && balance.json.usage !== undefined)
check('今日花费走账本口径（含子会话）', balance.json?.usage?.source === 'ledger')

const subtree = await hit('/api/whale-pet/subtree-cost', { url: '/api/whale-pet/subtree-cost?session=root-1' })
console.log(`  /api/whale-pet/subtree-cost → ${subtree.status} ${JSON.stringify(subtree.json)}`)
check('子会话费用接口可用', subtree.status === 200 && subtree.json?.ok === true)
check('按会话树认出了子会话', subtree.json?.descendants?.count === 1)
check('子会话金额 > 0（就是先前被漏掉的那部分）', Number(subtree.json?.descendants?.costCny) > 0)
check('按轮归集把子会话归到父 turn 1', Number(subtree.json?.byTurn?.['1']?.costCny) > 0)

// ---------------------------------------------------------------------------
// 4. 设置写回是否按 profile entry id 寻址
// ---------------------------------------------------------------------------
console.log('\n[4] 设置写回：ctx.settings.mutate(entryId, ops)')
const write = await hit('/api/whale-pet/settings', {
  method: 'POST',
  url: '/api/whale-pet/settings',
  body: JSON.stringify({ ops: [{ op: 'set', path: ['city'], value: '济南' }] }),
})
// handler 从 req 读 body：这里用最小 Readable 替身重打一次
if (write.status === 400) {
  const route = routes.find(item => item.path === '/api/whale-pet/settings')
  const res = { statusCode: 0, writeHead(status) { this.statusCode = status }, end() {} }
  const { Readable } = await import('node:stream')
  const req = Readable.from([JSON.stringify({ ops: [{ op: 'set', path: ['city'], value: '济南' }] })])
  req.method = 'POST'
  req.url = '/api/whale-pet/settings'
  await route.handler(req, res)
}
console.log(`  settings writes: ${JSON.stringify(registered.settingsWrites)}`)
check('mutate() 用 entry id "pet" 寻址', registered.settingsWrites[0]?.ns === 'pet',
  JSON.stringify(registered.settingsWrites))
check('ops 原样透传给 settings 服务', Array.isArray(registered.settingsWrites[0]?.ops)
  && registered.settingsWrites[0].ops.length === 1)

// ---------------------------------------------------------------------------
// 5. volatile 配置解包（0.1.7 的 Config 字段是 { get() } 引用，不是普通值）
// ---------------------------------------------------------------------------
console.log('\n[5] volatile 配置解包：resolveConfig() 必须给出普通值')
const settingsGet = await hit('/api/whale-pet/settings', { url: '/api/whale-pet/settings' })
const readBack = settingsGet.json?.value
console.log(`  GET /api/whale-pet/settings → ${JSON.stringify(readBack)}`)
check('volatile 字段被解包成普通值（不是 { get } 引用）', readBack?.city === '济南', JSON.stringify(readBack?.city))
check('布尔 volatile 字段解包正确', readBack?.roam === false, String(readBack?.roam))
check('数值 volatile 字段解包正确', readBack?.dashboardWindowDays === 14, String(readBack?.dashboardWindowDays))
check('settings 路由报告 writable', settingsGet.json?.writable === true)

// 看板窗口应读到 volatile 里的 14 天
const usageRoute = await hit('/api/whale-pet/usage', { url: '/api/whale-pet/usage' })
check('看板窗口按 volatile 配置生效（14 天）', usageRoute.json?.windowDays === 14, String(usageRoute.json?.windowDays))

// ---------------------------------------------------------------------------
// 5b. /state 带权威 running：客户端靠它自愈，不再依赖边沿事件
//     （手动停止后卡在"工作中"就是漏一条 agent/status idle 导致的）
// ---------------------------------------------------------------------------
console.log('\n[5b] /api/whale-pet/state 带权威工作状态')
const stateRoute = await hit('/api/whale-pet/state', { url: '/api/whale-pet/state' })
check('state 路由带 running 布尔（现算自 agents 注册表）', stateRoute.json?.running === true,
  JSON.stringify(stateRoute.json?.running))
check('state 路由仍带 items 与 settings', Array.isArray(stateRoute.json?.items)
  && typeof stateRoute.json?.settings === 'object')

// ---------------------------------------------------------------------------
// 6. 后台任务通知：0.1.7 的 jobs.events.subscribe → settled 事件
//    （这正是上次没查出来、把整个插件打死的那处 API）
// ---------------------------------------------------------------------------
console.log('\n[6] 后台任务通知走 jobs 事件流（0.1.7 删掉了 onJobDone）')
check('订阅已建立', registered.jobSubscriptions.length > 0)
for (const subscription of registered.jobSubscriptions) {
  // 卸载时的结算不应打扰用户
  subscription.listener({ type: 'settled', cause: 'teardown', awaited: true, job: { id: 'bash-9', label: 'teardown-job', status: 'killed' } })
  subscription.listener({ type: 'settled', cause: 'producer', awaited: false, job: { id: 'bash-1', label: 'pnpm test', status: 'completed' } })
}
const afterJobs = await hit('/api/whale-pet/state')
const queued = JSON.stringify(afterJobs.json ?? {})
console.log(`  /api/whale-pet/state → ${queued.slice(0, 220)}`)
check('settled(completed) 产出了"后台任务完成"通知', queued.includes('pnpm test'))
check('cause=teardown 的结算被忽略（不算任务完成）', !queued.includes('teardown-job'))

// ---------------------------------------------------------------------------
// 7. shell 路径：天气路由必须走 0.1.7 的 execute()+result()（老代码用 run()）
// ---------------------------------------------------------------------------
console.log('\n[7] shell 路径（0.1.7 把 run() 换成了 execute()）')
const weather = await hit('/api/whale-pet/weather', { url: '/api/whale-pet/weather' })
console.log(`  /api/whale-pet/weather → ${weather.status} ${(weather.text ?? '').slice(0, 160)}`)
check('调到 shell.resolve + shell.execute', shellCalls.resolve > 0 && shellCalls.execute > 0,
  JSON.stringify(shellCalls))
check('execute → result() → stdout.text 链路通（把桩的错误原样透出来）',
  weather.json?.error === 'stub-shell', weather.text?.slice(0, 200))

// ---------------------------------------------------------------------------
console.log('')
if (failures.length === 0) {
  console.log('全部通过 ✅')
} else {
  console.log(`失败 ${failures.length} 项 ❌：${failures.join(' | ')}`)
  process.exitCode = 1
}
