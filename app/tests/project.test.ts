import { test } from "node:test";
import assert from "node:assert/strict";
import { History } from "../lib/world/history.ts";
import { parseMapJson, serializeMap } from "../lib/world/io.ts";
import { createMap, objectCells } from "../lib/world/map.ts";
import { applyOps } from "../lib/world/ops.ts";
import { PlayWorld } from "../lib/world/play.ts";
import {
  addPage,
  cleanupOrphanPortals,
  deletePage,
  duplicatePage,
  incomingPortals,
  linkPortals,
  movePage,
  projectDiffBytes,
  renamePage,
  validateProject,
  type ProjectState,
} from "../lib/world/project.ts";
import { validateMap } from "../lib/world/validate.ts";

function twoPages(): ProjectState {
  const a = createMap("A", "페이지 1", 20, 16);
  const b = createMap("B", "페이지 2", 20, 16);
  return { order: ["A", "B"], docs: { A: a, B: b } };
}

test("페이지 간 포털: 두 맵에 양방향 한 쌍이 한 번에 생기고 각 맵 검증 통과", () => {
  const ps = twoPages();
  const r = linkPortals(ps, { mapId: "A", x: 3, y: 3 }, { mapId: "B", x: 10, y: 5 }, "포털", ["pa", "pb"]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const pa = r.ps.docs.A.interactions.find((i) => i.id === "pa");
  const pb = r.ps.docs.B.interactions.find((i) => i.id === "pb");
  assert.deepEqual(pa && pa.type === "portal" && [pa.targetMapId, pa.targetId], ["B", "pb"]);
  assert.deepEqual(pb && pb.type === "portal" && [pb.targetMapId, pb.targetId], ["A", "pa"]);
  assert.equal(r.ps.docs.A.objects.filter((o) => o.assetId === "act.portal").length, 1);
  assert.deepEqual(validateMap(r.ps.docs.A, { strict: true }).errors, []);
  assert.deepEqual(validateMap(r.ps.docs.B, { strict: true }).errors, []);
  assert.deepEqual(validateProject(r.ps), []);
  // 원본 상태는 그대로
  assert.equal(ps.docs.A.interactions.length, 0);
});

test("페이지 간 포털: 한쪽이 막히면 둘 다 바뀌지 않는다(원자성)", () => {
  const ps = twoPages();
  const blocked = applyOps(ps.docs.B, [{ op: "place", assetId: "deco.crate", x: 10, y: 5 }]);
  const ps2: ProjectState = { ...ps, docs: { ...ps.docs, B: blocked.doc } };
  const r = linkPortals(ps2, { mapId: "A", x: 3, y: 3 }, { mapId: "B", x: 10, y: 5 });
  assert.equal(r.ok, false);
  assert.equal(ps2.docs.A.interactions.length, 0);
});

test("같은 페이지 두 지점은 portalPair 로 연결", () => {
  const r = linkPortals(twoPages(), { mapId: "A", x: 2, y: 2 }, { mapId: "A", x: 12, y: 9 });
  assert.ok(r.ok && r.ps.docs.A.interactions.length === 2);
  assert.equal(linkPortals(twoPages(), { mapId: "A", x: 2, y: 2 }, { mapId: "A", x: 2, y: 2 }).ok, false);
});

test("도착 포털을 지우면 다른 페이지의 짝 포털(오브젝트 포함)도 정리 — 고아 포털 없음", () => {
  const r = linkPortals(twoPages(), { mapId: "A", x: 3, y: 3 }, { mapId: "B", x: 10, y: 5 }, "포털", ["pa", "pb"]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const objB = r.ps.docs.B.objects.find((o) => o.assetId === "act.portal")!;
  const rb = applyOps(r.ps.docs.B, [{ op: "remove", id: objB.id }]);
  const cleaned = cleanupOrphanPortals({ ...r.ps, docs: { ...r.ps.docs, B: rb.doc } });
  assert.equal(cleaned.docs.A.interactions.length, 0);
  assert.equal(cleaned.docs.A.objects.filter((o) => o.assetId === "act.portal").length, 0);
  assert.deepEqual(validateProject(cleaned), []);
});

test("페이지 삭제·이름 변경·순서·복제", () => {
  const r = linkPortals(twoPages(), { mapId: "A", x: 3, y: 3 }, { mapId: "B", x: 10, y: 5 }, "포털", ["pa", "pb"]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(incomingPortals(r.ps, "B"), 1);
  const del = deletePage(r.ps, "B");
  assert.ok(del.ok && del.ps.order.join() === "A" && del.ps.docs.A.interactions.length === 0);
  assert.equal(deletePage(del.ok ? del.ps : r.ps, "A").ok, false, "마지막 페이지는 삭제 불가");
  const rn = renamePage(r.ps, "A", "  운동장  ");
  assert.ok(rn.ok && rn.ps.docs.A.name === "운동장");
  assert.equal(renamePage(r.ps, "A", "  ").ok, false);
  assert.deepEqual(movePage(r.ps, "B", -1).order, ["B", "A"]);
  assert.equal(movePage(r.ps, "A", -1), r.ps);
  const dup = duplicatePage(r.ps, "A", "C");
  assert.ok(dup.ok && dup.ps.order.join() === "A,C,B");
  if (dup.ok) assert.deepEqual(validateProject(dup.ps), []);
  const added = addPage(r.ps, createMap("D", "새 페이지", 20, 16), 0);
  assert.deepEqual(added.order, ["D", "A", "B"]);
});

test("프로젝트 undo/redo: 두 맵을 바꾼 포털 연결을 한 단계로 되돌린다, 바뀐 맵만 메모리 계산", () => {
  const ps0 = twoPages();
  const h = new History<ProjectState>(80, 12 * 1024 * 1024, projectDiffBytes);
  const r = linkPortals(ps0, { mapId: "A", x: 3, y: 3 }, { mapId: "B", x: 10, y: 5 });
  assert.ok(r.ok);
  if (!r.ok) return;
  h.record(ps0, "페이지 간 포털", r.ps, "A");
  let cur = r.ps;
  cur = h.undo(cur)!.doc;
  assert.equal(cur, ps0);
  cur = h.redo(cur)!.doc;
  assert.equal(cur, r.ps);
  // 바뀌지 않은 맵은 참조 공유 → 비용 0
  const onlyA = { ...ps0, docs: { ...ps0.docs, A: applyOps(ps0.docs.A, [{ op: "place", assetId: "deco.crate", x: 1, y: 1 }]).doc } };
  assert.ok(projectDiffBytes(ps0, onlyA) < projectDiffBytes(ps0, { order: ps0.order, docs: { A: createMap("A", "x", 20, 16), B: createMap("B", "y", 20, 16) } }));
});

test("배율: 점유 칸 = ceil(기본×배율), 충돌·겹침·경계에 반영, 저장 왕복", () => {
  const doc = createMap("m", "t", 20, 16);
  const r = applyOps(doc, [{ op: "place", assetId: "nature.tree", x: 2, y: 2, scale: 2 }]);
  assert.ok(r.ok);
  const tree = r.doc.objects[0];
  assert.equal(tree.scale, 2);
  assert.equal(objectCells(tree).length, 4);
  // 2×2 로 커진 나무 칸에 상자를 놓을 수 없다
  assert.equal(applyOps(r.doc, [{ op: "place", assetId: "deco.crate", x: 3, y: 3 }]).ok, false);
  // 이동 시 커진 크기로 경계 검사
  assert.equal(applyOps(r.doc, [{ op: "move", id: tree.id, x: 19, y: 2 }]).ok, false);
  // 축소: 최소 1칸, 기본 1 이면 필드 제거
  const s1 = applyOps(r.doc, [{ op: "scale", id: tree.id, scale: 0.5 }]);
  assert.ok(s1.ok && objectCells(s1.doc.objects[0]).length === 1);
  const s2 = applyOps(r.doc, [{ op: "scale", id: tree.id, scale: 1 }]);
  assert.ok(s2.ok && s2.doc.objects[0].scale === undefined);
  // 범위 밖
  assert.equal(applyOps(doc, [{ op: "place", assetId: "deco.crate", x: 1, y: 1, scale: 3.5 }]).ok, false);
  assert.equal(applyOps(r.doc, [{ op: "scale", id: tree.id, scale: 0.2 }]).ok, false);
  // 이동 충돌 반영
  const w = new PlayWorld(r.doc);
  assert.ok(w.isBlocked(3, 3));
  // 저장 왕복 + 잘못된 배율 거부
  const back = parseMapJson(serializeMap(r.doc));
  assert.ok(back.ok && back.doc.objects[0].scale === 2);
  const bad = JSON.parse(serializeMap(r.doc));
  bad.objects[0].scale = 9;
  assert.equal(parseMapJson(JSON.stringify(bad)).ok, false);
  // 올림 정책: 1.25배 1칸 → 2칸(그림이 점유 칸을 넘지 않음), 0.5배 → 1칸
  const s3 = applyOps(r.doc, [{ op: "scale", id: tree.id, scale: 1.25 }]);
  assert.ok(s3.ok && objectCells(s3.doc.objects[0]).length === 4);
  // 상호작용 오브젝트는 1배 고정 (밟는 칸·거리 판정 일치)
  const pr = applyOps(doc, [{ op: "portalPair", a: { x: 1, y: 1 }, b: { x: 8, y: 8 } }]);
  const portalObj = pr.doc.objects[0];
  assert.equal(applyOps(pr.doc, [{ op: "scale", id: portalObj.id, scale: 2 }]).ok, false);
  assert.equal(applyOps(doc, [{ op: "place", assetId: "act.sign", x: 3, y: 3, scale: 2 }]).ok, false);
  const badImport = JSON.parse(serializeMap(pr.doc));
  badImport.objects[0].scale = 2;
  assert.equal(parseMapJson(JSON.stringify(badImport)).ok, false);
  // 예전 맵(배율 없음)은 그대로 1
  assert.equal(objectCells({ id: "o", assetId: "deco.crate", x: 0, y: 0, rot: 0 }).length, 1);
});

test("프로젝트 번들: 내보내기→가져오기 왕복, 맵 id 재매핑과 포털 targetMapId 갱신, 단일 맵 호환", async () => {
  const { parseBundle, serializeProject } = await import("../lib/world/bundle.ts");
  const r = linkPortals(twoPages(), { mapId: "A", x: 3, y: 3 }, { mapId: "B", x: 10, y: 5 }, "포털", ["pa", "pb"]);
  assert.ok(r.ok);
  if (!r.ok) return;
  let n = 0;
  const gen = () => `new-${++n}`;
  const back = parseBundle(serializeProject("우리 반 월드", "설명", r.ps), gen);
  assert.ok(back.ok);
  if (!back.ok) return;
  assert.equal(back.kind, "project");
  assert.deepEqual(back.ps.order, ["new-1", "new-2"]);
  const pa = back.ps.docs["new-1"].interactions.find((i) => i.id === "pa");
  assert.ok(pa && pa.type === "portal" && pa.targetMapId === "new-2" && pa.targetId === "pb");
  assert.deepEqual(validateProject(back.ps), []);
  // 맵 한 장(예전 형식): 다른 페이지로 가던 포털은 정리하고 경고
  const single = parseBundle(serializeMap(r.ps.docs.A), gen);
  assert.ok(single.ok && single.kind === "map" && single.ps.docs[single.ps.order[0]].interactions.length === 0);
  assert.ok(single.ok && single.warnings.some((w) => w.code === "portal"));
  // 잘못된 페이지가 있으면 전체 거부
  const bad = JSON.parse(serializeProject("x", "", r.ps));
  bad.maps[1].objects.push(null);
  const br = parseBundle(JSON.stringify(bad), gen);
  assert.ok(!br.ok && br.errors[0].message.startsWith("2번째 페이지"));
  assert.equal(parseBundle(JSON.stringify({ format: "moa-world/project", version: 9, maps: [] }), gen).ok, false);
});
