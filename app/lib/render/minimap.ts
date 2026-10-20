// 카드 썸네일용 위에서 본 미니맵 (셀당 사각형 1개, 가볍게)
import { getAsset } from "../world/catalog";
import type { MapDoc } from "../world/types";

export function drawMiniMap(canvas: HTMLCanvasElement, doc: MapDoc) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cw = canvas.width / doc.width;
  const ch = canvas.height / doc.height;
  const colors = doc.terrainPalette.map((t) => getAsset(t)?.colors.top ?? "#7fd35b");
  for (let y = 0; y < doc.height; y++) {
    for (let x = 0; x < doc.width; x++) {
      ctx.fillStyle = colors[doc.terrain[y * doc.width + x]];
      ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
    }
  }
  for (const o of doc.objects) {
    const a = getAsset(o.assetId);
    if (!a) continue;
    const w = o.rot === 90 || o.rot === 270 ? a.footprint.d : a.footprint.w;
    const d = o.rot === 90 || o.rot === 270 ? a.footprint.w : a.footprint.d;
    ctx.fillStyle = a.colors.side;
    ctx.fillRect(o.x * cw + 1, o.y * ch + 1, w * cw - 2, d * ch - 2);
  }
  ctx.fillStyle = "#ff6f61";
  ctx.beginPath();
  ctx.arc((doc.spawn.x + 0.5) * cw, (doc.spawn.y + 0.5) * ch, Math.max(2.5, cw * 0.7), 0, Math.PI * 2);
  ctx.fill();
}
