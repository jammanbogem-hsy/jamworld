// 맵 JSON 경계(가져오기·저장소·서버 요청). 타입 단언 대신 필드별로 검사해 깨끗한 문서를 새로 만든다.
import { SCHEMA_VERSION, type Interaction, type MapDoc, type PlacedObject, type Rot, type Zone } from "./types.ts";
import { validateMap, type ValidationIssue } from "./validate.ts";

export const EXPORT_FORMAT = "moa-world/map";

export const IO_LIMITS = {
  maxBytes: 2_000_000,
  maxSide: 200,
  maxObjects: 20_000,
  maxZones: 500,
  maxInteractions: 2_000,
  maxPalette: 64,
  maxText: 400,
};

export function serializeMap(doc: MapDoc): string {
  return JSON.stringify({ format: EXPORT_FORMAT, ...doc });
}

export type ParseResult = { ok: true; doc: MapDoc; warnings: ValidationIssue[] } | { ok: false; errors: ValidationIssue[] };

class SchemaError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function int(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new SchemaError(`${where}: 정수가 아닙니다`);
  return v;
}

function str(v: unknown, where: string, max = IO_LIMITS.maxText, allowEmpty = false): string {
  if (typeof v !== "string") throw new SchemaError(`${where}: 문자열이 아닙니다`);
  if (!allowEmpty && !v.trim()) throw new SchemaError(`${where}: 비어 있습니다`);
  return v.slice(0, max);
}

function arr(v: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new SchemaError(`${where}: 배열이 아닙니다`);
  if (v.length > max) throw new SchemaError(`${where}: 항목이 너무 많습니다 (${v.length} > ${max})`);
  return v;
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (!isObj(v)) throw new SchemaError(`${where}: 객체가 아닙니다`);
  return v;
}

function rot(v: unknown, where: string): Rot {
  const r = v === undefined ? 0 : int(v, where);
  if (r !== 0 && r !== 90 && r !== 180 && r !== 270) throw new SchemaError(`${where}: 회전은 0/90/180/270 만 가능합니다`);
  return r;
}

function sanitizeInteraction(v: unknown, where: string): Interaction {
  const o = obj(v, where);
  const base = { id: str(o.id, `${where}.id`, 64), x: int(o.x, `${where}.x`), y: int(o.y, `${where}.y`) };
  switch (o.type) {
    case "sign":
      return { ...base, type: "sign", text: str(o.text, `${where}.text`) };
    case "quiz": {
      const choices = arr(o.choices, `${where}.choices`, 5).map((c, k) => str(c, `${where}.choices[${k}]`, 80));
      if (choices.length < 2) throw new SchemaError(`${where}.choices: 보기는 2~5개여야 합니다`);
      return { ...base, type: "quiz", question: str(o.question, `${where}.question`, 200), choices, answer: int(o.answer, `${where}.answer`) };
    }
    case "portal": {
      const p: Interaction = { ...base, type: "portal" };
      if (o.targetId !== undefined) p.targetId = str(o.targetId, `${where}.targetId`, 64);
      if (o.targetMapId !== undefined) p.targetMapId = str(o.targetMapId, `${where}.targetMapId`, 64);
      if (o.label !== undefined) p.label = str(o.label, `${where}.label`, 40, true);
      return p;
    }
    default:
      throw new SchemaError(`${where}.type: 알 수 없는 상호작용 종류입니다`);
  }
}

/** 신뢰할 수 없는 값 → 깨끗한 MapDoc. 구조가 틀리면 SchemaError */
export function sanitizeMap(raw: unknown): MapDoc {
  const r = obj(raw, "맵");
  if (r.format !== undefined && r.format !== EXPORT_FORMAT) throw new SchemaError(`모아 월드 맵 파일이 아닙니다 (${String(r.format)})`);
  if (r.schemaVersion !== SCHEMA_VERSION) throw new SchemaError(`지원하지 않는 맵 버전입니다: ${String(r.schemaVersion)}`);
  const width = int(r.width, "width");
  const height = int(r.height, "height");
  if (width < 8 || height < 8 || width > IO_LIMITS.maxSide || height > IO_LIMITS.maxSide) {
    throw new SchemaError(`맵 크기는 8~${IO_LIMITS.maxSide} 칸이어야 합니다`);
  }
  const terrainPalette = arr(r.terrainPalette, "terrainPalette", IO_LIMITS.maxPalette).map((t, i) => str(t, `terrainPalette[${i}]`, 64));
  if (!terrainPalette.length) throw new SchemaError("terrainPalette: 비어 있습니다");
  const terrainRaw = arr(r.terrain, "terrain", width * height);
  if (terrainRaw.length !== width * height) throw new SchemaError("terrain: 길이가 맵 크기와 맞지 않습니다");
  const terrain = terrainRaw.map((v, i) => {
    const n = int(v, `terrain[${i}]`);
    if (n < 0 || n >= terrainPalette.length) throw new SchemaError(`terrain[${i}]: 잘못된 타일 번호`);
    return n;
  });
  const objects: PlacedObject[] = arr(r.objects ?? [], "objects", IO_LIMITS.maxObjects).map((v, i) => {
    const o = obj(v, `objects[${i}]`);
    return {
      id: str(o.id, `objects[${i}].id`, 64),
      assetId: str(o.assetId, `objects[${i}].assetId`, 64),
      x: int(o.x, `objects[${i}].x`),
      y: int(o.y, `objects[${i}].y`),
      rot: rot(o.rot, `objects[${i}].rot`),
    };
  });
  const zones: Zone[] = arr(r.zones ?? [], "zones", IO_LIMITS.maxZones).map((v, i) => {
    const z = obj(v, `zones[${i}]`);
    return {
      id: str(z.id, `zones[${i}].id`, 64),
      name: str(z.name, `zones[${i}].name`, 40),
      x: int(z.x, `zones[${i}].x`),
      y: int(z.y, `zones[${i}].y`),
      w: int(z.w, `zones[${i}].w`),
      h: int(z.h, `zones[${i}].h`),
    };
  });
  const interactions = arr(r.interactions ?? [], "interactions", IO_LIMITS.maxInteractions).map((v, i) =>
    sanitizeInteraction(v, `interactions[${i}]`),
  );
  const sp = obj(r.spawn, "spawn");
  const nextId = r.nextId === undefined ? 1 : int(r.nextId, "nextId");
  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(r.id ?? "imported", "id", 64),
    name: str(r.name ?? "가져온 맵", "name", 60),
    width,
    height,
    terrainPalette,
    terrain,
    objects,
    zones,
    interactions,
    spawn: { x: int(sp.x, "spawn.x"), y: int(sp.y, "spawn.y") },
    nextId: Math.max(1, nextId),
  };
}

/** 이미 파싱된 값 검사 (서버 요청 본문 등) */
export function checkMapValue(raw: unknown): ParseResult {
  let doc: MapDoc;
  try {
    doc = sanitizeMap(raw);
  } catch (e) {
    if (e instanceof SchemaError) return { ok: false, errors: [{ code: "schema", message: e.message }] };
    throw e;
  }
  const v = validateMap(doc);
  if (v.errors.length) return { ok: false, errors: v.errors };
  return { ok: true, doc, warnings: v.warnings };
}

export function parseMapJson(text: string): ParseResult {
  if (text.length > IO_LIMITS.maxBytes) {
    return { ok: false, errors: [{ code: "size", message: `파일이 너무 큽니다 (${Math.round(text.length / 1024)}KB)` }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ code: "json", message: "JSON 형식이 아닙니다" }] };
  }
  return checkMapValue(raw);
}
