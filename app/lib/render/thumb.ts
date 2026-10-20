// 에셋 패널 썸네일. 현재 시점의 아틀라스 그림, 없으면 같은 시점의 도형 fallback
import { footprintOf, getAsset } from "../world/catalog";
import { resolveSprite } from "./atlas";
import { projectionFor, type ViewMode } from "./projection";
import { drawAssetShape, drawAssetShapeIso, drawTileUnit } from "./shapes";

export function drawAssetThumb(canvas: HTMLCanvasElement, assetId: string, view: ViewMode) {
  const a = getAsset(assetId);
  const cssW = 64;
  const cssH = 56;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx || !a) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const proj = projectionFor(view);
  if (a.kind === "tile") {
    // 한 칸을 그 시점 투영 그대로 (2×2 칸으로 체커·무늬가 보이게)
    const [ma, mb, mc, md] = proj.groundMatrix;
    const xs = [proj.toScreen(0, 0), proj.toScreen(2, 0), proj.toScreen(0, 2), proj.toScreen(2, 2)];
    const gx0 = Math.min(...xs.map((p) => p.x));
    const gx1 = Math.max(...xs.map((p) => p.x));
    const gy1 = Math.max(...xs.map((p) => p.y));
    const s = Math.min((cssW - 8) / (gx1 - gx0), (cssH - 8) / gy1);
    const ox = (cssW - (gx1 - gx0) * s) / 2 - gx0 * s;
    const oy = (cssH - gy1 * s) / 2;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const o = proj.toScreen(x, y);
        ctx.save();
        ctx.beginPath();
        const pts = [proj.toScreen(x, y), proj.toScreen(x + 1, y), proj.toScreen(x + 1, y + 1), proj.toScreen(x, y + 1)];
        pts.forEach((p, i) => (i ? ctx.lineTo(ox + p.x * s, oy + p.y * s) : ctx.moveTo(ox + p.x * s, oy + p.y * s)));
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(dpr * s * ma, dpr * s * mb, dpr * s * mc, dpr * s * md, dpr * (ox + o.x * s), dpr * (oy + o.y * s));
        const tex = a.render.texture ? resolveSprite(a.render.texture) : null;
        drawTileUnit(ctx, a, x, y, { n: false, w: false }, view, tex ? { image: tex.atlas.image, ...tex.frame } : null);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
    return;
  }
  const v = view === "iso" ? a.render.iso : a.render.td;
  for (const cand of v.sprites) {
    const sprite = (a.orients === 2 && resolveSprite(`${cand.ref}@a`)) || resolveSprite(cand.ref);
    if (!sprite) continue;
    const f = sprite.frame;
    const s = Math.min((cssW - 6) / f.w, (cssH - 4) / f.h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sprite.atlas.image, f.x, f.y, f.w, f.h, (cssW - f.w * s) / 2, cssH - 2 - f.h * s, f.w * s, f.h * s);
    return;
  }
  const fp = footprintOf(a, 0);
  const fb = proj.footprintBox(fp.w, fp.d, a.height);
  const w = fb.x1 - fb.x0 + 28;
  const h = fb.y1 - fb.y0 + 30;
  const s = Math.min(cssW / w, cssH / h);
  ctx.translate(cssW / 2 - ((fb.x0 + fb.x1) / 2) * s, cssH - 3 - (fb.y1 + 4) * s);
  ctx.scale(s, s);
  if (view === "iso") drawAssetShapeIso(ctx, a, fp.w, fp.d);
  else drawAssetShape(ctx, a, fp.w, fp.d);
}
