import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, getAsset } from "../lib/world/catalog.ts";
import { blockedGrid, createMap, reachableFrom } from "../lib/world/map.ts";
import { applyOps } from "../lib/world/ops.ts";
import { History } from "../lib/world/history.ts";
import { sampleForestPlaza, sampleSchool } from "../lib/world/samples.ts";
import { validateMap } from "../lib/world/validate.ts";
import { parseMapJson, serializeMap } from "../lib/world/io.ts";

test("카탈로그: id 유일, v1 16종, 두 시점 v2 프레임 36개, 시점 간 재사용 없음", () => {
  const ids = CATALOG.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(CATALOG.filter((a) => a.render.td.sprites.some((s) => s.ref.startsWith("props:"))).length, 16);
  const objects = CATALOG.filter((a) => a.kind === "object");
  assert.equal(objects.length, 27);
  // 모든 오브젝트가 두 시점 v2 프레임을 가지며, 아이소는 탑뷰(v1 포함) 그림을 절대 쓰지 않는다
  for (const a of objects) {
    assert.ok(a.render.td.sprites[0]?.ref.startsWith("td-"), a.id);
    assert.ok(a.render.iso.sprites.length === 1 && a.render.iso.sprites[0].ref.startsWith("iso-"), a.id);
  }
  // 방향 2 에셋 9종 → 시점당 프레임 27 + 9 = 36
  assert.equal(objects.filter((a) => a.orients === 2).length, 9);
  assert.equal(objects.reduce((n, a) => n + a.orients, 0), 36);
  // 자연물은 회전해도 뒤집지 않는 대칭 에셋
  assert.ok(CATALOG.filter((a) => a.category === "nature").every((a) => a.orients === 1));
});

test("샘플 맵은 검증을 통과하고 모든 구역에 도달할 수 있다", () => {
  for (const doc of [sampleForestPlaza(), sampleSchool()]) {
    const v = validateMap(doc, { strict: true });
    assert.deepEqual(v.errors, [], `${doc.name}: ${JSON.stringify(v.errors)}`);
  }
});

test("없는 에셋을 쓰면 실패하고 원본은 그대로다", () => {
  const doc = createMap("m", "t", 20, 20);
  const r = applyOps(doc, [
    { op: "place", assetId: "nature.tree", x: 1, y: 1 },
    { op: "place", assetId: "dragon.statue", x: 2, y: 2 },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.doc, doc);
  assert.equal(doc.objects.length, 0);
  assert.match(r.errors[0].message, /카탈로그에 없는 에셋/);
});

test("경계 밖·겹침 배치는 거부된다", () => {
  const doc = createMap("m", "t", 20, 20);
  assert.equal(applyOps(doc, [{ op: "place", assetId: "furn.blackboard", x: 19, y: 0 }]).ok, false);
  const r = applyOps(doc, [
    { op: "place", assetId: "deco.crate", x: 3, y: 3 },
    { op: "place", assetId: "nature.rock", x: 3, y: 3 },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /이미/);
});

test("시작 위치를 막으면 검증 오류", () => {
  const doc = createMap("m", "t", 20, 20);
  const r = applyOps(doc, [{ op: "place", assetId: "deco.crate", x: doc.spawn.x, y: doc.spawn.y }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === "spawn"));
});

test("문 없는 방 안 구역은 strict 모드에서 도달 불가로 거부된다", () => {
  const doc = createMap("m", "t", 20, 20);
  const walled = applyOps(doc, [
    { op: "line", assetId: "wall.stone", x1: 2, y1: 2, x2: 8, y2: 2 },
    { op: "line", assetId: "wall.stone", x1: 2, y1: 8, x2: 8, y2: 8 },
    { op: "line", assetId: "wall.stone", x1: 2, y1: 3, x2: 2, y2: 7 },
    { op: "line", assetId: "wall.stone", x1: 8, y1: 3, x2: 8, y2: 7 },
    { op: "zone", name: "갇힌 방", x: 3, y: 3, w: 5, h: 5 },
  ], { strict: true });
  assert.equal(walled.ok, false);
  assert.ok(walled.errors.some((e) => e.code === "reach"));
  // 비엄격 모드(수동 편집)는 경고만
  const loose = applyOps(doc, [
    { op: "line", assetId: "wall.stone", x1: 2, y1: 2, x2: 8, y2: 2 },
    { op: "line", assetId: "wall.stone", x1: 2, y1: 8, x2: 8, y2: 8 },
    { op: "line", assetId: "wall.stone", x1: 2, y1: 3, x2: 2, y2: 7 },
    { op: "line", assetId: "wall.stone", x1: 8, y1: 3, x2: 8, y2: 7 },
    { op: "zone", name: "갇힌 방", x: 3, y: 3, w: 5, h: 5 },
  ]);
  assert.equal(loose.ok, true);
  assert.ok(loose.warnings.some((e) => e.code === "reach"));
});

test("room 은 문 틈을 남기고 구역을 만든다, 다시 지으면 넓힐 수 있다", () => {
  const doc = createMap("m", "t", 30, 24);
  const r = applyOps(doc, [{ op: "room", name: "교실 1", x: 4, y: 4, w: 8, h: 6, doors: [{ side: "S", width: 2 }] }], { strict: true });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const z = r.doc.zones.find((q) => q.name === "교실 1")!;
  assert.deepEqual([z.x, z.y, z.w, z.h], [5, 5, 6, 4]);
  const reach = reachableFrom(r.doc, blockedGrid(r.doc), r.doc.spawn.x, r.doc.spawn.y);
  assert.equal(reach[6 * 30 + 6], 1);
  const wider = applyOps(r.doc, [
    { op: "clearRect", x: 4, y: 4, w: 8, h: 6 },
    { op: "room", name: "교실 1", x: 4, y: 4, w: 11, h: 6, doors: [{ side: "N" }] },
  ], { strict: true });
  assert.ok(wider.ok, JSON.stringify(wider.errors));
  assert.equal(wider.doc.zones.length, 1);
  assert.equal(wider.doc.zones[0].w, 9);
});

test("포털 쌍은 서로 연결되고, 한쪽을 지우면 짝도 정리된다", () => {
  const doc = createMap("m", "t", 20, 20);
  const r = applyOps(doc, [{ op: "portalPair", a: { x: 2, y: 2 }, b: { x: 15, y: 15 } }]);
  assert.ok(r.ok);
  const [a, b] = r.doc.interactions;
  assert.equal(a.type === "portal" && a.targetId, b.id);
  const portalObj = r.doc.objects.find((o) => o.x === 2 && o.y === 2)!;
  const r2 = applyOps(r.doc, [{ op: "remove", id: portalObj.id }]);
  assert.ok(r2.ok, JSON.stringify(r2.errors));
  assert.equal(r2.doc.interactions.length, 0);
});

test("퀴즈 정답 범위 검증", () => {
  const doc = createMap("m", "t", 20, 20);
  assert.equal(applyOps(doc, [{ op: "quiz", x: 3, y: 3, question: "?", choices: ["a", "b"], answer: 2 }]).ok, false);
});

test("undo/redo 가 수동·에이전트 변경 모두 같은 스냅샷으로 동작", () => {
  const h = new History();
  let doc = createMap("m", "t", 20, 20);
  const s0 = doc;
  const r1 = applyOps(doc, [{ op: "place", assetId: "deco.crate", x: 1, y: 1 }]);
  h.record(doc, "수동 배치");
  doc = r1.doc;
  const r2 = applyOps(doc, [{ op: "room", name: "방", x: 5, y: 5, w: 6, h: 6 }], { strict: true });
  h.record(doc, "에이전트");
  doc = r2.doc;
  doc = h.undo(doc)!.doc;
  assert.equal(doc, r1.doc);
  doc = h.undo(doc)!.doc;
  assert.equal(doc, s0);
  doc = h.redo(doc)!.doc;
  doc = h.redo(doc)!.doc;
  assert.equal(doc, r2.doc);
  assert.equal(h.canRedo, false);
});

test("JSON 내보내기/가져오기 왕복이 보존되고 잘못된 JSON 은 거부된다", () => {
  const doc = sampleSchool();
  const back = parseMapJson(serializeMap(doc));
  assert.ok(back.ok);
  assert.deepEqual(back.ok && back.doc, doc);
  assert.equal(parseMapJson("{not json").ok, false);
  const bad = JSON.parse(serializeMap(doc));
  bad.objects[0].assetId = "nope";
  assert.equal(parseMapJson(JSON.stringify(bad)).ok, false);
});

test("물 타일은 이동 불가", () => {
  const doc = createMap("m", "t", 10, 10);
  const r = applyOps(doc, [{ op: "paint", tileId: "tile.water", x: 0, y: 0, w: 2, h: 2 }]);
  assert.equal(blockedGrid(r.doc)[0], 1);
  assert.equal(getAsset("tile.water")?.walkable, false);
});

test("가져오기: null 오브젝트·보기 없는 퀴즈·소수/NaN 좌표·잘못된 spawn 을 오류로 거부(throw 없음)", () => {
  const base = JSON.parse(serializeMap(sampleSchool()));
  const cases: Array<[string, (m: Record<string, any>) => void]> = [
    ["null object", (m) => m.objects.push(null)],
    ["quiz without choices", (m) => m.interactions.push({ id: "q", type: "quiz", x: 1, y: 1, question: "?", answer: 0 })],
    ["fraction x", (m) => (m.objects[0].x = 1.5)],
    ["NaN-like y", (m) => (m.objects[0].y = "NaN")],
    ["null spawn", (m) => (m.spawn = null)],
    ["spawn string", (m) => (m.spawn = { x: "3", y: 4 })],
    ["null zone", (m) => m.zones.push(null)],
    ["bad rot", (m) => (m.objects[0].rot = 45)],
    ["terrain short", (m) => m.terrain.pop()],
    ["too many objects", (m) => (m.objects = new Array(20_001).fill(m.objects[0]))],
  ];
  for (const [name, mutate] of cases) {
    const m = structuredClone(base);
    mutate(m);
    const r = parseMapJson(JSON.stringify(m));
    assert.equal(r.ok, false, name);
  }
  assert.equal(parseMapJson("x".repeat(2_000_001)).ok, false);
});

test("모델 출력의 null 필드 작업은 throw 없이 실패하고 원본 보존", () => {
  const doc = createMap("m", "t", 20, 20);
  for (const ops of [
    [null],
    [{ op: "room", x: 2, y: 2, w: 6, h: 6, doors: [null] }],
    [{ op: "quiz", x: 2, y: 2, question: "?", choices: null, answer: 0 }],
    [{ op: "portalPair", a: null, b: { x: 1, y: 1 } }],
    [{ op: "place", assetId: null, x: 1, y: 1 }],
    [{ op: "place", assetId: "deco.crate", x: 1.7, y: Number.NaN }],
  ]) {
    const r = applyOps(doc, ops);
    assert.equal(r.ok, false, JSON.stringify(ops));
    assert.equal(r.doc, doc);
  }
});

test("History 는 byte 예산을 넘으면 오래된 단계부터 버린다", () => {
  const big = createMap("m", "t", 200, 200);
  const h = new History(80, 2 * 1024 * 1024);
  for (let i = 0; i < 20; i++) h.record(big, `s${i}`);
  assert.ok(h.totalBytes <= 2 * 1024 * 1024, String(h.totalBytes));
  assert.ok(h.past.length >= 1 && h.past.length < 20);
});
