import { test } from "node:test";
import assert from "node:assert/strict";
import { createMap } from "../lib/world/map.ts";
import { applyOps } from "../lib/world/ops.ts";
import { PlayWorld } from "../lib/world/play.ts";
import { sampleForestPlaza } from "../lib/world/samples.ts";

test("벽을 통과하지 못하고 벽을 따라 미끄러진다", () => {
  const doc = applyOps(createMap("m", "t", 12, 12), [
    { op: "setSpawn", x: 2, y: 5 },
    { op: "line", assetId: "wall.stone", x1: 4, y1: 0, x2: 4, y2: 11 },
  ]).doc;
  const w = new PlayWorld(doc);
  let p = w.spawnState();
  for (let i = 0; i < 120; i++) p = w.step(p, 1, 0, 1 / 30);
  assert.ok(p.x < 4 - 0.29, `x=${p.x}`);
  const before = p.y;
  for (let i = 0; i < 20; i++) p = w.step(p, 1, 1, 1 / 30);
  assert.ok(p.y > before, "대각선 입력에서 세로로 미끄러져야 함");
  assert.ok(p.x < 4);
});

test("큰 dt 에서도 벽을 뚫지 않는다", () => {
  const doc = applyOps(createMap("m", "t", 12, 12), [
    { op: "setSpawn", x: 2, y: 5 },
    { op: "line", assetId: "wall.stone", x1: 4, y1: 0, x2: 4, y2: 11 },
  ]).doc;
  const w = new PlayWorld(doc);
  const p = w.step(w.spawnState(), 1, 0, 2);
  assert.ok(p.x < 4);
});

test("맵 밖으로 나갈 수 없다", () => {
  const w = new PlayWorld(createMap("m", "t", 10, 10));
  let p = w.spawnState();
  for (let i = 0; i < 300; i++) p = w.step(p, 0, 1, 1 / 30);
  assert.ok(p.y <= 10 - 0.29);
});

test("샘플 맵 포털은 짝 포털 옆으로 이동시키고, 안내판은 근처에서 감지된다", () => {
  const doc = sampleForestPlaza();
  const w = new PlayWorld(doc);
  const portal = doc.interactions.find((i) => i.type === "portal")!;
  const on = { x: portal.x + 0.5, y: portal.y + 0.5, dir: 0, moving: false };
  const hit = w.portalAt(on);
  assert.ok(hit && hit.type === "portal" && hit.targetId);
  const exit = w.portalExit(hit.type === "portal" ? hit.targetId! : "")!;
  assert.ok(exit);
  assert.equal(w.collides(exit.x, exit.y), false);
  const sign = doc.interactions.find((i) => i.type === "sign")!;
  const near = w.nearby({ x: sign.x + 0.5, y: sign.y + 1.5, dir: 2, moving: false });
  assert.equal(near?.id, sign.id);
});

test("ISSUE-002: 오답 뒤 재도전 정답은 1회 가산, 이미 맞힌 문제는 중복 가산 없음", async () => {
  const { emptyScore, recordAnswer } = await import("../lib/world/quiz.ts");
  let s = emptyScore();
  s = recordAnswer(s, "q1", false); // 소금(오답)
  assert.equal(s.correct.size, 0);
  s = recordAnswer(s, "q1", true); // 재도전 햇빛(정답)
  assert.equal(s.correct.size, 1);
  s = recordAnswer(s, "q1", true); // 다시 열어 또 정답
  s = recordAnswer(s, "q1", false); // 이후 오답도 점수 유지
  assert.equal(s.correct.size, 1);
  s = recordAnswer(s, "q2", true);
  assert.equal(s.correct.size, 2);
  assert.equal(s.attempts, 5);
});
