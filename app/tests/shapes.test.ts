import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, footprintOf } from "../lib/world/catalog.ts";
import { AVATAR_COLORS, drawAssetShape, drawAssetShapeIso, drawAvatar, drawTileUnit, rr } from "../lib/render/shapes.ts";
import type { Rot } from "../lib/world/types.ts";

/** 브라우저처럼 음수 반경·비정상 숫자에서 throw 하는 가짜 2D 컨텍스트 */
function strictCtx() {
  const calls = { roundRect: 0, ellipse: 0, arc: 0 };
  const finite = (name: string, args: unknown[]) => {
    for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) throw new Error(`${name}: 비정상 숫자 ${a}`);
  };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "measureText") return () => ({ width: 10 });
        if (prop === "roundRect")
          return (...a: number[]) => {
            finite("roundRect", a);
            const radii = Array.isArray(a[4]) ? a[4] : [a[4] ?? 0];
            if (radii.some((r) => r < 0)) throw new RangeError(`Radius value ${radii} is negative`);
            calls.roundRect++;
          };
        if (prop === "ellipse")
          return (...a: number[]) => {
            finite("ellipse", a);
            if (a[2] < 0 || a[3] < 0) throw new RangeError(`ellipse radius negative ${a[2]},${a[3]}`);
            calls.ellipse++;
          };
        if (prop === "arc")
          return (...a: number[]) => {
            finite("arc", a);
            if (a[2] < 0) throw new RangeError(`arc radius negative ${a[2]}`);
            calls.arc++;
          };
        return (...a: unknown[]) => finite(prop, a);
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test("전체 카탈로그 도형(탑뷰·아이소)을 모든 회전으로 그려도 음수 반경/비정상 값이 없다", () => {
  const { ctx, calls } = strictCtx();
  for (const a of CATALOG) {
    for (const rot of [0, 90, 180, 270] as Rot[]) {
      const fp = footprintOf(a, rot);
      if (a.kind === "tile") {
        drawTileUnit(ctx, a, 3, 4, { n: rot === 90, w: rot === 180 }, "td");
        drawTileUnit(ctx, a, 4, 4, { n: true, w: true }, "iso");
      } else {
        drawAssetShape(ctx, a, fp.w, fp.d);
        drawAssetShapeIso(ctx, a, fp.w, fp.d);
      }
    }
  }
  for (let d = 0; d < 4; d++) for (const t of [0, 0.3, 1.7]) drawAvatar(ctx, AVATAR_COLORS[0], d, t, true);
  assert.ok(calls.roundRect > 50 && calls.ellipse > 50);
});

test("rr: 음수 크기·과대 반경을 정규화", () => {
  const { ctx } = strictCtx();
  rr(ctx, 0, 0, -10, 5, 8);
  rr(ctx, 0, 0, 4, -20, 30);
  rr(ctx, 0, 0, 0, 0, 6);
});
