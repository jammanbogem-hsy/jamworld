// 규칙 기반 데모 플래너. 실제 AI 가 아니며 UI 에서 "데모"로 표시한다.
// 키워드로 같은 선언적 작업(ops)을 만들어 미리보기·적용 흐름을 API 없이 검증할 수 있게 한다.
import { blockedGrid, inBounds, occupancy } from "../world/map.ts";
import type { MapOp } from "../world/ops.ts";
import type { MapDoc, Zone } from "../world/types.ts";

export interface DemoPlan {
  summary: string;
  ops: MapOp[];
}

const NUM: Record<string, number> = { 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5 };

function countOf(text: string, word: string, fallback: number) {
  const m = new RegExp(`${word}\\s*(\\d+|한|하나|두|둘|세|셋|네|넷|다섯)\\s*(개|칸|곳)?`).exec(text) ??
    new RegExp(`(\\d+|한|두|세|네|다섯)\\s*(개|칸|곳)?\\s*의?\\s*${word}`).exec(text);
  if (!m) return fallback;
  const v = /\d/.test(m[1]) ? Number(m[1]) : (NUM[m[1]] ?? fallback);
  return Math.max(1, Math.min(v, 6));
}

/** 오브젝트·물·시작점이 없는 빈 사각형 찾기 (여백 margin 포함) */
function findFree(doc: MapDoc, w: number, h: number, taken: Array<[number, number, number, number]>, margin = 1) {
  const occ = occupancy(doc);
  const blocked = blockedGrid(doc);
  const free = (x: number, y: number) => {
    for (let yy = y - margin; yy < y + h + margin; yy++) {
      for (let xx = x - margin; xx < x + w + margin; xx++) {
        if (!inBounds(doc, xx, yy)) return false;
        const i = yy * doc.width + xx;
        if (occ[i] || blocked[i]) return false;
        if (xx === doc.spawn.x && yy === doc.spawn.y) return false;
      }
    }
    return !taken.some(([tx, ty, tw, th]) => x < tx + tw + margin && x + w + margin > tx && y < ty + th + margin && y + h + margin > ty);
  };
  for (let y = 2; y + h < doc.height - 1; y++) for (let x = 2; x + w < doc.width - 1; x++) if (free(x, y)) return { x, y };
  return null;
}

function classroomFurniture(x: number, y: number, w: number, h: number): MapOp[] {
  // room 안쪽: (x+1..x+w-2, y+1..y+h-2)
  const ops: MapOp[] = [{ op: "place", assetId: "furn.blackboard", x: x + Math.floor(w / 2) - 1, y: y + 1 }];
  for (let yy = y + 3; yy <= y + h - 3; yy += 2) {
    for (let xx = x + 2; xx <= x + w - 3; xx += 2) ops.push({ op: "place", assetId: "furn.desk", x: xx, y: yy });
  }
  ops.push({ op: "place", assetId: "furn.bookshelf", x: x + 1, y: y + 1 });
  return ops;
}

function pickZone(doc: MapDoc, text: string): Zone | null {
  if (!doc.zones.length) return null;
  const named = doc.zones.find((z) => text.includes(z.name));
  if (named) return named;
  const pool = text.includes("교실") ? doc.zones.filter((z) => z.name.includes("교실")) : doc.zones;
  const list = pool.length ? pool : doc.zones;
  const by = (f: (z: Zone) => number, max: boolean) => list.reduce((a, b) => ((max ? f(b) > f(a) : f(b) < f(a)) ? b : a));
  if (/오른쪽|우측/.test(text)) return by((z) => z.x + z.w / 2, true);
  if (/왼쪽|좌측/.test(text)) return by((z) => z.x + z.w / 2, false);
  if (/위쪽|위에|윗/.test(text)) return by((z) => z.y + z.h / 2, false);
  if (/아래쪽|아래에|밑/.test(text)) return by((z) => z.y + z.h / 2, true);
  return list[list.length - 1];
}

export function planDemo(doc: MapDoc, request: string): DemoPlan {
  const t = request.replace(/\s+/g, " ");
  const ops: MapOp[] = [];
  const notes: string[] = [];
  const taken: Array<[number, number, number, number]> = [];

  // 후속 수정: 넓히기 / 입구 옮기기
  const edit = /넓|키워|키우|크게|입구|문을|문 /.test(t) && doc.zones.length > 0;
  if (edit) {
    const z = pickZone(doc, t);
    if (z) {
      const rx = z.x - 1;
      const ry = z.y - 1;
      let rw = z.w + 2;
      let rh = z.h + 2;
      if (/넓|키워|키우|크게/.test(t)) {
        rw += 3;
        if (rx + rw > doc.width - 1) rw = doc.width - 1 - rx;
      }
      let side: "N" | "S" | "E" | "W" = "S";
      if (/입구|문/.test(t)) {
        if (/아래|남/.test(t)) side = "S";
        else if (/위|북/.test(t)) side = "N";
        else if (/오른|동/.test(t)) side = "E";
        else if (/왼|서/.test(t)) side = "W";
      }
      const classroom = z.name.includes("교실");
      ops.push({ op: "clearRect", x: rx, y: ry, w: z.w + 2, h: z.h + 2 });
      ops.push({ op: "room", name: z.name, x: rx, y: ry, w: rw, h: rh, wallId: "wall.brick", floorId: classroom ? "tile.wood" : "tile.carpet", doors: [{ side }] });
      if (classroom) ops.push(...classroomFurniture(rx, ry, rw, rh));
      notes.push(`'${z.name}'을(를) ${rw - 2}×${rh - 2}칸으로 다시 짓고 입구를 ${{ S: "아래", N: "위", E: "오른쪽", W: "왼쪽" }[side]}에 두었어요`);
      return { summary: `[데모] ${notes.join(". ")}.`, ops };
    }
  }

  if (/숲|나무/.test(t)) {
    ops.push({ op: "scatter", assetId: "nature.tree", x: 0, y: 0, w: doc.width, h: 2, count: Math.floor(doc.width / 2), seed: 101 });
    ops.push({ op: "scatter", assetId: "nature.pine", x: 0, y: 2, w: 2, h: doc.height - 4, count: Math.floor(doc.height / 3), seed: 102 });
    ops.push({ op: "scatter", assetId: "nature.tree", x: doc.width - 2, y: 2, w: 2, h: doc.height - 4, count: Math.floor(doc.height / 3), seed: 103 });
    notes.push("가장자리에 숲을 둘렀어요");
  }

  if (/교실/.test(t)) {
    const n = countOf(t, "교실", 1);
    const existing = doc.zones.filter((z) => z.name.startsWith("교실")).length;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const spot = findFree(doc, 10, 8, taken, 1);
      if (!spot) break;
      taken.push([spot.x, spot.y, 10, 8]);
      const name = `교실 ${existing + i + 1}`;
      ops.push({ op: "room", name, x: spot.x, y: spot.y, w: 10, h: 8, wallId: "wall.brick", floorId: "tile.wood", doors: [{ side: "S" }] });
      ops.push(...classroomFurniture(spot.x, spot.y, 10, 8));
      made++;
    }
    notes.push(made === n ? `교실 ${n}개를 만들었어요` : `빈 자리가 부족해 교실 ${made}개만 만들었어요`);
  }

  if (/퀴즈/.test(t)) {
    const spot = findFree(doc, 9, 6, taken, 1);
    if (spot) {
      taken.push([spot.x, spot.y, 9, 6]);
      ops.push({ op: "paint", tileId: "tile.carpet", x: spot.x, y: spot.y, w: 9, h: 6 });
      ops.push({ op: "zone", name: "퀴즈 구역", x: spot.x, y: spot.y, w: 9, h: 6 });
      const qs = [
        { question: "식물이 자라는 데 필요한 것은?", choices: ["햇빛과 물", "모래와 소금"], answer: 0 },
        { question: "1 + 2 × 3 은?", choices: ["9", "7", "5"], answer: 1 },
        { question: "지구에서 가장 큰 바다는?", choices: ["대서양", "인도양", "태평양"], answer: 2 },
      ];
      qs.forEach((q, i) => ops.push({ op: "quiz", x: spot.x + 1 + i * 3, y: spot.y + 1, ...q }));
      notes.push("퀴즈판 3개가 있는 퀴즈 구역을 만들었어요");
    } else notes.push("퀴즈 구역을 놓을 빈 자리가 없어요");
  }

  if (/연못|호수|물/.test(t)) {
    const spot = findFree(doc, 6, 4, taken, 1);
    if (spot) {
      taken.push([spot.x, spot.y, 6, 4]);
      ops.push({ op: "paint", tileId: "tile.water", x: spot.x, y: spot.y, w: 6, h: 4 });
      ops.push({ op: "zone", name: "연못", x: spot.x, y: spot.y, w: 6, h: 4 });
      notes.push("연못을 만들었어요");
    }
  }

  if (/광장|분수/.test(t)) {
    const spot = findFree(doc, 7, 6, taken, 1);
    if (spot) {
      taken.push([spot.x, spot.y, 7, 6]);
      ops.push({ op: "paint", tileId: "tile.stone", x: spot.x, y: spot.y, w: 7, h: 6 });
      ops.push({ op: "place", assetId: "deco.fountain", x: spot.x + 2, y: spot.y + 2 });
      ops.push({ op: "zone", name: "광장", x: spot.x, y: spot.y, w: 7, h: 6 });
      notes.push("분수 광장을 만들었어요");
    }
  }

  if (/포털/.test(t)) {
    const a = findFree(doc, 1, 1, taken, 1);
    if (a) taken.push([a.x, a.y, 1, 1]);
    const b = a ? findFree(doc, 1, 1, [...taken, [a.x - 8, a.y - 8, 17, 17]], 1) : null;
    if (a && b) {
      ops.push({ op: "portalPair", a, b, label: "포털" });
      notes.push("서로 연결된 포털 한 쌍을 놓았어요");
    }
  }

  if (/안내|표지/.test(t)) {
    const x = Math.min(doc.width - 1, doc.spawn.x + 2);
    ops.push({ op: "sign", x, y: doc.spawn.y, text: "환영합니다! 둘러보고 퀴즈도 풀어 보세요." });
    notes.push("시작 위치 옆에 안내판을 세웠어요");
  }

  if (!ops.length) {
    return {
      summary: "[데모] 데모 모드는 '숲, 교실 N개, 퀴즈, 연못, 광장, 포털, 안내판, 넓혀/입구' 같은 키워드만 이해해요. 실제 AI 모델을 연결하면 자유로운 요청을 처리합니다.",
      ops: [],
    };
  }
  return { summary: `[데모] ${notes.join(", ")}.`, ops };
}
