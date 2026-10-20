import { getAsset } from "./catalog.ts";
import { blockedGrid, cellOrNeighborReachable, inBounds, objectCells, reachableFrom } from "./map.ts";
import { SCHEMA_VERSION, type MapDoc } from "./types.ts";

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** 맵 문서 무결성 검사. strict 이면 도달성 문제도 오류로 본다 */
export function validateMap(doc: MapDoc, opts: { strict?: boolean } = {}): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });

  if (doc.schemaVersion !== SCHEMA_VERSION) err("schema", `지원하지 않는 맵 버전입니다: ${doc.schemaVersion}`);
  if (!Number.isInteger(doc.width) || !Number.isInteger(doc.height) || doc.width < 8 || doc.height < 8 || doc.width > 200 || doc.height > 200) {
    err("size", "맵 크기는 8~200 칸이어야 합니다");
    return { errors, warnings };
  }
  if (!Array.isArray(doc.terrain) || doc.terrain.length !== doc.width * doc.height) {
    err("terrain", "바닥 데이터 길이가 맵 크기와 맞지 않습니다");
    return { errors, warnings };
  }
  for (const t of doc.terrainPalette) {
    const a = getAsset(t);
    if (!a || a.kind !== "tile") err("asset", `카탈로그에 없는 바닥 타일입니다: ${t}`);
  }
  if (doc.terrain.some((v) => !Number.isInteger(v) || v < 0 || v >= doc.terrainPalette.length)) {
    err("terrain", "바닥 데이터에 잘못된 타일 번호가 있습니다");
  }

  const seen = new Map<number, string>();
  const ids = new Set<string>();
  for (const o of doc.objects) {
    if (ids.has(o.id)) err("id", `중복된 오브젝트 id: ${o.id}`);
    ids.add(o.id);
    const a = getAsset(o.assetId);
    if (!a || a.kind !== "object") {
      err("asset", `카탈로그에 없는 에셋입니다: ${o.assetId}`);
      continue;
    }
    if (![0, 90, 180, 270].includes(o.rot)) err("rot", `${a.name}(${o.id}) 회전값이 올바르지 않습니다`);
    for (const [x, y] of objectCells(o)) {
      if (!inBounds(doc, x, y)) {
        err("bounds", `${a.name}(${o.id}) 가 맵 경계를 벗어납니다`);
        break;
      }
      const k = y * doc.width + x;
      const prev = seen.get(k);
      if (prev) err("overlap", `${a.name}(${o.id}) 가 ${prev} 와 겹칩니다 (${x},${y})`);
      else seen.set(k, o.id);
    }
  }

  const blocked = blockedGrid(doc);
  const { x: sx, y: sy } = doc.spawn;
  if (!inBounds(doc, sx, sy)) err("spawn", "시작 위치가 맵 경계를 벗어납니다");
  else if (blocked[sy * doc.width + sx]) err("spawn", `시작 위치(${sx},${sy})가 막혀 있습니다`);

  const reach = inBounds(doc, sx, sy) ? reachableFrom(doc, blocked, sx, sy) : new Uint8Array(doc.width * doc.height);
  const reachIssue = opts.strict ? err : (code: string, message: string) => warnings.push({ code, message });

  for (const z of doc.zones) {
    if (!inBounds(doc, z.x, z.y) || !inBounds(doc, z.x + z.w - 1, z.y + z.h - 1) || z.w < 1 || z.h < 1) {
      err("zone", `구역 '${z.name}' 이 맵 경계를 벗어납니다`);
      continue;
    }
    let ok = false;
    for (let y = z.y; y < z.y + z.h && !ok; y++) for (let x = z.x; x < z.x + z.w && !ok; x++) ok = reach[y * doc.width + x] === 1;
    if (!ok) reachIssue("reach", `시작 위치에서 구역 '${z.name}' 으로 갈 수 없습니다`);
  }

  const iids = new Map(doc.interactions.map((i) => [i.id, i]));
  for (const i of doc.interactions) {
    if (!inBounds(doc, i.x, i.y)) {
      err("interaction", `상호작용 ${i.id} 가 맵 경계를 벗어납니다`);
      continue;
    }
    if (i.type === "portal") {
      if (i.targetId) {
        const t = iids.get(i.targetId);
        if (!t || t.type !== "portal") err("portal", `포털 ${i.id} 의 도착 포털 ${i.targetId} 가 없습니다`);
      } else if (!i.targetMapId) {
        err("portal", `포털 ${i.id} 에 연결된 도착지가 없습니다`);
      }
    }
    if (i.type === "quiz" && (i.choices.length < 2 || i.answer < 0 || i.answer >= i.choices.length)) {
      err("quiz", `퀴즈 ${i.id} 의 보기나 정답이 올바르지 않습니다`);
    }
    if (!cellOrNeighborReachable(doc, reach, i.x, i.y)) {
      const label = i.type === "sign" ? "안내판" : i.type === "quiz" ? "퀴즈판" : "포털";
      reachIssue("reach", `시작 위치에서 ${label}(${i.x},${i.y}) 에 접근할 수 없습니다`);
    }
  }
  return { errors, warnings };
}
