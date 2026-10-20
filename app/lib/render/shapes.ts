// 도형 기반 입체 fallback. 원점 = footprint 의 왼쪽 위 바닥 모서리, 단위 px(줌 1).
import type { AssetDef } from "../world/types.ts";
import { HU, OUTLINE, SHADOW, TD, TW } from "./constants.ts";
import { UNIT } from "./projection.ts";

type C = CanvasRenderingContext2D;

/** 둥근 사각형. 음수 크기는 뒤집어 정규화하고 반경은 0 이상으로 제한 (roundRect 는 음수 반경에서 throw) */
export function rr(ctx: C, x: number, y: number, w: number, h: number, r: number) {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function fillStroke(ctx: C, fill: string, stroke = OUTLINE, lw = 2) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function ellipse(ctx: C, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
}

export function drawShadow(ctx: C, w: number, d: number, scale = 1) {
  ctx.fillStyle = SHADOW;
  ellipse(ctx, w / 2, d * 0.62, (w / 2) * 0.9 * scale, (d / 2) * 0.62 * scale);
  ctx.fill();
}

/** 상자형: 윗면 + 앞면 */
function box(ctx: C, x: number, y: number, w: number, d: number, h: number, top: string, side: string, r = 8) {
  rr(ctx, x, y + d - h, w, h, r * 0.6);
  fillStroke(ctx, side);
  rr(ctx, x, y - h, w, d, r);
  fillStroke(ctx, top);
  // 윗면 하이라이트
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  rr(ctx, x + 4, y - h + 3, w - 8, Math.max(3, d * 0.22), r * 0.5);
  ctx.fill();
}

function cylinder(ctx: C, cx: number, cy: number, rx: number, ry: number, h: number, top: string, side: string) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, cy - h);
  ctx.ellipse(cx, cy - h, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  fillStroke(ctx, side);
  ellipse(ctx, cx, cy - h, rx, ry);
  fillStroke(ctx, top);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ellipse(ctx, cx - rx * 0.25, cy - h - ry * 0.25, rx * 0.45, ry * 0.35);
  ctx.fill();
}

function blob(ctx: C, cx: number, cy: number, r: number, fill: string) {
  ellipse(ctx, cx, cy, r, r * 0.9);
  fillStroke(ctx, fill);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ellipse(ctx, cx - r * 0.3, cy - r * 0.35, r * 0.4, r * 0.28);
  ctx.fill();
}

export function drawAssetShape(ctx: C, a: AssetDef, fpw: number, fpd: number) {
  const w = fpw * TW;
  const d = fpd * TD;
  const H = a.height * HU;
  const { top, side, accent } = a.colors;
  switch (a.shape) {
    case "box":
      drawShadow(ctx, w, d, 1.05);
      box(ctx, 2, 2, w - 4, d - 4, H, top, side);
      if (accent) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(8, d - H + 6);
        ctx.lineTo(w - 8, d - 6);
        ctx.stroke();
      }
      break;
    case "desk":
      drawShadow(ctx, w, d);
      ctx.fillStyle = side;
      ctx.fillRect(10, d * 0.5 - H * 0.6, 5, H * 0.75);
      ctx.fillRect(w - 15, d * 0.5 - H * 0.6, 5, H * 0.75);
      box(ctx, 4, 4, w - 8, d - 14, H * 0.25, top, side, 6);
      break;
    case "chair":
      drawShadow(ctx, w, d, 0.7);
      box(ctx, w * 0.25, d * 0.3, w * 0.5, d * 0.45, H * 0.6, top, side, 5);
      box(ctx, w * 0.25, d * 0.18, w * 0.5, 7, H * 1.3, top, side, 3);
      break;
    case "bench":
      drawShadow(ctx, w, d);
      box(ctx, 4, d * 0.25, w - 8, d * 0.45, H * 0.8, top, side, 6);
      box(ctx, 4, d * 0.12, w - 8, 8, H * 1.7, top, side, 3);
      break;
    case "cyl":
      drawShadow(ctx, w, d);
      cylinder(ctx, w / 2, d * 0.55, w * 0.42, d * 0.38, H, top, side);
      break;
    case "tree": {
      drawShadow(ctx, w, d, 1.2);
      ctx.fillStyle = accent ?? "#8a5a2b";
      rr(ctx, w / 2 - 7, d * 0.55 - H * 0.45, 14, H * 0.45, 5);
      fillStroke(ctx, accent ?? "#8a5a2b");
      blob(ctx, w / 2 - 14, d * 0.5 - H * 0.55, w * 0.3, side);
      blob(ctx, w / 2 + 14, d * 0.5 - H * 0.55, w * 0.3, side);
      blob(ctx, w / 2, d * 0.5 - H * 0.78, w * 0.36, top);
      break;
    }
    case "pine": {
      drawShadow(ctx, w, d, 1.1);
      ctx.fillStyle = accent ?? "#7a4d2b";
      ctx.fillRect(w / 2 - 6, d * 0.55 - H * 0.25, 12, H * 0.25);
      for (let i = 0; i < 3; i++) {
        const yb = d * 0.55 - H * (0.18 + i * 0.25);
        const half = w * (0.42 - i * 0.1);
        ctx.beginPath();
        ctx.moveTo(w / 2 - half, yb);
        ctx.lineTo(w / 2, yb - H * 0.4);
        ctx.lineTo(w / 2 + half, yb);
        ctx.closePath();
        fillStroke(ctx, i % 2 ? top : side);
      }
      break;
    }
    case "bush":
      drawShadow(ctx, w, d, 0.9);
      blob(ctx, w * 0.32, d * 0.55 - H * 0.35, w * 0.24, side);
      blob(ctx, w * 0.68, d * 0.55 - H * 0.35, w * 0.24, side);
      blob(ctx, w * 0.5, d * 0.5 - H * 0.6, w * 0.28, top);
      break;
    case "rock":
      drawShadow(ctx, w, d, 0.9);
      ctx.beginPath();
      ctx.moveTo(w * 0.12, d * 0.7);
      ctx.lineTo(w * 0.22, d * 0.5 - H * 0.9);
      ctx.lineTo(w * 0.6, d * 0.4 - H);
      ctx.lineTo(w * 0.88, d * 0.55 - H * 0.6);
      ctx.lineTo(w * 0.85, d * 0.75);
      ctx.closePath();
      fillStroke(ctx, side);
      ctx.beginPath();
      ctx.moveTo(w * 0.22, d * 0.5 - H * 0.9);
      ctx.lineTo(w * 0.6, d * 0.4 - H);
      ctx.lineTo(w * 0.88, d * 0.55 - H * 0.6);
      ctx.lineTo(w * 0.5, d * 0.6 - H * 0.55);
      ctx.closePath();
      fillStroke(ctx, top, OUTLINE, 1.5);
      break;
    case "flower":
      for (const [fx, fy] of [[0.3, 0.4], [0.62, 0.32], [0.48, 0.66], [0.75, 0.7], [0.22, 0.75]]) {
        ctx.fillStyle = accent ?? "#5fd06a";
        ellipse(ctx, w * fx, d * fy + 3, 7, 4);
        ctx.fill();
        blob(ctx, w * fx, d * fy - H * 0.6, 6, top);
        ctx.fillStyle = side;
        ellipse(ctx, w * fx, d * fy - H * 0.6, 2.5, 2.5);
        ctx.fill();
      }
      break;
    case "fence":
      drawShadow(ctx, w, d, 0.6);
      for (const px of [6, w - 14]) box(ctx, px, d * 0.4, 8, 8, H, top, side, 3);
      box(ctx, 2, d * 0.45, w - 4, 4, H * 0.75, top, side, 2);
      box(ctx, 2, d * 0.45, w - 4, 4, H * 0.4, top, side, 2);
      break;
    case "lamp":
      drawShadow(ctx, w, d, 0.5);
      box(ctx, w / 2 - 4, d * 0.45, 8, 6, H * 0.9, side, side, 3);
      blob(ctx, w / 2, d * 0.45 - H, 10, top);
      break;
    case "sign":
      drawShadow(ctx, w, d, 0.6);
      box(ctx, w / 2 - 4, d * 0.5, 8, 6, H * 0.8, side, side, 3);
      rr(ctx, 6, d * 0.5 - H, w - 12, H * 0.5, 6);
      fillStroke(ctx, top);
      ctx.fillStyle = accent ?? "#2b3a67";
      for (let i = 0; i < 2; i++) ctx.fillRect(14, d * 0.5 - H + 8 + i * 7, w - 28 - i * 10, 3);
      break;
    case "board": {
      drawShadow(ctx, w, d, 0.8);
      ctx.fillStyle = side;
      ctx.fillRect(10, d * 0.6 - H * 0.35, 5, H * 0.35);
      ctx.fillRect(w - 15, d * 0.6 - H * 0.35, 5, H * 0.35);
      rr(ctx, 4, d * 0.6 - H, w - 8, H * 0.7, 6);
      fillStroke(ctx, side);
      rr(ctx, 9, d * 0.6 - H + 5, w - 18, H * 0.7 - 10, 4);
      fillStroke(ctx, top, "rgba(0,0,0,0.2)", 1);
      if (a.interaction === "quiz") {
        ctx.fillStyle = accent ?? "#fff";
        ctx.font = `bold ${Math.round(H * 0.38)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", w / 2, d * 0.6 - H * 0.65);
      } else {
        ctx.strokeStyle = accent ?? "#fff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(16, d * 0.6 - H * 0.8);
        ctx.lineTo(w * 0.5, d * 0.6 - H * 0.8);
        ctx.moveTo(16, d * 0.6 - H * 0.62);
        ctx.lineTo(w * 0.7, d * 0.6 - H * 0.62);
        ctx.stroke();
      }
      break;
    }
    case "portal":
      ellipse(ctx, w / 2, d * 0.55, w * 0.42, d * 0.36);
      fillStroke(ctx, side, top, 4);
      ellipse(ctx, w / 2, d * 0.55, w * 0.26, d * 0.2);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fill();
      break;
    case "house": {
      drawShadow(ctx, w, d, 1.05);
      box(ctx, 4, d * 0.25, w - 8, d * 0.7, H * 0.55, side, side, 6);
      // 지붕
      const ry = d * 0.25 - H * 0.55;
      ctx.beginPath();
      ctx.moveTo(-2, ry + d * 0.75);
      ctx.lineTo(w * 0.15, ry - H * 0.45);
      ctx.lineTo(w * 0.85, ry - H * 0.45);
      ctx.lineTo(w + 2, ry + d * 0.75);
      ctx.closePath();
      fillStroke(ctx, top);
      ctx.fillStyle = accent ?? "#2b3a67";
      rr(ctx, w / 2 - 10, d * 0.95 - 30, 20, 28, 5);
      ctx.fill();
      break;
    }
    case "flag":
      drawShadow(ctx, w, d, 0.5);
      box(ctx, w / 2 - 3, d * 0.5, 6, 5, H, "#8a5a2b", "#8a5a2b", 2);
      ctx.beginPath();
      ctx.moveTo(w / 2 + 3, d * 0.5 - H);
      ctx.lineTo(w / 2 + 30, d * 0.5 - H + 10);
      ctx.lineTo(w / 2 + 3, d * 0.5 - H + 22);
      ctx.closePath();
      fillStroke(ctx, top);
      break;
    case "shelf":
      drawShadow(ctx, w, d);
      box(ctx, 4, d * 0.3, w - 8, d * 0.5, H, side, side, 4);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = [accent ?? "#ff6f61", "#19c2b5", "#ffd166"][i];
        ctx.fillRect(10 + i * 14, d * 0.8 - H * 0.75, 10, H * 0.25);
        ctx.fillRect(10 + i * 14, d * 0.8 - H * 0.4, 10, H * 0.25);
      }
      break;
    case "flat":
    default:
      rr(ctx, 4, 4, w - 8, d - 8, 6);
      fillStroke(ctx, top);
  }
}

/**
 * 바닥 타일 1칸을 64×64 단위 정사각형(UNIT)에 그린다. 호출자가 시점별 groundMatrix 로 투영하므로
 * 두 시점에서 같은 색·같은 무늬가 정확히 투영된다. 셀 테두리선·잔점 없이 큰 면 위주로 칠한다.
 * edges.n / edges.w: 북쪽·서쪽 이웃 타일이 다를 때(물가 둑 등). 서쪽 둑은 아이소에서만 보인다.
 */
export function drawTileUnit(
  ctx: C,
  a: AssetDef | undefined,
  cx: number,
  cy: number,
  edges: { n: boolean; w: boolean },
  view: "td" | "iso",
  texture?: { image: CanvasImageSource; x: number; y: number; w: number; h: number } | null,
) {
  const U = UNIT;
  if (texture) {
    // 공방 바닥 텍스처: 단위 정사각형에 그대로 → 시점 행렬로 두 시점에 같은 무늬 (이음선 방지로 1단위 넓게)
    ctx.drawImage(texture.image, texture.x, texture.y, texture.w, texture.h, -1, -1, U + 2, U + 2);
    if ((cx + cy) & 1) {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, U, U);
    }
    return;
  }
  const top = a?.colors.top ?? "#6fd34a";
  const side = a?.colors.side ?? "#4cae3a";
  const id = a?.id ?? "";
  // 이음선 방지를 위해 1단위 넓게 칠한다
  ctx.fillStyle = top;
  ctx.fillRect(-1, -1, U + 2, U + 2);
  // 체커 명암 (아주 옅게)
  if ((cx + cy) & 1) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(0, 0, U, U);
  }
  const h = ((cx * 73856093) ^ (cy * 19349663)) >>> 0;
  if (id.includes("grass")) {
    // 세 칸에 하나꼴로 작은 풀 한 포기
    if (h % 3 === 0) {
      ctx.fillStyle = side;
      const bx = 14 + (h >> 4) % 34;
      const by = 18 + (h >> 9) % 30;
      ctx.beginPath();
      ctx.moveTo(bx, by + 8);
      ctx.lineTo(bx + 3, by);
      ctx.lineTo(bx + 6, by + 8);
      ctx.lineTo(bx + 9, by + 2);
      ctx.lineTo(bx + 12, by + 8);
      ctx.closePath();
      ctx.fill();
    }
  } else if (id.includes("wood")) {
    ctx.fillStyle = "rgba(120,60,20,0.22)";
    ctx.fillRect(0, U / 3 - 1.5, U, 3);
    ctx.fillRect(0, (2 * U) / 3 - 1.5, U, 3);
  } else if (id.includes("stone")) {
    // 큰 판석 하나: 안쪽을 밝게
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    rr(ctx, 5, 5, U - 10, U - 10, 10);
    ctx.fill();
  } else if (id.includes("carpet") || id.includes("coral")) {
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 4;
    rr(ctx, 8, 8, U - 16, U - 16, 8);
    ctx.stroke();
  } else if (id.includes("sand") || id.includes("dirt")) {
    if (h % 2 === 0) {
      ctx.fillStyle = side;
      ctx.globalAlpha = 0.45;
      ellipse(ctx, 16 + (h >> 5) % 32, 18 + (h >> 11) % 28, 4, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else if (id.includes("water")) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    const ox = (h % 18) - 9;
    ctx.beginPath();
    ctx.moveTo(18 + ox, 34);
    ctx.quadraticCurveTo(26 + ox, 27, 34 + ox, 34);
    ctx.quadraticCurveTo(42 + ox, 41, 50 + ox, 34);
    ctx.stroke();
    // 물가 둑: 시점에서 보이는 먼 쪽 가장자리만
    ctx.fillStyle = "#c98a4a";
    if (edges.n) ctx.fillRect(-1, -1, U + 2, 10);
    if (edges.w && view === "iso") ctx.fillRect(-1, -1, 10, U + 2);
    ctx.fillStyle = "rgba(10,40,90,0.18)";
    if (edges.n) ctx.fillRect(edges.w && view === "iso" ? 9 : 0, 9, U, 6);
    if (edges.w && view === "iso") ctx.fillRect(9, 9, 6, U);
  }
}

// ---------- 아이소메트릭 도형 fallback ----------
// 원점 = footprint 의 북쪽 꼭짓점(셀 (0,0) 모서리). P(u,v,z) = ((u−v)·64, (u+v)·32 − z·40)

const IW = 64;
const IH = 32;
const P = (u: number, v: number, z = 0): [number, number] => [(u - v) * IW, (u + v) * IH - z * HU];

function poly(ctx: C, pts: Array<[number, number]>) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** 아이소 직육면체: u0..u1 × v0..v1, 높이 z0..z1 */
function isoPrism(ctx: C, u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, top: string, side: string) {
  poly(ctx, [P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v1, z1)]); // 남쪽 면(왼쪽 아래, 밝게)
  fillStroke(ctx, side);
  poly(ctx, [P(u1, v0, z0), P(u1, v1, z0), P(u1, v1, z1), P(u1, v0, z1)]); // 동쪽 면(오른쪽 아래, 어둡게)
  fillStroke(ctx, side.startsWith("#") ? shade(side, 0.78) : side);
  poly(ctx, [P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)]); // 윗면
  fillStroke(ctx, top);
}

function isoShadow(ctx: C, fw: number, fd: number, k = 1) {
  const [cx, cy] = P(fw / 2, fd / 2);
  ctx.fillStyle = SHADOW;
  ellipse(ctx, cx, cy, ((fw + fd) / 2) * IW * 0.62 * k, ((fw + fd) / 2) * IH * 0.62 * k);
  ctx.fill();
}

export function drawAssetShapeIso(ctx: C, a: AssetDef, fw: number, fd: number) {
  const H = a.height;
  const { top, side, accent } = a.colors;
  const long = fw >= fd ? "u" : "v";
  const m = 0.08;
  switch (a.shape) {
    case "box":
      isoShadow(ctx, fw, fd);
      isoPrism(ctx, m, m, fw - m, fd - m, 0, H, top, side);
      break;
    case "desk":
      isoShadow(ctx, fw, fd);
      isoPrism(ctx, 0.15, 0.15, 0.25, 0.25, 0, H * 0.8, side, side);
      isoPrism(ctx, fw - 0.25, fd - 0.25, fw - 0.15, fd - 0.15, 0, H * 0.8, side, side);
      isoPrism(ctx, 0.1, 0.1, fw - 0.1, fd - 0.1, H * 0.8, H, top, side);
      break;
    case "chair":
      isoShadow(ctx, fw, fd, 0.7);
      isoPrism(ctx, 0.25, 0.25, fw - 0.25, fd - 0.25, 0, H * 0.6, top, side);
      if (long === "u") isoPrism(ctx, 0.25, 0.25, fw - 0.25, 0.38, H * 0.6, H * 1.5, top, side);
      else isoPrism(ctx, 0.25, 0.25, 0.38, fd - 0.25, H * 0.6, H * 1.5, top, side);
      break;
    case "bench":
      isoShadow(ctx, fw, fd);
      isoPrism(ctx, 0.12, 0.12, fw - 0.12, fd - 0.12, 0, H * 0.75, top, side);
      if (long === "u") isoPrism(ctx, 0.12, 0.12, fw - 0.12, 0.26, H * 0.75, H * 1.8, top, side);
      else isoPrism(ctx, 0.12, 0.12, 0.26, fd - 0.12, H * 0.75, H * 1.8, top, side);
      break;
    case "shelf":
      isoShadow(ctx, fw, fd);
      if (long === "u") isoPrism(ctx, 0.08, 0.2, fw - 0.08, fd - 0.35, 0, H, side, side);
      else isoPrism(ctx, 0.2, 0.08, fw - 0.35, fd - 0.08, 0, H, side, side);
      for (let i = 0; i < 3; i++) {
        const z = H * (0.18 + i * 0.27);
        const col = [accent ?? "#ff6f61", "#19c2b5", "#ffd166"][i];
        if (long === "u") isoPrism(ctx, 0.2, fd - 0.36, fw - 0.2, fd - 0.3, z, z + H * 0.18, col, col);
        else isoPrism(ctx, fw - 0.36, 0.2, fw - 0.3, fd - 0.2, z, z + H * 0.18, col, col);
      }
      break;
    case "board": {
      isoShadow(ctx, fw, fd, 0.8);
      // 얇은 판: 긴 변 방향으로 세운다
      const t = 0.14;
      if (long === "u") {
        isoPrism(ctx, 0.15, fd / 2 - 0.05, 0.25, fd / 2 + 0.05, 0, H * 0.35, side, side);
        isoPrism(ctx, fw - 0.25, fd / 2 - 0.05, fw - 0.15, fd / 2 + 0.05, 0, H * 0.35, side, side);
        isoPrism(ctx, 0.05, fd / 2 - t / 2, fw - 0.05, fd / 2 + t / 2, H * 0.3, H, side, side);
        poly(ctx, [P(0.12, fd / 2 + t / 2, H * 0.38), P(fw - 0.12, fd / 2 + t / 2, H * 0.38), P(fw - 0.12, fd / 2 + t / 2, H * 0.92), P(0.12, fd / 2 + t / 2, H * 0.92)]);
      } else {
        isoPrism(ctx, fw / 2 - 0.05, 0.15, fw / 2 + 0.05, 0.25, 0, H * 0.35, side, side);
        isoPrism(ctx, fw / 2 - 0.05, fd - 0.25, fw / 2 + 0.05, fd - 0.15, 0, H * 0.35, side, side);
        isoPrism(ctx, fw / 2 - t / 2, 0.05, fw / 2 + t / 2, fd - 0.05, H * 0.3, H, side, side);
        poly(ctx, [P(fw / 2 + t / 2, 0.12, H * 0.38), P(fw / 2 + t / 2, fd - 0.12, H * 0.38), P(fw / 2 + t / 2, fd - 0.12, H * 0.92), P(fw / 2 + t / 2, 0.12, H * 0.92)]);
      }
      ctx.fillStyle = top;
      ctx.fill();
      if (a.interaction === "quiz") {
        const [qx, qy] = P(fw / 2 + (long === "u" ? 0 : 0.1), fd / 2 + (long === "u" ? 0.1 : 0), H * 0.65);
        ctx.fillStyle = accent ?? "#fff";
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", qx, qy);
      }
      break;
    }
    case "sign":
      isoShadow(ctx, fw, fd, 0.6);
      isoPrism(ctx, fw / 2 - 0.06, fd / 2 - 0.06, fw / 2 + 0.06, fd / 2 + 0.06, 0, H * 0.85, side, side);
      if (long === "u") isoPrism(ctx, 0.12, fd / 2 - 0.05, fw - 0.12, fd / 2 + 0.05, H * 0.5, H, top, side);
      else isoPrism(ctx, fw / 2 - 0.05, 0.12, fw / 2 + 0.05, fd - 0.12, H * 0.5, H, top, side);
      break;
    case "fence":
      isoShadow(ctx, fw, fd, 0.6);
      if (long === "u") {
        for (const u of [0.1, fw - 0.2]) isoPrism(ctx, u, fd / 2 - 0.05, u + 0.1, fd / 2 + 0.05, 0, H, top, side);
        isoPrism(ctx, 0.02, fd / 2 - 0.03, fw - 0.02, fd / 2 + 0.03, H * 0.6, H * 0.8, top, side);
        isoPrism(ctx, 0.02, fd / 2 - 0.03, fw - 0.02, fd / 2 + 0.03, H * 0.25, H * 0.45, top, side);
      } else {
        for (const v of [0.1, fd - 0.2]) isoPrism(ctx, fw / 2 - 0.05, v, fw / 2 + 0.05, v + 0.1, 0, H, top, side);
        isoPrism(ctx, fw / 2 - 0.03, 0.02, fw / 2 + 0.03, fd - 0.02, H * 0.6, H * 0.8, top, side);
        isoPrism(ctx, fw / 2 - 0.03, 0.02, fw / 2 + 0.03, fd - 0.02, H * 0.25, H * 0.45, top, side);
      }
      break;
    case "house": {
      isoShadow(ctx, fw, fd, 1.05);
      isoPrism(ctx, 0.1, 0.1, fw - 0.1, fd - 0.1, 0, H * 0.55, side, side);
      // 박공지붕: 긴 변을 따라 용마루
      const z0 = H * 0.55;
      const z1 = H;
      if (long === "u") {
        poly(ctx, [P(0, fd / 2, z1), P(fw, fd / 2, z1), P(fw, fd + 0.05, z0), P(0, fd + 0.05, z0)]);
        fillStroke(ctx, top);
        poly(ctx, [P(fw, -0.05, z0), P(fw, fd / 2, z1), P(fw, fd + 0.05, z0)]);
        fillStroke(ctx, shade(top, 0.8));
      } else {
        poly(ctx, [P(fw / 2, 0, z1), P(fw / 2, fd, z1), P(fw + 0.05, fd, z0), P(fw + 0.05, 0, z0)]);
        fillStroke(ctx, shade(top, 0.85));
        poly(ctx, [P(-0.05, fd, z0), P(fw / 2, fd, z1), P(fw + 0.05, fd, z0)]);
        fillStroke(ctx, top);
      }
      ctx.fillStyle = accent ?? "#2b3a67";
      const du = long === "u" ? fw / 2 : fw * 0.4;
      poly(ctx, [P(du - 0.2, fd - 0.1, 0), P(du + 0.2, fd - 0.1, 0), P(du + 0.2, fd - 0.1, 0.7), P(du - 0.2, fd - 0.1, 0.7)]);
      ctx.fill();
      break;
    }
    case "cyl": {
      isoShadow(ctx, fw, fd);
      const [cx, cy] = P(fw / 2, fd / 2);
      const r = Math.min(fw, fd) * 0.42 * Math.SQRT2;
      cylinder(ctx, cx, cy, r * IW * 0.72, r * IH * 0.72, H * HU, top, side);
      break;
    }
    case "flat":
      poly(ctx, [P(0.1, 0.1), P(fw - 0.1, 0.1), P(fw - 0.1, fd - 0.1), P(0.1, fd - 0.1)]);
      fillStroke(ctx, top);
      break;
    default: {
      // 세로형(나무·덤불·바위·꽃·가로등·깃발·포털): 탑뷰 도형을 footprint 바닥 중심에 맞춰 그린다
      const [cx, cy] = P(fw / 2, fd / 2);
      const w = fw * 64;
      const d = fd * 48;
      ctx.save();
      ctx.translate(cx - w / 2, cy - d * 0.55);
      drawAssetShape(ctx, a, fw, fd);
      ctx.restore();
    }
  }
}

export interface AvatarStyle {
  body: string;
  accent: string;
  skin: string;
}

export const AVATAR_COLORS: AvatarStyle[] = [
  { body: "#19c2b5", accent: "#ff6f61", skin: "#ffd9b8" },
  { body: "#ff6f61", accent: "#2b3a67", skin: "#f6c9a0" },
  { body: "#ffd166", accent: "#2b3a67", skin: "#ffe0c2" },
  { body: "#7c6cff", accent: "#19c2b5", skin: "#e8b48f" },
];

/** 아바타. 원점 = 발 중앙. dir: 0 아래, 1 왼쪽, 2 위, 3 오른쪽 */
export function drawAvatar(ctx: C, style: AvatarStyle, dir: number, t: number, moving: boolean) {
  const bob = moving ? Math.abs(Math.sin(t * 12)) * 4 : Math.sin(t * 2) * 1;
  ctx.fillStyle = SHADOW;
  ellipse(ctx, 0, 0, 16, 7);
  ctx.fill();
  // 다리
  const step = moving ? Math.sin(t * 12) * 4 : 0;
  ctx.fillStyle = "#2b3a67";
  rr(ctx, -9, -12 + step * 0.3, 7, 12, 3);
  ctx.fill();
  rr(ctx, 2, -12 - step * 0.3, 7, 12, 3);
  ctx.fill();
  // 몸
  rr(ctx, -14, -38 - bob, 28, 28, 10);
  fillStroke(ctx, style.body);
  ctx.fillStyle = style.accent;
  rr(ctx, -14, -24 - bob, 28, 6, 3);
  ctx.fill();
  // 머리
  ellipse(ctx, 0, -50 - bob, 17, 16);
  fillStroke(ctx, style.skin);
  // 머리카락/모자
  ctx.beginPath();
  ctx.ellipse(0, -55 - bob, 18, 12, 0, Math.PI, 0);
  ctx.closePath();
  fillStroke(ctx, style.accent);
  if (dir !== 2) {
    const ex = dir === 1 ? -5 : dir === 3 ? 5 : 0;
    ctx.fillStyle = "#1b2440";
    ellipse(ctx, ex - 6, -47 - bob, 2.6, 3.4);
    ctx.fill();
    ellipse(ctx, ex + 6, -47 - bob, 2.6, 3.4);
    ctx.fill();
  }
}
