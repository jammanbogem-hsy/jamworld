// Codex 원본(design/)을 앱용 WEBP 아틀라스 + 프레임 JSON 으로 변환한다. 원본은 수정하지 않는다.
// 사용: node scripts/build-atlas.mjs
//
// 자르기 방식
// - v2 시트: design/assets/v2/manifest.json 의 frames[].rect([x,y,w,h]) 우선.
//   없으면 알파 연결 컴포넌트(α≥64, 면적>500)를 찾아 행 우선으로 정렬한다(생성 이미지 간격이 불균일하므로 균등 칸 금지).
//   작은 조각(반짝임·떨어진 잎 등)은 가장 가까운 큰 컴포넌트에 붙인다.
// - v1 시트: 기존 균등 4×4 칸 + 셀 bbox.
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN = resolve(root, "../design/assets");
const OUT_DIR = resolve(root, "public/assets/atlas");
const COLS = 4;
const ALPHA_MIN = 48; // v1 가장자리 노이즈 제거
const LINE_MIN = 4;
const COMP_ALPHA = 64;
const COMP_AREA = 500;
const PAD = 3;

const AVATAR_TD = ["s0", "s1", "s2", "s3", "w0", "w1", "w2", "w3", "n0", "n1", "n2", "n3", "e0", "e1", "e2", "e3"];
const AVATAR_ISO = ["se0", "se1", "se2", "se3", "sw0", "sw1", "sw2", "sw3", "nw0", "nw1", "nw2", "nw3", "ne0", "ne1", "ne2", "ne3"];
const SHEETS = {
  nature: ["tree", "pine", "bush", "rock", "flower", "mushroom", "crate", "barrel", "flag", "lamp", "fountain", "flowerpot"],
  furniture: ["desk", "chair@a", "chair@b", "blackboard@a", "blackboard@b", "bookshelf@a", "bookshelf@b", "table", "bench@a", "bench@b", "sign@a", "sign@b"],
  building: ["stone", "wood", "brick", "stone_seg@a", "stone_seg@b", "fence@a", "fence@b", "house@a", "house@b", "quiz@a", "quiz@b", "portal"],
};

const JOBS = [
  { name: "props", src: "moa-props-atlas.png", cell: 256, slice: "grid", uniform: false, names: ["tree", "bush", "rocks", "bench", "sign", "portal", "desk", "chair", "bookshelf", "lamp", "fountain", "flowerpot", "wall", "crate", "mushrooms", "flag"] },
  { name: "avatar", src: "moa-avatar-atlas.png", cell: 160, slice: "grid", uniform: true, names: AVATAR_TD },
];
for (const view of ["td", "iso"]) {
  for (const [sheet, names] of Object.entries(SHEETS)) {
    JOBS.push({ name: `${view}-${sheet}`, src: `v2/${view}-${sheet}.png`, cell: 256, slice: "components", uniform: false, names });
  }
  // 아이소 아바타는 v3 8방향(32프레임) 시트가 있으면 우선, 탑뷰는 v2 그대로
  const v3 = view === "iso" && existsSync(resolve(DESIGN, "v3/iso-avatar-8dir.png"));
  JOBS.push(
    v3
      ? { name: "iso-avatar", src: "v3/iso-avatar-8dir.png", cell: 160, slice: "components", uniform: true, names: AVATAR_ISO }
      : { name: `${view}-avatar`, src: `v2/${view}-avatar.png`, cell: 160, slice: "components", uniform: true, names: view === "td" ? AVATAR_TD : AVATAR_ISO },
  );
}

/** 원본 폴더(v2/v3)별 manifest */
const manifests = new Map();
function manifestFor(src) {
  const dir = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
  if (!manifests.has(dir)) {
    const p = resolve(DESIGN, dir, "manifest.json");
    manifests.set(dir, existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  }
  return manifests.get(dir);
}

for (const job of JOBS) {
  const src = resolve(DESIGN, job.src);
  if (!existsSync(src)) {
    console.log(`- ${job.name}: 원본 없음 (${job.src}) — 건너뜀`);
    continue;
  }
  await buildAtlas(job, src);
}

/** manifest 의 프레임 이름 목록 (아바타 8방향처럼 기본 목록과 다를 수 있음) */
function sheetOf(src) {
  const m = manifestFor(src);
  const file = src.split("/").pop();
  const sheets = m?.sheets ?? (m?.file ? [m] : []);
  return sheets.find((s) => s.file === file || s.file?.endsWith(`/${file}`));
}

function manifestNames(src) {
  const sheet = sheetOf(src);
  return sheet?.frames?.every((f) => f.name && Array.isArray(f.rect)) ? sheet.frames.map((f) => f.name) : null;
}

function manifestRects(src, names) {
  const sheet = sheetOf(src);
  if (!sheet?.frames) return null;
  const rects = names.map((n) => sheet.frames.find((f) => f.name === n || `${f.assetId}` === n)?.rect);
  return rects.every((r) => Array.isArray(r) && r.length === 4) ? rects.map(([x, y, w, h]) => ({ x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 })) : null;
}

/** 알파 연결 컴포넌트 → 큰 것 n개를 행 우선 정렬한 bbox 목록 */
function componentRects(data, W, H, n) {
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (label[i] !== -1 || data[i * 4 + 3] < COMP_ALPHA) continue;
    const id = comps.length;
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    let area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0;
    while (sp) {
      const j = stack[--sp];
      const x = j % W;
      const y = (j - x) / W;
      area++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) {
        if (k >= 0 && label[k] === -1 && data[k * 4 + 3] >= COMP_ALPHA) {
          label[k] = id;
          stack[sp++] = k;
        }
      }
    }
    comps.push({ area, x0, y0, x1, y1, cx: sx / area, cy: sy / area });
  }
  const big = comps.filter((c) => c.area > COMP_AREA).sort((a, b) => b.area - a.area).slice(0, n);
  if (big.length !== n) throw new Error(`큰 컴포넌트 ${big.length}개 (기대 ${n}개)`);
  // 작은 조각을 가까운 큰 컴포넌트(bbox 거리 24px 이내)에 합친다
  for (const c of comps) {
    if (c.area > COMP_AREA || c.area < 12) continue;
    let best = null;
    let bestD = 24;
    for (const b of big) {
      const dx = Math.max(b.x0 - c.x1, 0, c.x0 - b.x1);
      const dy = Math.max(b.y0 - c.y1, 0, c.y0 - b.y1);
      const d = Math.hypot(dx, dy);
      if (d < bestD) [best, bestD] = [b, d];
    }
    if (best) {
      best.x0 = Math.min(best.x0, c.x0);
      best.y0 = Math.min(best.y0, c.y0);
      best.x1 = Math.max(best.x1, c.x1);
      best.y1 = Math.max(best.y1, c.y1);
    }
  }
  // 행 우선: 중심 y 로 정렬해 4개씩 끊고, 각 행은 중심 x 로 정렬
  const byY = [...big].sort((a, b) => a.cy - b.cy);
  const ordered = [];
  for (let r = 0; r < byY.length; r += COLS) ordered.push(...byY.slice(r, r + COLS).sort((a, b) => a.cx - b.cx));
  return ordered.map((c) => ({ x0: Math.max(0, c.x0 - PAD), y0: Math.max(0, c.y0 - PAD), x1: Math.min(W - 1, c.x1 + PAD), y1: Math.min(H - 1, c.y1 + PAD) }));
}

/** v1: 균등 칸 안의 알파 bbox */
function gridRects(data, W, H, n) {
  const rects = [];
  for (let i = 0; i < n; i++) {
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    const x0 = Math.round((c * W) / COLS), x1 = Math.round(((c + 1) * W) / COLS);
    const y0 = Math.round((r * H) / COLS), y1 = Math.round(((r + 1) * H) / COLS);
    const rows = new Int32Array(y1 - y0);
    const cols = new Int32Array(x1 - x0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * W + x) * 4 + 3] >= ALPHA_MIN) { rows[y - y0]++; cols[x - x0]++; }
    const first = (a) => a.findIndex((v) => v >= LINE_MIN);
    const last = (a) => a.length - 1 - [...a].reverse().findIndex((v) => v >= LINE_MIN);
    rects.push({ x0: x0 + first(cols), x1: x0 + last(cols), y0: y0 + first(rows), y1: y0 + last(rows), cell: { x0, y0, x1: x1 - 1, y1: y1 - 1 } });
  }
  return rects;
}

/** 상체(위쪽 55%) 불투명 픽셀의 가로 무게중심: 걷기 프레임마다 다리 폭이 달라도 몸통이 흔들리지 않게 */
function torsoCenterX(data, W, b) {
  const yEnd = b.y0 + Math.round((b.y1 - b.y0) * 0.55);
  let sum = 0;
  let n = 0;
  for (let y = b.y0; y <= yEnd; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (data[(y * W + x) * 4 + 3] >= COMP_ALPHA) {
        sum += x;
        n++;
      }
    }
  }
  return n ? sum / n : (b.x0 + b.x1) / 2;
}

async function buildAtlas(job, src) {
  const { name, cell: CELL, uniform, slice } = job;
  const fromManifest = slice === "components" ? manifestNames(job.src) : null;
  const NAMES = fromManifest ?? job.names;
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  let rects;
  let how;
  try {
    if (slice === "components") {
      rects = manifestRects(job.src, NAMES);
      how = rects ? "manifest rect" : "연결 컴포넌트";
      rects ??= componentRects(data, W, H, NAMES.length);
    } else {
      rects = gridRects(data, W, H, NAMES.length);
      how = "균등 칸(v1)";
    }
  } catch (e) {
    console.log(`! ${name}: 자르기 실패 — ${e.message}`);
    return;
  }

  // 균일 모드(아바타): 같은 크기로, 가로 중앙·발(아래) 기준 정렬
  const maxW = Math.max(...rects.map((b) => b.x1 - b.x0 + 1));
  const maxH = Math.max(...rects.map((b) => b.y1 - b.y0 + 1));
  const frames = {};
  const composites = [];
  for (let i = 0; i < NAMES.length; i++) {
    const b = rects[i];
    const bw = uniform ? maxW : b.x1 - b.x0 + 1;
    const bh = uniform ? maxH : b.y1 - b.y0 + 1;
    const sx = uniform ? Math.round(torsoCenterX(data, W, b) - bw / 2) : b.x0;
    const sy = uniform ? b.y1 + 1 - bh : b.y0;
    const lim = b.cell ?? (slice === "components" && uniform ? b : null); // 다른 그림이 섞이지 않게
    const crop = Buffer.alloc(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const px = sx + x;
        const py = sy + y;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        if (lim && (px < lim.x0 || px > lim.x1 || py < lim.y0 || py > lim.y1)) continue;
        const s = (py * W + px) * 4;
        const a = data[s + 3];
        if (a < ALPHA_MIN) continue;
        const d = (y * bw + x) * 4;
        crop[d] = data[s];
        crop[d + 1] = data[s + 1];
        crop[d + 2] = data[s + 2];
        crop[d + 3] = a;
      }
    }
    const scale = Math.min(1, CELL / Math.max(bw, bh));
    const ow = Math.max(1, Math.round(bw * scale));
    const oh = Math.max(1, Math.round(bh * scale));
    const buf = await sharp(crop, { raw: { width: bw, height: bh, channels: 4 } }).resize(ow, oh, { kernel: "lanczos3" }).png().toBuffer();
    const px = (i % COLS) * CELL + Math.floor((CELL - ow) / 2);
    const py = Math.floor(i / COLS) * CELL + (CELL - oh); // 셀 바닥 정렬
    composites.push({ input: buf, left: px, top: py });
    frames[NAMES[i]] = { x: px, y: py, w: ow, h: oh, ax: 0.5, ay: 1 };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const rowsOut = Math.ceil(NAMES.length / COLS);
  const outPath = resolve(OUT_DIR, `${name}.webp`);
  await sharp({ create: { width: COLS * CELL, height: rowsOut * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .webp({ quality: 84, alphaQuality: 90, effort: 5 })
    .toFile(outPath);
  const meta = { image: `${name}.webp`, width: COLS * CELL, height: rowsOut * CELL, source: "codex", slicing: how, frames };
  writeFileSync(resolve(OUT_DIR, `${name}.json`), JSON.stringify(meta, null, 2) + "\n");
  console.log(`✓ ${name}.webp ${(statSync(outPath).size / 1024).toFixed(1)} KB, ${NAMES.length} frames (${how})`);
}
