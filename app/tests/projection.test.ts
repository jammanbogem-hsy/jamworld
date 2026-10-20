import { test } from "node:test";
import assert from "node:assert/strict";
import { isometric, screenInputToGrid, topDown, visibleCells } from "../lib/render/projection.ts";

for (const p of [topDown, isometric]) {
  test(`${p.id}: toScreen → toGround 왕복`, () => {
    for (const [x, y] of [[0, 0], [3.25, 7.5], [39, 29], [-2, 5]]) {
      const s = p.toScreen(x, y);
      const g = p.toGround(s.x, s.y);
      assert.ok(Math.abs(g.x - x) < 1e-9 && Math.abs(g.y - y) < 1e-9, `${p.id} ${x},${y} → ${g.x},${g.y}`);
    }
  });

  test(`${p.id}: groundMatrix 가 셀 꼭짓점과 일치`, () => {
    const [a, b, c, d] = p.groundMatrix;
    const corner = (u: number, v: number) => ({ x: a * u + c * v, y: b * u + d * v });
    for (const [u, v, cx, cy] of [[64, 0, 1, 0], [0, 64, 0, 1], [64, 64, 1, 1]]) {
      const m = corner(u, v);
      const s = p.toScreen(cx, cy);
      assert.ok(Math.abs(m.x - s.x) < 1e-9 && Math.abs(m.y - s.y) < 1e-9);
    }
  });

  test(`${p.id}: 보이는 셀 범위가 화면 모서리의 셀을 모두 포함`, () => {
    const r = visibleCells(p, -300, -200, 900, 700);
    for (const [sx, sy] of [[-300, -200], [900, -200], [-300, 700], [900, 700], [300, 250]]) {
      const g = p.toGround(sx, sy);
      assert.ok(g.x >= r.minX && g.x <= r.maxX && g.y >= r.minY && g.y <= r.maxY);
    }
  });
}

test("정렬: 앞쪽 오브젝트가 뒤쪽보다 나중에 그려진다", () => {
  // td: 남쪽 행이 앞
  assert.ok(topDown.depthKey(5, 3, 1, 1) < topDown.depthKey(5, 4, 1, 1));
  // 2칸 깊이 오브젝트의 앞 행 기준
  assert.ok(topDown.depthKey(0, 3, 1, 2) > topDown.depthKey(9, 3, 1, 1));
  // iso: 대각선 x+y 가 큰 쪽이 앞
  assert.ok(isometric.depthKey(2, 2, 1, 1) < isometric.depthKey(3, 2, 1, 1));
  assert.ok(isometric.depthKey(2, 2, 1, 1) < isometric.depthKey(2, 3, 1, 1));
  // 플레이어: 같은 셀 오브젝트 뒤(앞에 서 있음), 한 칸 앞 오브젝트보다 먼저
  for (const p of [topDown, isometric]) {
    const pd = p.playerDepth(4.5, 4.5);
    assert.ok(pd > p.depthKey(4, 4, 1, 1), p.id);
    assert.ok(pd < p.depthKey(4, 5, 1, 1), p.id);
  }
});

test("iso 입력: 화면 위 키는 격자 (−,−), 오른쪽 키는 격자 (+,−)", () => {
  const up = screenInputToGrid("iso", 0, -1);
  assert.ok(up.x < 0 && up.y < 0);
  const right = screenInputToGrid("iso", 1, 0);
  assert.ok(right.x > 0 && right.y < 0);
  // 화면 위로 움직이면 화면 y 가 감소
  const s0 = isometric.toScreen(5, 5);
  const s1 = isometric.toScreen(5 + up.x * 0.1, 5 + up.y * 0.1);
  assert.ok(s1.y < s0.y && Math.abs(s1.x - s0.x) < 1e-9);
  assert.deepEqual(screenInputToGrid("td", 1, -1), { x: 1, y: -1 });
});
