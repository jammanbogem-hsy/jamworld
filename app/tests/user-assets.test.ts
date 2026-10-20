import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapJson, serializeMap } from "../lib/world/io.ts";
import { createMap } from "../lib/world/map.ts";
import { applyOps } from "../lib/world/ops.ts";
import { PlayWorld } from "../lib/world/play.ts";
import { registerLibrary, syncEmbeddedAssets } from "../lib/world/user-assets.ts";
import { enableUserRegistry } from "../lib/world/catalog.ts";
import { checkMapValue } from "../lib/world/io.ts";
import { mapContext, userMessage } from "../lib/agent/prompt.ts";
import type { EmbeddedAsset, MapDoc } from "../lib/world/types.ts";

/** 브라우저 편집기 상황(전역 캐시 켬)과 서버 상황(끔)을 테스트마다 명시 */
const browser = () => enableUserRegistry(true);
const server = () => enableUserRegistry(false);

const lib = [
  { id: "ast_shelf1", name: "물고기 책장", category: "furniture" as const, tags: ["책장"], appearance: { kind: "views" as const }, behavior: { footprint: { w: 2, d: 1 }, blocking: true, height: 1.5 }, urls: { td: "/api/workshop/files/cls/c1/gen/g1/td.webp", iso: "/api/workshop/files/cls/c1/gen/g1/iso.webp" } },
  { id: "ast_lava1", name: "용암 바닥", category: "terrain" as const, tags: ["용암"], appearance: { kind: "texture" as const }, behavior: { footprint: { w: 1, d: 1 }, blocking: true, height: 0 }, urls: { texture: "/api/workshop/files/cls/c1/gen/g2/texture.webp" } },
];

test("보관함 에셋을 배치하면 맵에 동작 정보가 내장되고, 그것만으로 다른 곳에서도 검증·충돌 유지", () => {
  browser();
  const [shelf, lava] = registerLibrary(lib);
  const r = applyOps(createMap("m", "t", 20, 16), [
    { op: "place", assetId: shelf, x: 3, y: 3 },
    { op: "paint", tileId: lava, x: 8, y: 8, w: 2, h: 2 },
  ]);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const doc = syncEmbeddedAssets(r.doc);
  assert.deepEqual(Object.keys(doc.assets!).sort(), [lava, shelf].sort());
  const w = new PlayWorld(doc);
  assert.ok(w.isBlocked(4, 3), "2×1 책장 충돌");
  assert.ok(w.isBlocked(8, 8), "통과 불가 바닥");
  const back = parseMapJson(serializeMap(doc));
  assert.ok(back.ok, back.ok ? "" : JSON.stringify(back.errors));
});

test("내장 정보 없이 사용자 에셋을 쓰면 거부, 외부 URL 은 버리고, 쓰지 않는 에셋은 동기화 때 제거", () => {
  browser();
  const [shelf] = registerLibrary(lib);
  const r = applyOps(createMap("m", "t", 20, 16), [{ op: "place", assetId: shelf, x: 3, y: 3 }]);
  const raw = JSON.parse(serializeMap(syncEmbeddedAssets(r.doc)));
  raw.objects[0].assetId = "u:ast_unknown";
  assert.equal(parseMapJson(JSON.stringify(raw)).ok, false);
  const ext = JSON.parse(serializeMap(syncEmbeddedAssets(r.doc)));
  ext.assets[shelf].views.td = "https://evil.example/x.png";
  const p = parseMapJson(JSON.stringify(ext));
  assert.ok(p.ok && p.doc.assets![shelf].views.td === undefined);
  const removed = applyOps(r.doc, [{ op: "remove", id: r.doc.objects[0].id }]);
  assert.equal(syncEmbeddedAssets(syncEmbeddedAssets(removed.doc)).assets, undefined);
  const bad = JSON.parse(serializeMap(syncEmbeddedAssets(r.doc)));
  bad.assets[shelf].footprint = { w: 9, d: 1 };
  assert.equal(parseMapJson(JSON.stringify(bad)).ok, false);
});

const small: EmbeddedAsset = { name: "작은 상자", kind: "object", category: "decor", tags: ["상자"], footprint: { w: 1, d: 1 }, blocking: true, height: 1, views: {} };
const huge: EmbeddedAsset = { ...small, name: "큰 상자", footprint: { w: 3, d: 3 } };

function docWith(id: string, def: EmbeddedAsset, x: number): MapDoc {
  const d = createMap("m-" + def.name, "t", 20, 16);
  return { ...d, objects: [{ id: "o1", assetId: id, x, y: 2, rot: 0 }], assets: { [id]: def }, nextId: 2 };
}

test("서버: 같은 id 를 다른 정의로 쓰는 두 동시 요청이 서로 섞이지 않는다", async () => {
  server();
  const id = "u:ast_same";
  // 요청 A: 1×1 정의로 맵 오른쪽 끝(x=19)에 배치 → 유효 / 요청 B: 3×3 정의
  const reqA = async () => {
    const parsed = checkMapValue(JSON.parse(JSON.stringify(docWith(id, small, 19))));
    assert.ok(parsed.ok, "A 파싱");
    await new Promise((r) => setTimeout(r, 5)); // 모델 응답 대기 중 B 가 끼어듦
    if (!parsed.ok) return;
    const r = applyOps(parsed.doc, [{ op: "move", id: "o1", x: 19, y: 5 }], { strict: false });
    assert.ok(r.ok, `A 는 자기 1×1 정의로 검증돼야 함: ${JSON.stringify(r.errors)}`);
    assert.equal(new PlayWorld(r.doc).isBlocked(18, 5), false);
  };
  const reqB = async () => {
    await new Promise((r) => setTimeout(r, 1));
    const parsed = checkMapValue(JSON.parse(JSON.stringify(docWith(id, huge, 2))));
    assert.ok(parsed.ok, "B 파싱");
    if (!parsed.ok) return;
    const r = applyOps(parsed.doc, [{ op: "move", id: "o1", x: 19, y: 5 }]);
    assert.equal(r.ok, false, "B 는 3×3 이라 경계 밖");
  };
  await Promise.all([reqA(), reqB()]);
  // 서버에는 전역 정의가 남지 않는다
  assert.equal(applyOps(createMap("x", "t", 20, 16), [{ op: "place", assetId: id, x: 1, y: 1 }]).ok, false);
});

test("서버 에이전트: 카탈로그·검증은 그 actor 의 보관함 + 해당 맵 정의만 (fixture, 모델 호출 없음)", () => {
  server();
  const libDefs = { "u:ast_mine": { ...small, name: "내 물고기 책장", footprint: { w: 2, d: 1 } } };
  const doc = createMap("m", "t", 20, 16);
  // 프롬프트 카탈로그에 내 보관함 에셋이 포함된다
  const msg = userMessage(doc, "물고기 책장을 놓아 줘", libDefs);
  assert.match(msg, /u:ast_mine \| 내 물고기 책장 \| 2x1/);
  // 모델이 낸 작업을 같은 범위로 검증 → 성공하면 결과 맵에 정의가 내장
  const r = applyOps(doc, [{ op: "place", assetId: "u:ast_mine", x: 3, y: 3 }], { strict: true, extraAssets: libDefs });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(Object.keys(r.doc.assets ?? {}), ["u:ast_mine"]);
  // 권한 없는(보관함에 없는) 에셋은 거부
  assert.equal(applyOps(doc, [{ op: "place", assetId: "u:ast_other", x: 3, y: 3 }], { extraAssets: libDefs }).ok, false);
  // 맵 내장 정의가 보관함 정의보다 우선
  const placed = r.doc;
  const ctx = mapContext(placed);
  assert.match(ctx, /u:ast_mine/);
  browser();
});
