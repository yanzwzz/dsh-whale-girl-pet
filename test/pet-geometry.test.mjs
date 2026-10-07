/**
 * dsh-whale-girl-pet 宠物几何单测（issue #10：位置与大小可调）。
 *
 * 关键设计：测试不是"再抄一份实现"，而是**从 lib/client.js 里把纯函数源码抠出来**
 * （夹取/换算/拖动/缩放），写进临时 ESM 模块后 import() 再跑（不用 eval / new Function，
 * 与 holiday-peak / client-bundle 的做法一致）。所以这里跑的就是插件真实运行的那段代码。
 *
 * 覆盖的口径：
 *   · size 夹在 40..400（与宿主 schema 的 min/max 一致）；
 *   · posX/posY = 宠物**可见外框左上角**的视口 px，两个都有值才算"自定义位置"；
 *   · X 夹进 [0, 视口宽 − 尺寸]；Y 夹进 [0, 视口高 − 尺寸×330/360]（脚底线不出屏）；
 *   · Y 的上界恰好等于"角落模式"下舞台的实测顶部坐标 → 角落↔自定义切换不跳；
 *   · 拖框 = 整体位移；拖角 = 对角固定、保持正方形、40/400 与视口双重夹取。
 *
 * 运行：node --test（在插件根目录）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, 'utf8');

/** 读 client.js 里 `const NAME = <数字>;` 的字面量。 */
function readNumber(source, name) {
  const match = new RegExp('const ' + name + ' = ([0-9.]+);').exec(source);
  assert.notEqual(match, null, 'client.js 里必须存在常量 ' + name);
  return Number(match[1]);
}

/** 从 client.js 里抠出 `function NAME(...) {...}` 的源码（花括号配平）。 */
function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'client.js 里必须存在函数 ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' 花括号不配平');
}

const NAMES = ['clampPetSize', 'clampPetX', 'clampPetY', 'resolvePetPos', 'petBoxFromDrag', 'petBoxFromResize'];

/** 用 client.js 的真实常量 + 真实函数源码构造临时 ESM 模块。 */
async function loadGeometry() {
  const source = [
    `export const PET_SIZE_MIN = ${readNumber(CLIENT_SOURCE, 'PET_SIZE_MIN')};`,
    `export const PET_SIZE_MAX = ${readNumber(CLIENT_SOURCE, 'PET_SIZE_MAX')};`,
    `export const PET_SIZE_DEFAULT = ${readNumber(CLIENT_SOURCE, 'PET_SIZE_DEFAULT')};`,
    `export const CANVAS_H = ${readNumber(CLIENT_SOURCE, 'CANVAS_H')};`,
    `export const FEET_Y = ${readNumber(CLIENT_SOURCE, 'FEET_Y')};`,
    ...NAMES.map((name) => extractFunction(CLIENT_SOURCE, name)),
    `export { ${NAMES.join(', ')} };`,
  ].join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'wg-geometry-'));
  const file = join(dir, 'pet-geometry.mjs');
  writeFileSync(file, `${source}\n`, 'utf8');
  return import(pathToFileURL(file).href);
}

const geo = await loadGeometry();
const { PET_SIZE_MIN, PET_SIZE_MAX, PET_SIZE_DEFAULT, CANVAS_H, FEET_Y } = geo;
/** Y 上界：脚底线（外框顶 + 尺寸×330/360）刚好落在视口底边。 */
const feetLimit = (size, viewHeight) => viewHeight - size * (FEET_Y / CANVAS_H);

test('尺寸夹取：40..400、取整、非法值退回默认', () => {
  assert.equal(geo.clampPetSize(260), 260);
  assert.equal(geo.clampPetSize(300.6), 301, '必须取整');
  assert.equal(geo.clampPetSize(PET_SIZE_MIN - 1), PET_SIZE_MIN, '下界');
  assert.equal(geo.clampPetSize(PET_SIZE_MAX + 1), PET_SIZE_MAX, '上界');
  assert.equal(geo.clampPetSize(-5), PET_SIZE_MIN);
  assert.equal(geo.clampPetSize('320'), 320, '数字字符串要能接受（表单输入）');
  assert.equal(geo.clampPetSize('abc'), PET_SIZE_DEFAULT);
  assert.equal(geo.clampPetSize(undefined), PET_SIZE_DEFAULT);
  assert.equal(geo.clampPetSize(NaN, 200), 200, '非法值用第二参数兜底');
  assert.equal(geo.clampPetSize(Infinity), PET_SIZE_DEFAULT);
});

test('X 夹取：整框留在视口内；视口比宠物还窄时归 0', () => {
  assert.equal(geo.clampPetX(100, 260, 1280), 100);
  assert.equal(geo.clampPetX(-20, 260, 1280), 0);
  assert.equal(geo.clampPetX(9999, 260, 1280), 1280 - 260);
  assert.equal(geo.clampPetX(50, 400, 300), 0, '视口装不下时贴左，不产生负坐标');
  assert.equal(geo.clampPetX(undefined, 260, 1280), 0);
});

test('Y 夹取：脚底线不出屏（上界 = 视口高 − 尺寸×330/360）', () => {
  assert.equal(geo.clampPetY(100, 360, 800), 100);
  assert.equal(geo.clampPetY(-1, 360, 800), 0);
  assert.equal(geo.clampPetY(470, 360, 800), 470, '正好等于上界');
  assert.equal(geo.clampPetY(471, 360, 800), 470, '越界夹回');
  assert.equal(geo.clampPetY(9999, 360, 800), feetLimit(360, 800));
  assert.equal(geo.clampPetY(10, 400, 300), 0, '视口装不下时贴顶');
});

test('角落↔自定义不跳：Y 上界恰好是角落模式下舞台的顶部坐标', () => {
  // 角落模式：root 贴底（bottom:0），舞台再向下平移 bottomPad = size×(360-330)/360，
  // 于是可见外框顶部 = 视口高 − 尺寸 + bottomPad = 视口高 − 尺寸×330/360 —— 与 clampPetY
  // 的上界完全一致。所以「恢复默认角落」与「填像素坐标」互切时宠物不会跳一下。
  for (const [size, height] of [[260, 900], [40, 400], [400, 1200], [260, 300]]) {
    const bottomPad = (size * (CANVAS_H - FEET_Y)) / CANVAS_H;
    const cornerTop = Math.max(0, height - size) + (height - size >= 0 ? bottomPad : 0);
    const limit = Math.min(cornerTop, feetLimit(size, height));
    // 浮点：两条式子的舍入不同，按 1e-9 判等（口径一致即可）
    assert.ok(Math.abs(geo.clampPetY(1e9, size, height) - limit) < 1e-9,
      `尺寸 ${size} / 视口高 ${height}：两种口径必须一致`);
  }
});

test('自定义位置判定：两个字段都有值才算，缺一个就回角落', () => {
  const custom = geo.resolvePetPos({ posX: 100, posY: 200 }, 260, 1280, 900);
  assert.deepEqual(custom, { custom: true, x: 100, y: 200 });

  const clamped = geo.resolvePetPos({ posX: 9999, posY: 9999 }, 260, 1280, 900);
  assert.deepEqual(clamped, { custom: true, x: 1280 - 260, y: feetLimit(260, 900) }, '读出来就要夹好');

  for (const half of [{ posX: 100 }, { posY: 200 }, { posX: null, posY: 200 }, {}, { posX: '100', posY: 200 }]) {
    assert.equal(geo.resolvePetPos(half, 260, 1280, 900).custom, false, JSON.stringify(half) + ' 不是完整的自定义位置');
  }
  assert.equal(geo.resolvePetPos(undefined, 260, 1280, 900).custom, false);
});

test('拖框：整体位移并夹回视口', () => {
  const box = { size: 260, x: 300, y: 200 };
  assert.deepEqual(geo.petBoxFromDrag(box, 50, -30, 1280, 900), { size: 260, x: 350, y: 170 });
  assert.deepEqual(geo.petBoxFromDrag(box, -9999, -9999, 1280, 900), { size: 260, x: 0, y: 0 });
  assert.deepEqual(geo.petBoxFromDrag(box, 9999, 9999, 1280, 900),
    { size: 260, x: 1280 - 260, y: feetLimit(260, 900) });
});

test('拖角缩放：对角固定、保持正方形、夹取生效', () => {
  const box = { size: 100, x: 100, y: 100 };
  // 拖右下角：左上角（100,100）不动，边长跟到指针
  assert.deepEqual(geo.petBoxFromResize(box, 'se', 300, 300, 2000, 2000), { size: 200, x: 100, y: 100 });
  // 拖左上角：右下角（200,200）不动
  assert.deepEqual(geo.petBoxFromResize(box, 'nw', 0, 0, 2000, 2000), { size: 200, x: 0, y: 0 });
  // 正方形：横竖距离取较大者（指针只往一个方向拉也不变形）
  assert.deepEqual(geo.petBoxFromResize(box, 'se', 300, 120, 2000, 2000), { size: 200, x: 100, y: 100 });
  // 下界：指针压回固定点 → 最小边长
  assert.deepEqual(geo.petBoxFromResize(box, 'se', 100, 100, 2000, 2000), { size: PET_SIZE_MIN, x: 100, y: 100 });
  // 上界：越拉越大也封顶 400
  assert.equal(geo.petBoxFromResize(box, 'se', 9999, 9999, 9999, 9999).size, PET_SIZE_MAX);
  // 视口夹取：贴着右下角放大时，位置被夹回视口内
  const clamped = geo.petBoxFromResize({ size: 100, x: 100, y: 100 }, 'se', 900, 900, 500, 500);
  assert.ok(clamped.x >= 0 && clamped.x + clamped.size <= 500, 'X 必须在视口内：' + JSON.stringify(clamped));
  assert.ok(clamped.y >= 0 && clamped.y + clamped.size * (FEET_Y / CANVAS_H) <= 500, '脚底线必须在视口内：' + JSON.stringify(clamped));
  // 翻向：指针越过固定点 → 框翻到固定点另一侧（仍然是正方形、仍然贴边）
  const flipped = geo.petBoxFromResize({ size: 100, x: 100, y: 100 }, 'nw', 400, 400, 2000, 2000);
  assert.equal(flipped.size, 200, '边长 = 固定点到指针的距离');
  assert.equal(flipped.x, 200, '越过固定点后从固定点向另一侧生长');
});
