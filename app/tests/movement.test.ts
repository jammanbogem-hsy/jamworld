import { test } from "node:test";
import assert from "node:assert/strict";
import { isometric } from "../lib/render/projection.ts";
import { createMap } from "../lib/world/map.ts";
import { DIR8, ISO_SCREEN_SPEED, moveIso, screenDir8, walkFrame } from "../lib/world/movement.ts";
import { applyOps } from "../lib/world/ops.ts";
import { PlayWorld, type PlayerState } from "../lib/world/play.ts";

const open = () => new PlayWorld(createMap("m", "t", 60, 60));
const start = (): PlayerState => ({ x: 30.5, y: 30.5, dir: 0, moving: false });

function screenTravel(ix: number, iy: number, secs = 1) {
  const w = open();
  let p = start();
  for (let i = 0; i < secs * 30; i++) p = moveIso(w, p, ix, iy, 1 / 30);
  const a = isometric.toScreen(30.5, 30.5);
  const b = isometric.toScreen(p.x, p.y);
  return { dx: b.x - a.x, dy: b.y - a.y, p };
}

test("iso: 상하좌우·대각 모두 화면 속도가 같다 (격자 정규화로 수평이 2배 빠르던 문제)", () => {
  for (const [ix, iy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
    const { dx, dy } = screenTravel(ix, iy);
    const sp = Math.hypot(dx, dy);
    assert.ok(Math.abs(sp - ISO_SCREEN_SPEED) < 1, `${ix},${iy}: ${sp}`);
    // 화면에서 입력 방향으로 곧게 움직인다
    const cross = dx * iy - dy * ix;
    assert.ok(Math.abs(cross) < 1e-6 * ISO_SCREEN_SPEED, `${ix},${iy} 방향 어긋남`);
  }
});

test("iso: 화면 기준 8방향 표시 (오른쪽=동, 위=북, 오른쪽 아래=남동)", () => {
  const face = (ix: number, iy: number) => DIR8[screenTravel(ix, iy, 0.2).p.face8!];
  assert.equal(face(1, 0), "e");
  assert.equal(face(-1, 0), "w");
  assert.equal(face(0, -1), "n");
  assert.equal(face(0, 1), "s");
  assert.equal(face(1, 1), "se");
  assert.equal(face(-1, -1), "nw");
  assert.equal(screenDir8(1, -1), 5);
});

test("iso: 걷기 위상은 실제 이동 거리 기준, 벽에 막히면 대기 프레임", () => {
  const { p } = screenTravel(1, 0, 0.5);
  assert.ok(p.moving && walkFrame(p) > 0);
  assert.ok((p.walk ?? 0) > ISO_SCREEN_SPEED * 0.45);
  // 정면이 막힌 벽: 화면 오른쪽(격자 +x,−y) 방향을 막는다
  const doc = applyOps(createMap("m", "t", 20, 20), [
    { op: "setSpawn", x: 2, y: 2 },
    { op: "line", assetId: "wall.stone", x1: 6, y1: 0, x2: 6, y2: 19 },
    { op: "line", assetId: "wall.stone", x1: 0, y1: 4, x2: 5, y2: 4 },
  ]).doc;
  const w = new PlayWorld(doc);
  let q: PlayerState = { x: 5.65, y: 4.35 - 1, dir: 0, moving: false };
  // 구석(동쪽 벽·남쪽 벽)으로 계속 밀면 멈추고 대기
  for (let i = 0; i < 60; i++) q = moveIso(w, q, 1, 1, 1 / 30);
  assert.equal(q.moving, false);
  assert.equal(walkFrame(q), 0);
  assert.equal(DIR8[q.face8!], "se");
});

test("탑뷰 이동은 그대로(격자 정규화 4.2셀/초, 4방향)", () => {
  const w = open();
  let p = start();
  for (let i = 0; i < 30; i++) p = w.step(p, 1, 0, 1 / 30);
  assert.ok(Math.abs(p.x - 30.5 - 4.2) < 1e-6 && p.dir === 3);
});
