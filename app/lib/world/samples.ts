import { createMap } from "./map.ts";
import { applyOps, type MapOp } from "./ops.ts";
import type { MapDoc } from "./types.ts";

function build(id: string, name: string, w: number, h: number, ops: MapOp[]): MapDoc {
  const r = applyOps(createMap(id, name, w, h), ops);
  if (!r.ok) throw new Error(`샘플 맵 '${name}' 생성 실패: ${r.errors.map((e) => e.message).join(", ")}`);
  return r.doc;
}

export function sampleForestPlaza(id = "sample-forest"): MapDoc {
  return build(id, "숲속 광장", 36, 26, [
    { op: "setSpawn", x: 18, y: 22 },
    { op: "paint", tileId: "tile.grass_dark", x: 0, y: 0, w: 36, h: 3 },
    { op: "paint", tileId: "tile.dirt", x: 17, y: 6, w: 3, h: 18 },
    { op: "paint", tileId: "tile.stone", x: 12, y: 8, w: 13, h: 9 },
    { op: "place", assetId: "deco.fountain", x: 17, y: 11 },
    { op: "zone", name: "중앙 광장", x: 12, y: 8, w: 13, h: 9 },
    { op: "place", assetId: "furn.bench", x: 13, y: 9 },
    { op: "place", assetId: "furn.bench", x: 22, y: 9 },
    { op: "place", assetId: "deco.lamp", x: 12, y: 8 },
    { op: "place", assetId: "deco.lamp", x: 24, y: 8 },
    { op: "place", assetId: "deco.flowerpot", x: 12, y: 16 },
    { op: "place", assetId: "deco.flowerpot", x: 24, y: 16 },
    { op: "sign", x: 20, y: 19, text: "모아 월드 숲속 광장에 오신 걸 환영해요! 분수 뒤쪽 포털로 비밀 정원에 가 보세요." },
    { op: "paint", tileId: "tile.water", x: 3, y: 15, w: 5, h: 4 },
    { op: "zone", name: "연못", x: 2, y: 14, w: 7, h: 6 },
    { op: "paint", tileId: "tile.sand", x: 27, y: 4, w: 7, h: 6 },
    { op: "line", assetId: "wall.stone_seg", x1: 27, y1: 3, x2: 33, y2: 3 },
    { op: "zone", name: "비밀 정원", x: 27, y: 4, w: 7, h: 6 },
    { op: "scatter", assetId: "nature.flower", x: 27, y: 5, w: 7, h: 4, count: 6, seed: 3 },
    { op: "place", assetId: "nature.mushroom", x: 33, y: 9 },
    { op: "portalPair", a: { x: 18, y: 6 }, b: { x: 30, y: 4 }, label: "비밀 정원" },
    { op: "quiz", x: 28, y: 9, question: "나무가 광합성을 할 때 필요한 것은?", choices: ["햇빛", "소금", "모래"], answer: 0 },
    { op: "scatter", assetId: "nature.tree", x: 0, y: 0, w: 36, h: 2, count: 18, seed: 11 },
    { op: "scatter", assetId: "nature.pine", x: 0, y: 2, w: 2, h: 22, count: 10, seed: 12 },
    { op: "scatter", assetId: "nature.tree", x: 34, y: 2, w: 2, h: 22, count: 10, seed: 13 },
    { op: "scatter", assetId: "nature.bush", x: 2, y: 3, w: 9, h: 9, count: 8, seed: 14 },
    { op: "scatter", assetId: "nature.rock", x: 26, y: 12, w: 8, h: 10, count: 5, seed: 15 },
    { op: "place", assetId: "deco.crate", x: 9, y: 21 },
    { op: "place", assetId: "deco.crate", x: 10, y: 21 },
    { op: "place", assetId: "deco.flag", x: 16, y: 23 },
  ]);
}

export function sampleSchool(id = "sample-school"): MapDoc {
  return build(id, "모아 학교", 40, 28, [
    { op: "setSpawn", x: 20, y: 25 },
    { op: "paint", tileId: "tile.stone", x: 18, y: 4, w: 4, h: 23 },
    { op: "room", name: "교실 1", x: 3, y: 3, w: 11, h: 9, wallId: "wall.brick", floorId: "tile.wood", doors: [{ side: "E" }] },
    { op: "room", name: "교실 2", x: 26, y: 3, w: 11, h: 9, wallId: "wall.brick", floorId: "tile.wood", doors: [{ side: "W" }] },
    { op: "place", assetId: "furn.blackboard", x: 7, y: 4 },
    { op: "place", assetId: "furn.blackboard", x: 30, y: 4 },
    { op: "scatter", assetId: "furn.desk", x: 5, y: 6, w: 7, h: 4, count: 8, seed: 21 },
    { op: "scatter", assetId: "furn.desk", x: 28, y: 6, w: 7, h: 4, count: 8, seed: 22 },
    { op: "place", assetId: "furn.bookshelf", x: 4, y: 4 },
    { op: "place", assetId: "furn.bookshelf", x: 35, y: 4 },
    { op: "room", name: "퀴즈 구역", x: 4, y: 15, w: 12, h: 9, wallId: "wall.stone", floorId: "tile.carpet", doors: [{ side: "E" }] },
    { op: "quiz", x: 6, y: 17, question: "우리나라의 수도는?", choices: ["부산", "서울", "대구"], answer: 1 },
    { op: "quiz", x: 9, y: 17, question: "물이 어는 온도는 몇 도일까요?", choices: ["0도", "50도", "100도"], answer: 0 },
    { op: "quiz", x: 12, y: 17, question: "삼각형의 꼭짓점은 몇 개?", choices: ["2개", "3개", "4개"], answer: 1 },
    { op: "sign", x: 22, y: 22, text: "모아 학교 안내: 왼쪽 위 교실 1, 오른쪽 위 교실 2, 왼쪽 아래 퀴즈 구역" },
    { op: "paint", tileId: "tile.sand", x: 25, y: 15, w: 11, h: 8 },
    { op: "zone", name: "운동장", x: 25, y: 15, w: 11, h: 8 },
    { op: "place", assetId: "deco.flag", x: 30, y: 15 },
    { op: "place", assetId: "furn.bench", x: 26, y: 22 },
    { op: "scatter", assetId: "nature.tree", x: 0, y: 0, w: 40, h: 2, count: 16, seed: 23 },
    { op: "scatter", assetId: "nature.bush", x: 37, y: 13, w: 3, h: 14, count: 6, seed: 24 },
  ]);
}

export const SAMPLE_BUILDERS: Array<{ key: string; name: string; description: string; build: (id: string) => MapDoc }> = [
  { key: "forest", name: "숲속 광장", description: "분수 광장, 연못, 포털로 이어진 비밀 정원", build: sampleForestPlaza },
  { key: "school", name: "모아 학교", description: "교실 두 개, 퀴즈 구역, 운동장", build: sampleSchool },
];
