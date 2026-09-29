/**
 * dsh-whale-girl-pet 天气整形单测（lib/weather.js）
 *
 * 覆盖两层：
 *   1) 码表 —— WMO（<100，旧实现遗留）与 WWO（≥100，wttr.in 实际返回值）；
 *   2) 整形 —— shapeWeather 的字段与全部失败分支。
 *
 * 其中「WWO 码被 WMO 表判成雷雨」是 issue #2 排查时顺带发现的真实缺陷：
 * 旧表把 ≥95 一律当雷雨，而 wttr 给的是 113/122 这类三位码，于是天气图标永远 ⛈️。
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  intOf, wmoIcon, wmoDesc, iconFor, descFor, tomorrowWeatherCode, nearestCoords, nearestAreaName, shapeWeather,
} from '../lib/weather.js';

const HOST_PATH = fileURLToPath(new URL('../lib/index.js', import.meta.url));

/** 按真实 wttr.in j1 响应（2026-09-29 实测济南）裁剪出的夹具：码值都是真实值。 */
const REAL_SHAPE = {
  current_condition: [{ temp_C: '28', weatherCode: '113', weatherDesc: [{ value: 'Clear ' }] }],
  nearest_area: [{ latitude: '36.683', longitude: '117.050', areaName: [{ value: 'Hongjialou' }] }],
  weather: [
    { maxtempC: '26', mintempC: '17', hourly: [{ time: '1200', weatherCode: '116' }] },
    {
      maxtempC: '24',
      mintempC: '18',
      hourly: [
        { time: '0', weatherCode: '113' },
        { time: '300', weatherCode: '113' },
        { time: '600', weatherCode: '116' },
        { time: '900', weatherCode: '119' },
        { time: '1200', weatherCode: '122' },
        { time: '1500', weatherCode: '176' },
        { time: '1800', weatherCode: '176' },
        { time: '2100', weatherCode: '113' },
      ],
    },
    { maxtempC: '22', mintempC: '16', hourly: [] },
  ],
};

test('intOf：字符串数字按整数解析，非法值退化为 0', () => {
  assert.equal(intOf('28'), 28);
  assert.equal(intOf('22.7'), 22); // 向零截断（对齐旧 PowerShell 的 [int]）
  assert.equal(intOf(-3.9), -3);
  assert.equal(intOf(undefined), 0);
  assert.equal(intOf('abc'), 0);
});

test('WMO 码表（<100）逐条对齐旧 PowerShell 脚本', () => {
  assert.equal(wmoIcon(0), '☀️');
  assert.equal(wmoIcon(1), '⛅');
  assert.equal(wmoIcon(3), '☁️');
  assert.equal(wmoIcon(45), '🌫️');
  assert.equal(wmoIcon(48), '🌫️');
  assert.equal(wmoIcon(53), '🌦️');
  assert.equal(wmoIcon(63), '🌧️');
  assert.equal(wmoIcon(73), '❄️');
  assert.equal(wmoIcon(81), '🌧️');
  assert.equal(wmoIcon(86), '🌨️');
  assert.equal(wmoIcon(97), '⛈️');
  assert.equal(wmoIcon(7), '🌤'); // 未覆盖的码走默认图标

  assert.equal(wmoDesc(0), '晴');
  assert.equal(wmoDesc(1), '大致晴朗');
  assert.equal(wmoDesc(2), '局部多云');
  assert.equal(wmoDesc(3), '阴');
  assert.equal(wmoDesc(45), '雾');
  assert.equal(wmoDesc(55), '毛毛雨');
  assert.equal(wmoDesc(61), '小雨');
  assert.equal(wmoDesc(63), '中雨');
  assert.equal(wmoDesc(65), '大雨');
  assert.equal(wmoDesc(75), '雪');
  assert.equal(wmoDesc(80), '阵雨');
  assert.equal(wmoDesc(82), '强阵雨');
  assert.equal(wmoDesc(85), '阵雪');
  assert.equal(wmoDesc(95), '雷雨');
  assert.equal(wmoDesc(7), '多云');
});

test('WWO 码表（≥100）：修掉「113/122 被判成雷雨」这个真实缺陷', () => {
  // 回归点：旧实现在这两处都会给出 ⛈️ / 雷雨
  assert.equal(iconFor(113), '☀️');
  assert.equal(descFor(113), '晴');
  assert.notEqual(iconFor(113), '⛈️');
  assert.notEqual(descFor(113), '雷雨');
  assert.equal(iconFor(122), '☁️');
  assert.equal(descFor(122), '阴');
  assert.notEqual(descFor(122), '雷雨');

  // 真实载荷里出现过的码
  assert.equal(descFor(116), '局部多云');
  assert.equal(descFor(119), '多云');
  assert.equal(descFor(149), '霾'); // 非标准 WWO 码，实测 wttr 会给
  assert.equal(descFor(176), '局部有雨');

  // 真正的雷雨码仍然报雷雨
  assert.equal(iconFor(200), '⛈️');
  assert.equal(descFor(200), '附近有雷阵雨');
  assert.equal(iconFor(389), '⛈️');
  assert.equal(descFor(389), '中到大雷阵雨');

  // 未知三位码不抛异常，走中性默认值
  assert.equal(iconFor(999), '🌤');
  assert.equal(descFor(999), '多云');

  // 字符串输入同样可用（wttr 的码是字符串）
  assert.equal(iconFor('113'), '☀️');
  assert.equal(descFor('113'), '晴');
});

test('tomorrowWeatherCode：优先 12:00 / 15:00，为 0 时兜底白天最早一段', () => {
  const hourly = [
    { time: '600', weatherCode: '116' },
    { time: '1200', weatherCode: '122' },
    { time: '1500', weatherCode: '176' },
  ];
  assert.equal(tomorrowWeatherCode({ hourly }), 122, '12:00 优先');

  assert.equal(
    tomorrowWeatherCode({ hourly: [{ time: '900', weatherCode: '119' }, { time: '1500', weatherCode: '119' }] }),
    119,
    '没有 12:00 时用 15:00',
  );

  assert.equal(
    // 真实载荷里 hourly 是按 0/300/600/…/2100 排好序的，所以兜底取到的是最早的白天段
    tomorrowWeatherCode({ hourly: [{ time: '600', weatherCode: '61' }, { time: '1200', weatherCode: '0' }] }),
    61,
    '码为 0 时按旧脚本行为兜底到白天最早一段',
  );

  assert.equal(tomorrowWeatherCode({ hourly: [] }), 0);
  assert.equal(tomorrowWeatherCode({}), 0);
  assert.equal(tomorrowWeatherCode(undefined), 0);
});

test('nearestCoords / nearestAreaName：取最近站点经纬度与兜底地名', () => {
  assert.deepEqual(nearestCoords(REAL_SHAPE), { latitude: '36.683', longitude: '117.050' });
  assert.equal(nearestAreaName(REAL_SHAPE), 'Hongjialou');
  assert.equal(nearestCoords({}), undefined);
  assert.equal(nearestAreaName({}), undefined);
  assert.equal(nearestCoords({ nearest_area: [{ latitude: '36.683' }] }), undefined, '缺经度时不返回半份坐标');
});

test('shapeWeather：字段与真实响应逐字对齐', () => {
  assert.deepEqual(shapeWeather(REAL_SHAPE, '济南'), {
    ok: true,
    city: '济南',
    icon: '☀️',            // 当前码 113
    temp: '28°C',
    tomorrowIcon: '☁️',    // 明日 12:00 码 122
    tomorrowLow: 18,
    tomorrowHigh: 24,
    tomorrowDesc: '阴',
  });
  // 自动定位时传进来的地名可能是兜底来的字符串，任何字符串都原样透出
  assert.equal(shapeWeather(REAL_SHAPE, '当前位置').city, '当前位置');
});

test('shapeWeather：两类失败分支与旧实现文案一致', () => {
  assert.deepEqual(shapeWeather({}, '济南'), { ok: false, error: 'wttr.in 响应格式未知' });
  assert.deepEqual(shapeWeather({ current_condition: [] }, '济南'), { ok: false, error: 'wttr.in 响应格式未知' });
  assert.deepEqual(
    shapeWeather({ current_condition: [{ weatherCode: '113' }], weather: [{ maxtempC: '1', mintempC: '0' }] }, '济南'),
    { ok: false, error: '没有拿到明日预报数据' },
    '只有今天时不给明日字段（客户端会显示失败而不是 0°）',
  );
  assert.deepEqual(shapeWeather(undefined, '济南'), { ok: false, error: 'wttr.in 响应格式未知' });
});

test('issue #2 回归：宿主半侧不再经过 shell，两处查询都直连并带超时', () => {
  const source = readFileSync(HOST_PATH, 'utf8');
  // 注释里会引用旧写法（那是必要的来龙去脉），所以只对**去掉注释后的代码**做否定断言
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const gone of ['Invoke-RestMethod', 'PSEdition', '[Console]::OutputEncoding', "ctx.get('shell')", 'runShell', 'resolvePolicy', 'sandboxPolicy']) {
    assert.equal(code.includes(gone), false, '宿主半侧的代码里不应再出现 ' + gone);
  }
  assert.ok(source.includes("fetch('https://api.deepseek.com/user/balance'"), '余额必须直连官方接口');
  assert.ok(source.includes("'https://wttr.in/'"), '天气必须直连 wttr.in');
  assert.ok(source.includes('AbortSignal.timeout(FETCH_TIMEOUT_MS)'), '两处请求都必须带超时');
  assert.ok(source.includes("import { shapeBalance } from './balance.js'"), '余额整形必须走纯函数模块');
  assert.ok(source.includes("import { nearestAreaName, nearestCoords, shapeWeather } from './weather.js'"), '天气整形必须走纯函数模块');
});
