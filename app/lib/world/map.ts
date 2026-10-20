import { footprintOf, getAsset } from "./catalog.ts";
import { SCHEMA_VERSION, type MapDoc, type PlacedObject } from "./types.ts";

export function createMap(id: string, name: string, width = 40, height = 30, baseTile = "tile.grass"): MapDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    width,
    height,
    terrainPalette: [baseTile],
    terrain: new Array(width * height).fill(0),
    objects: [],
    zones: [],
    interactions: [],
    spawn: { x: Math.floor(width / 2), y: height - 3 },
    nextId: 1,
  };
}

export function cloneMap(doc: MapDoc): MapDoc {
  return {
    ...doc,
    terrainPalette: [...doc.terrainPalette],
    terrain: doc.terrain.slice(),
    objects: doc.objects.map((o) => ({ ...o })),
    zones: doc.zones.map((z) => ({ ...z })),
    interactions: doc.interactions.map((i) => (i.type === "quiz" ? { ...i, choices: [...i.choices] } : { ...i })),
    spawn: { ...doc.spawn },
  };
}

export function inBounds(doc: MapDoc, x: number, y: number) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < doc.width && y < doc.height;
}

export function tileAt(doc: MapDoc, x: number, y: number): string {
  return doc.terrainPalette[doc.terrain[y * doc.width + x]] ?? doc.terrainPalette[0];
}

export function setTile(doc: MapDoc, x: number, y: number, tileId: string) {
  let idx = doc.terrainPalette.indexOf(tileId);
  if (idx < 0) {
    doc.terrainPalette.push(tileId);
    idx = doc.terrainPalette.length - 1;
  }
  doc.terrain[y * doc.width + x] = idx;
}

export function objectFootprint(o: PlacedObject) {
  const a = getAsset(o.assetId);
  return a ? footprintOf(a, o.rot, o.scale ?? 1) : { w: 1, d: 1 };
}

export function objectCells(o: PlacedObject): Array<[number, number]> {
  const a = getAsset(o.assetId);
  if (!a) return [[o.x, o.y]];
  const fp = footprintOf(a, o.rot, o.scale ?? 1);
  const cells: Array<[number, number]> = [];
  for (let dy = 0; dy < fp.d; dy++) for (let dx = 0; dx < fp.w; dx++) cells.push([o.x + dx, o.y + dy]);
  return cells;
}

/** 셀 → 그 셀을 점유한 오브젝트 인덱스(+1). 0 은 빈칸 */
export function occupancy(doc: MapDoc): Int32Array {
  const occ = new Int32Array(doc.width * doc.height);
  doc.objects.forEach((o, i) => {
    for (const [x, y] of objectCells(o)) if (inBounds(doc, x, y)) occ[y * doc.width + x] = i + 1;
  });
  return occ;
}

/** 이동 불가 셀: 막는 오브젝트 + 걸을 수 없는 타일 */
export function blockedGrid(doc: MapDoc): Uint8Array {
  const g = new Uint8Array(doc.width * doc.height);
  for (let i = 0; i < g.length; i++) {
    const t = getAsset(doc.terrainPalette[doc.terrain[i]]);
    if (t && t.walkable === false) g[i] = 1;
  }
  for (const o of doc.objects) {
    const a = getAsset(o.assetId);
    if (!a || !a.blocking) continue;
    for (const [x, y] of objectCells(o)) if (inBounds(doc, x, y)) g[y * doc.width + x] = 1;
  }
  return g;
}

/** 시작점에서 4방향으로 갈 수 있는 셀 */
export function reachableFrom(doc: MapDoc, blocked: Uint8Array, sx: number, sy: number): Uint8Array {
  const { width: w, height: h } = doc;
  const seen = new Uint8Array(w * h);
  if (!inBounds(doc, sx, sy) || blocked[sy * w + sx]) return seen;
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = sy * w + sx;
  seen[sy * w + sx] = 1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i - x) / w;
    const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of n) {
      if (j >= 0 && !seen[j] && !blocked[j]) {
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return seen;
}

export function cellOrNeighborReachable(doc: MapDoc, reach: Uint8Array, x: number, y: number) {
  const w = doc.width;
  const pts: Array<[number, number]> = [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
  return pts.some(([px, py]) => inBounds(doc, px, py) && reach[py * w + px] === 1);
}
