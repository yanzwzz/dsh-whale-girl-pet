/**
 * ============================================================================
 * lib/weather.js —— 天气响应整形（纯函数、零依赖、可单测）
 * ============================================================================
 *
 * 【为什么单独成模块】
 *   宿主半侧原来把「取天气 → 选明日天气码 → 码表映射 → 拼 JSON」整段写成
 *   Windows PowerShell 脚本，再交给 `ctx.get('shell')` 执行。DSH 在 Linux/macOS
 *   上的 shell 服务是 `bash -c`，于是那段脚本第一行就语法错误，天气/余额按钮
 *   在非 Windows 上必然失败（issue #2）。
 *
 *   现在拆成两半：
 *     · 网络请求 —— 由 index.js 用 Node 的全局 fetch 直接发（不经过 shell，
 *       也就不再需要为"网络"申请 danger-full-access 沙箱策略）；
 *     · 整形逻辑 —— 就是本文件，纯函数，可单测，与平台无关。
 *
 * 【与旧 PowerShell 脚本的对应关系】
 *   WmoIcon([int]$code)  → wmoIcon(code)   （WMO 0–99，保留为 <100 的兼容分支）
 *   WmoDesc([int]$code)  → wmoDesc(code)
 *   脚本后半段的取值逻辑 → tomorrowWeatherCode() / nearestCoords() / shapeWeather()
 *   逐条对齐，返回给浏览器半侧的字段名与结构保持不变（客户端无需改动）。
 *
 * 【顺带修掉的第二个 bug：码表用错了】wttr.in 的 weatherCode 实际是 **WWO 码**
 * （113=晴、122=阴）而不是 WMO 码，旧表把 ≥95 全判成"雷雨"，于是天气图标永远是 ⛈️。
 * 现在 ≥100 走 WWO_TABLE（见 iconFor / descFor），<100 仍按 WMO 表处理。
 */

/**
 * WWO（WorldWeatherOnline）天气码 → [emoji, 中文]。
 *
 * 【为什么需要第二张表】wttr.in 的 `weatherCode` 用的是 **WWO 码**（113=晴、116=局部多云、
 * 122=阴……），不是 WMO 码。旧实现只写了 WMO 码表，而 WMO 表里 `>= 95 → ⛈️/雷雨`，
 * 于是 113/122 这些三位数**全部落进"雷雨"**——天气图标永远是 ⛈️、描述永远是"雷雨"。
 * 这一点在 issue #2 的报告里其实有指纹：他按旧表改写后真机复测拿到的仍是
 * `"icon":"⛈️","tomorrowDesc":"雷雨"`。
 *
 * 顺带说明：`lang=zh` 并不会让 j1 响应给出中文（实测 `lang_zh` 仍是 "Clear"），
 * 所以本地中文映射是必要的，只是码表要用对。
 */
const WWO_TABLE = {
  113: ['☀️', '晴'],
  116: ['⛅', '局部多云'],
  119: ['☁️', '多云'],
  122: ['☁️', '阴'],
  143: ['🌫️', '薄雾'],
  149: ['🌫️', '霾'],
  176: ['🌦️', '局部有雨'],
  179: ['🌨️', '局部有雪'],
  182: ['🌨️', '局部雨夹雪'],
  185: ['🌧️', '局部冻毛毛雨'],
  200: ['⛈️', '附近有雷阵雨'],
  227: ['🌨️', '吹雪'],
  230: ['❄️', '暴风雪'],
  248: ['🌫️', '雾'],
  260: ['🌫️', '冻雾'],
  263: ['🌦️', '局部小毛毛雨'],
  266: ['🌦️', '小毛毛雨'],
  281: ['🌧️', '冻毛毛雨'],
  284: ['🌧️', '强冻毛毛雨'],
  293: ['🌦️', '局部小雨'],
  296: ['🌦️', '小雨'],
  299: ['🌧️', '间歇中雨'],
  302: ['🌧️', '中雨'],
  305: ['🌧️', '间歇大雨'],
  308: ['🌧️', '大雨'],
  311: ['🌧️', '小冻雨'],
  314: ['🌧️', '中到大冻雨'],
  317: ['🌨️', '小雨夹雪'],
  320: ['🌨️', '中到大雨夹雪'],
  323: ['🌨️', '局部小雪'],
  326: ['🌨️', '小雪'],
  329: ['❄️', '局部中雪'],
  332: ['❄️', '中雪'],
  335: ['❄️', '局部大雪'],
  338: ['❄️', '大雪'],
  350: ['🌨️', '冰粒'],
  353: ['🌦️', '小阵雨'],
  356: ['🌧️', '中到大阵雨'],
  359: ['🌧️', '暴雨级阵雨'],
  362: ['🌨️', '小阵雨夹雪'],
  365: ['🌨️', '中到大阵雨夹雪'],
  368: ['🌨️', '小阵雪'],
  371: ['❄️', '中到大阵雪'],
  374: ['🌨️', '小冰粒阵'],
  377: ['🌨️', '中到大冰粒阵'],
  386: ['⛈️', '局部雷阵雨'],
  389: ['⛈️', '中到大雷阵雨'],
  392: ['⛈️', '局部雷阵雪'],
  395: ['⛈️', '中到大雷阵雪'],
};

/**
 * 天气码 → emoji 图标。wttr.in 现在给的是 WWO 三位码，所以 ≥100 走 WWO 表；
 * <100 仍按 WMO 表处理（兼容其它数据源 / 旧行为）。
 * @param code - WWO 或 WMO 天气码。
 * @returns 图标字符串。
 */
export function iconFor(code) {
  const c = intOf(code);
  if (c >= 100) {
    const row = WWO_TABLE[c];
    return row === undefined ? '🌤' : row[0];
  }
  return wmoIcon(c);
}

/**
 * 天气码 → 中文描述。规则同 {@link iconFor}。
 * @param code - WWO 或 WMO 天气码。
 * @returns 中文描述。
 */
export function descFor(code) {
  const c = intOf(code);
  if (c >= 100) {
    const row = WWO_TABLE[c];
    return row === undefined ? '多云' : row[1];
  }
  return wmoDesc(c);
}

/**
 * 把 wttr.in 返回的字符串数字转成整数。
 * 旧 PowerShell 用 `[int]`（向零截断）；非法值时旧脚本会抛错，这里退化为 0。
 * @param value - 数字或数字字符串。
 * @returns 截断后的整数（无法解析时为 0）。
 */
export function intOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * WMO 天气码 → emoji 图标。逐条对应旧脚本的 `WmoIcon`。
 * @param code - WMO weather code（0–99）。
 * @returns 图标字符串。
 */
export function wmoIcon(code) {
  const c = intOf(code);
  if (c === 0) return '☀️';
  if (c <= 2) return '⛅';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';
  if (c >= 51 && c <= 57) return '🌦️';
  if (c >= 61 && c <= 67) return '🌧️';
  if (c >= 71 && c <= 77) return '❄️';
  if (c >= 80 && c <= 82) return '🌧️';
  if (c >= 85 && c <= 86) return '🌨️';
  if (c >= 95) return '⛈️';
  return '🌤';
}

/**
 * WMO 天气码 → 中文描述。逐条对应旧脚本的 `WmoDesc`（判断顺序也保持一致）。
 * @param code - WMO weather code（0–99）。
 * @returns 中文描述。
 */
export function wmoDesc(code) {
  const c = intOf(code);
  if (c === 0) return '晴';
  if (c === 1) return '大致晴朗';
  if (c === 2) return '局部多云';
  if (c === 3) return '阴';
  if (c === 45 || c === 48) return '雾';
  if (c >= 51 && c <= 57) return '毛毛雨';
  if (c === 61 || c === 66 || c === 67) return '小雨';
  if (c === 63) return '中雨';
  if (c === 65) return '大雨';
  if (c >= 71 && c <= 77) return '雪';
  if (c === 80) return '阵雨';
  if (c === 81 || c === 82) return '强阵雨';
  if (c >= 85 && c <= 86) return '阵雪';
  if (c >= 95) return '雷雨';
  return '多云';
}

/**
 * 明日代表性天气码：先取 12:00 / 15:00，取不到（或恰好为 0）时退到白天最早的一段。
 * 与旧脚本一致——包括"12:00 真的是 0（晴）时也会走一次兜底"这一行为。
 * @param tomorrow - wttr j1 的 `weather[1]` 对象。
 * @returns WMO 天气码（无hourly 数据时为 0）。
 */
export function tomorrowWeatherCode(tomorrow) {
  const hourly = tomorrow !== null && tomorrow !== undefined && Array.isArray(tomorrow.hourly)
    ? tomorrow.hourly
    : [];
  let code = 0;
  for (const hour of hourly) {
    if (hour === null || hour === undefined) continue;
    if (hour.time === '1200' || hour.time === '1500') {
      code = intOf(hour.weatherCode);
      break;
    }
  }
  if (code === 0) {
    const daytime = hourly.find((hour) => hour !== null && hour !== undefined
      && ['600', '900', '1200', '1500', '1800'].includes(hour.time));
    if (daytime !== undefined) code = intOf(daytime.weatherCode);
  }
  return code;
}

/**
 * wttr j1 里最近站点的经纬度（自动定位反查地名用）。
 * @param json - wttr j1 JSON。
 * @returns { latitude, longitude }（字符串，与旧脚本一致）或 undefined。
 */
export function nearestCoords(json) {
  const area = json !== null && json !== undefined && Array.isArray(json.nearest_area)
    ? json.nearest_area[0]
    : undefined;
  if (area === null || area === undefined) return undefined;
  const latitude = area.latitude === undefined || area.latitude === null ? '' : String(area.latitude);
  const longitude = area.longitude === undefined || area.longitude === null ? '' : String(area.longitude);
  if (!latitude || !longitude) return undefined;
  return { latitude, longitude };
}

/**
 * wttr 自带的地名（反查失败时的兜底，通常是当地语言的城市名）。
 * @param json - wttr j1 JSON。
 * @returns 地名或 undefined。
 */
export function nearestAreaName(json) {
  const area = json !== null && json !== undefined && Array.isArray(json.nearest_area)
    ? json.nearest_area[0]
    : undefined;
  if (area === null || area === undefined) return undefined;
  const first = Array.isArray(area.areaName) ? area.areaName[0] : undefined;
  const value = first !== null && first !== undefined && typeof first.value === 'string' ? first.value : '';
  return value || undefined;
}

/**
 * 把 wttr j1 JSON 整形成浏览器半侧要的结构（字段与旧 PowerShell 输出逐字一致）。
 *
 * 【为什么带上 icon / temp】客户端当前只显示明日天气，但这两个字段是既有响应契约的
 * 一部分（0.3.x 起就在），保留它们不会让客户端改代码，也方便别的消费者复用。
 *
 * @param json - wttr j1 JSON。
 * @param cityName - 已确定要显示的城市名（配置里的城市，或反查结果）。
 * @returns 成功对象 `{ ok, city, icon, temp, tomorrowIcon, tomorrowLow, tomorrowHigh, tomorrowDesc }`
 *          或失败对象 `{ ok:false, error }`。
 */
export function shapeWeather(json, cityName) {
  const current = json !== null && json !== undefined && Array.isArray(json.current_condition)
    ? json.current_condition[0]
    : undefined;
  if (current === null || current === undefined) return { ok: false, error: 'wttr.in 响应格式未知' };

  const weather = json !== null && json !== undefined && Array.isArray(json.weather) ? json.weather : undefined;
  if (weather === undefined || weather.length < 2) return { ok: false, error: '没有拿到明日预报数据' };

  const tomorrow = weather[1] === null || weather[1] === undefined ? {} : weather[1];
  const code = tomorrowWeatherCode(tomorrow);
  const tempC = current.temp_C === undefined || current.temp_C === null ? '' : String(current.temp_C);
  return {
    ok: true,
    city: cityName === undefined || cityName === null ? '' : String(cityName),
    icon: iconFor(current.weatherCode),
    temp: tempC + '°C',
    tomorrowIcon: iconFor(code),
    tomorrowLow: intOf(tomorrow.mintempC),
    tomorrowHigh: intOf(tomorrow.maxtempC),
    tomorrowDesc: descFor(code),
  };
}
