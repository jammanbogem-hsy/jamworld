// 시점별 투영. 논리 격자(셀 x 동+, y 남+, z 높이 단위)는 하나이고 화면 표현만 바뀐다.
// 바닥은 아핀 변환이므로 타일을 64×64 단위 정사각형에 그린 뒤 groundMatrix 로 정확히 투영한다.

export type ViewMode = "td" | "iso";

export const HU = 40; // 높이 1단위(px, 줌 1) — 두 시점 공통
export const UNIT = 64; // 바닥 타일 원본 정사각형 한 변

export interface Projection {
  readonly id: ViewMode;
  /** 셀 좌표 → 월드 px (카메라 적용 전, 줌 1) */
  toScreen(x: number, y: number, z?: number): { x: number; y: number };
  /** 월드 px → 바닥(z=0) 셀 좌표 */
  toGround(px: number, py: number): { x: number; y: number };
  /** 64×64 단위 정사각형 → 셀 1칸 바닥 모양 (ctx.transform 인자 a,b,c,d) */
  readonly groundMatrix: [number, number, number, number];
  /** 오브젝트 정렬 키: 작을수록 먼저(뒤쪽) */
  depthKey(x: number, y: number, w: number, d: number): number;
  /** 플레이어(셀 실수 좌표) 정렬 키 */
  playerDepth(px: number, py: number): number;
  /** footprint w×d 의 화면 상자 (원점 = 셀 (0,0) 모서리, 높이 h 단위 포함) */
  footprintBox(w: number, d: number, h: number): { x0: number; y0: number; x1: number; y1: number };
  /** 맵 전체 화면 상자 (높은 오브젝트·절벽 여유 포함) */
  mapBox(width: number, height: number): { x0: number; y0: number; x1: number; y1: number };
}

export const TD_TILE = { w: 64, d: 48 };
export const ISO_TILE = { w: 128, h: 64 };
const SKIRT = 22;

export const topDown: Projection = {
  id: "td",
  toScreen: (x, y, z = 0) => ({ x: x * TD_TILE.w, y: y * TD_TILE.d - z * HU }),
  toGround: (px, py) => ({ x: px / TD_TILE.w, y: py / TD_TILE.d }),
  groundMatrix: [TD_TILE.w / UNIT, 0, 0, TD_TILE.d / UNIT],
  // 앞(남쪽) 행이 같으면 x 순
  depthKey: (x, y, w, d) => (y + d - 1) * 4096 + x,
  playerDepth: (px, py) => Math.floor(py - 0.01) * 4096 + 4095.5,
  footprintBox: (w, d, h) => ({ x0: 0, y0: -h * HU, x1: w * TD_TILE.w, y1: d * TD_TILE.d }),
  mapBox: (width, height) => ({ x0: 0, y0: -1.5 * HU, x1: width * TD_TILE.w, y1: height * TD_TILE.d + SKIRT }),
};

const HW = ISO_TILE.w / 2; // 64
const HH = ISO_TILE.h / 2; // 32

export const isometric: Projection = {
  id: "iso",
  toScreen: (x, y, z = 0) => ({ x: (x - y) * HW, y: (x + y) * HH - z * HU }),
  toGround: (px, py) => ({ x: px / ISO_TILE.w + py / ISO_TILE.h, y: py / ISO_TILE.h - px / ISO_TILE.w }),
  groundMatrix: [HW / UNIT, HH / UNIT, -HW / UNIT, HH / UNIT],
  // 앞 대각선(x+w−1 + y+d−1)이 같으면 y 순
  depthKey: (x, y, w, d) => (x + w - 1 + y + d - 1) * 4096 + (y + d - 1),
  playerDepth: (px, py) => (Math.floor(px) + Math.floor(py)) * 4096 + 4095.5,
  footprintBox: (w, d, h) => ({ x0: -d * HW, y0: -h * HU, x1: w * HW, y1: (w + d) * HH }),
  mapBox: (width, height) => ({ x0: -height * HW, y0: -1.5 * HU, x1: width * HW, y1: (width + height) * HH + SKIRT }),
};

export function projectionFor(mode: ViewMode): Projection {
  return mode === "iso" ? isometric : topDown;
}

/** 화면 사각형(월드 px)에 보이는 셀 범위. 네 모서리를 역투영해 감싼다 */
export function visibleCells(p: Projection, x0: number, y0: number, x1: number, y1: number) {
  const pts = [p.toGround(x0, y0), p.toGround(x1, y0), p.toGround(x0, y1), p.toGround(x1, y1)];
  return {
    minX: Math.floor(Math.min(...pts.map((q) => q.x))),
    maxX: Math.ceil(Math.max(...pts.map((q) => q.x))),
    minY: Math.floor(Math.min(...pts.map((q) => q.y))),
    maxY: Math.ceil(Math.max(...pts.map((q) => q.y))),
  };
}

/** 화면 기준 입력(오른쪽 +x, 아래 +y) → 격자 이동 벡터 */
export function screenInputToGrid(mode: ViewMode, ix: number, iy: number) {
  if (mode === "td") return { x: ix, y: iy };
  // iso 역투영의 선형 부분 (화면 위 = 격자 (−1,−1) 방향)
  return { x: ix * 0.5 + iy, y: iy - ix * 0.5 };
}
