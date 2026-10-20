// 선언적 맵 작업. 수동 편집과 에이전트가 같은 작업 형식을 쓴다.
// applyOps 는 사본에서만 작업하고, 하나라도 실패하면 원본을 그대로 돌려준다.
import { footprintOf, getAsset, isValidScale, SCALE_MAX, SCALE_MIN, withAssetScope } from "./catalog.ts";
import { syncEmbeddedAssets } from "./user-assets.ts";
import { cloneMap, inBounds, objectCells, occupancy, setTile } from "./map.ts";
import type { EmbeddedAsset, Interaction, MapDoc, Rot } from "./types.ts";
import { validateMap, type ValidationIssue } from "./validate.ts";

export type Side = "N" | "S" | "E" | "W";

export type MapOp =
  | { op: "place"; assetId: string; x: number; y: number; rot?: Rot; scale?: number }
  | { op: "scale"; id: string; scale: number }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; x: number; y: number }
  | { op: "rotate"; id: string; rot: Rot }
  | { op: "paint"; tileId: string; x: number; y: number; w?: number; h?: number }
  | { op: "clearRect"; x: number; y: number; w: number; h: number }
  | { op: "line"; assetId: string; x1: number; y1: number; x2: number; y2: number }
  | { op: "scatter"; assetId: string; x: number; y: number; w: number; h: number; count: number; seed?: number }
  | {
      op: "room";
      name?: string;
      x: number;
      y: number;
      w: number;
      h: number;
      wallId?: string;
      floorId?: string;
      doors?: Array<{ side: Side; at?: number; width?: number }>;
    }
  | { op: "zone"; name: string; x: number; y: number; w: number; h: number; id?: string }
  | { op: "removeZone"; id: string }
  | { op: "sign"; x: number; y: number; text: string }
  | { op: "quiz"; x: number; y: number; question: string; choices: string[]; answer: number }
  | { op: "portalPair"; a: { x: number; y: number }; b: { x: number; y: number }; label?: string }
  /** 다른 페이지(맵)로 가는 포털 한쪽. 짝은 상대 맵에 같은 작업으로 만든다(프로젝트 단위 원자 적용) */
  | { op: "portalTo"; x: number; y: number; id: string; targetMapId: string; targetId: string; label?: string }
  | { op: "removeInteraction"; id: string }
  | {
      op: "editInteraction";
      id: string;
      text?: string;
      question?: string;
      choices?: string[];
      answer?: number;
      label?: string;
      targetMapId?: string | null;
    }
  | { op: "setSpawn"; x: number; y: number };

export const OP_NAMES: MapOp["op"][] = [
  "place", "scale", "portalTo", "remove", "move", "rotate", "paint", "clearRect", "line", "scatter", "room",
  "zone", "removeZone", "sign", "quiz", "portalPair", "removeInteraction", "editInteraction", "setSpawn",
];

export interface ApplyResult {
  ok: boolean;
  doc: MapDoc;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summary: { added: number; removed: number; moved: number; painted: number; zones: number; interactions: number };
}

class OpError extends Error {}

function int(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new OpError(`${name} 값이 숫자가 아닙니다`);
  return Math.round(v);
}

function newId(doc: MapDoc, prefix: string) {
  return `${prefix}${doc.nextId++}`;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Ctx {
  doc: MapDoc;
  occ: Int32Array;
  summary: ApplyResult["summary"];
}

function rebuildOcc(ctx: Ctx) {
  ctx.occ = occupancy(ctx.doc);
}

function canPlace(ctx: Ctx, assetId: string, x: number, y: number, rot: Rot, ignoreId?: string, scale = 1): string | null {
  const a = getAsset(assetId);
  if (!a) return `카탈로그에 없는 에셋입니다: ${assetId}`;
  if (a.kind !== "object") return `${assetId} 는 바닥 타일입니다. paint 를 사용하세요`;
  if (!isValidScale(scale)) return `크기 배율은 ${SCALE_MIN}~${SCALE_MAX} 사이여야 합니다`;
  // 상호작용(포털·안내판·퀴즈)은 밟는 칸·접근 거리 판정과 맞추기 위해 1배 고정
  if (a.interaction && scale !== 1) return `${a.name} 같은 상호작용 오브젝트는 크기를 바꿀 수 없어요`;
  const fp = footprintOf(a, rot, scale);
  for (let dy = 0; dy < fp.d; dy++) {
    for (let dx = 0; dx < fp.w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (!inBounds(ctx.doc, cx, cy)) return `${a.name}(${x},${y}) 가 맵 경계를 벗어납니다`;
      const o = ctx.occ[cy * ctx.doc.width + cx];
      if (o && ctx.doc.objects[o - 1].id !== ignoreId) {
        return `${a.name}(${x},${y}) 자리에 이미 ${getAsset(ctx.doc.objects[o - 1].assetId)?.name ?? "오브젝트"} 가 있습니다`;
      }
    }
  }
  return null;
}

function place(ctx: Ctx, assetId: string, x: number, y: number, rot: Rot = 0, strict = true, scale = 1): string | null {
  const err = canPlace(ctx, assetId, x, y, rot, undefined, scale);
  if (err) {
    if (strict) throw new OpError(err);
    return null;
  }
  const id = newId(ctx.doc, "o");
  const s = Math.round(scale * 100) / 100;
  ctx.doc.objects.push(s === 1 ? { id, assetId, x, y, rot } : { id, assetId, x, y, rot, scale: s });
  const idx = ctx.doc.objects.length;
  for (const [cx, cy] of objectCells(ctx.doc.objects[idx - 1])) ctx.occ[cy * ctx.doc.width + cx] = idx;
  ctx.summary.added++;
  return id;
}

function removeWhere(ctx: Ctx, pred: (o: MapDoc["objects"][number]) => boolean) {
  const before = ctx.doc.objects.length;
  const removedIds = new Set(ctx.doc.objects.filter(pred).map((o) => o.id));
  ctx.doc.objects = ctx.doc.objects.filter((o) => !removedIds.has(o.id));
  ctx.summary.removed += before - ctx.doc.objects.length;
  if (removedIds.size) rebuildOcc(ctx);
}

function rectCheck(doc: MapDoc, x: number, y: number, w: number, h: number, what: string) {
  if (w < 1 || h < 1) throw new OpError(`${what} 크기가 올바르지 않습니다`);
  if (!inBounds(doc, x, y) || !inBounds(doc, x + w - 1, y + h - 1)) {
    throw new OpError(`${what}(${x},${y},${w}×${h}) 가 맵 경계를 벗어납니다`);
  }
}

function interactionsInRect(doc: MapDoc, x: number, y: number, w: number, h: number) {
  return doc.interactions.filter((i) => i.x >= x && i.y >= y && i.x < x + w && i.y < y + h);
}

function removeInteractionAndLinks(doc: MapDoc, ids: Set<string>) {
  // 짝을 잃은 포털 상호작용도 함께 제거한다 (포털 오브젝트는 장식으로 남음)
  doc.interactions = doc.interactions.filter(
    (i) => !ids.has(i.id) && !(i.type === "portal" && i.targetId && ids.has(i.targetId) && !i.targetMapId),
  );
  for (const i of doc.interactions) if (i.type === "portal" && i.targetId && ids.has(i.targetId)) delete i.targetId;
}

function applyOne(ctx: Ctx, op: MapOp) {
  const doc = ctx.doc;
  switch (op.op) {
    case "place": {
      place(ctx, op.assetId, int(op.x, "x"), int(op.y, "y"), (op.rot ?? 0) as Rot, true, op.scale ?? 1);
      return;
    }
    case "scale": {
      const o = doc.objects.find((x) => x.id === op.id);
      if (!o) throw new OpError(`오브젝트 ${op.id} 를 찾을 수 없습니다`);
      const err = canPlace(ctx, o.assetId, o.x, o.y, o.rot, o.id, op.scale);
      if (err) throw new OpError(err);
      const s = Math.round(op.scale * 100) / 100;
      if (s === 1) delete o.scale;
      else o.scale = s;
      rebuildOcc(ctx);
      return;
    }
    case "portalTo": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const id = String(op.id ?? "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new OpError("포털 id 형식이 올바르지 않습니다");
      if (doc.interactions.some((i) => i.id === id)) throw new OpError(`이미 있는 상호작용 id 입니다: ${id}`);
      if (!op.targetMapId || !op.targetId) throw new OpError("도착 페이지와 도착 포털이 필요합니다");
      place(ctx, "act.portal", x, y);
      doc.interactions.push({ id, type: "portal", x, y, targetMapId: String(op.targetMapId), targetId: String(op.targetId), label: op.label });
      ctx.summary.interactions++;
      return;
    }
    case "remove": {
      const o = doc.objects.find((x) => x.id === op.id);
      if (!o) throw new OpError(`오브젝트 ${op.id} 를 찾을 수 없습니다`);
      removeWhere(ctx, (x) => x.id === op.id);
      const linked = new Set(doc.interactions.filter((i) => i.x === o.x && i.y === o.y && i.type !== "portal").map((i) => i.id));
      if (getAsset(o.assetId)?.interaction === "portal") {
        for (const i of doc.interactions) if (i.type === "portal" && i.x === o.x && i.y === o.y) linked.add(i.id);
      }
      removeInteractionAndLinks(doc, linked);
      return;
    }
    case "move": {
      const o = doc.objects.find((x) => x.id === op.id);
      if (!o) throw new OpError(`오브젝트 ${op.id} 를 찾을 수 없습니다`);
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const err = canPlace(ctx, o.assetId, x, y, o.rot, o.id, o.scale ?? 1);
      if (err) throw new OpError(err);
      for (const i of doc.interactions) {
        if (i.x === o.x && i.y === o.y) {
          i.x = x;
          i.y = y;
        }
      }
      o.x = x;
      o.y = y;
      rebuildOcc(ctx);
      ctx.summary.moved++;
      return;
    }
    case "rotate": {
      const o = doc.objects.find((x) => x.id === op.id);
      if (!o) throw new OpError(`오브젝트 ${op.id} 를 찾을 수 없습니다`);
      if (![0, 90, 180, 270].includes(op.rot)) throw new OpError("회전은 0/90/180/270 만 가능합니다");
      const err = canPlace(ctx, o.assetId, o.x, o.y, op.rot, o.id, o.scale ?? 1);
      if (err) throw new OpError(err);
      o.rot = op.rot;
      rebuildOcc(ctx);
      return;
    }
    case "paint": {
      const t = getAsset(op.tileId);
      if (!t || t.kind !== "tile") throw new OpError(`카탈로그에 없는 바닥 타일입니다: ${op.tileId}`);
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const w = int(op.w ?? 1, "w");
      const h = int(op.h ?? 1, "h");
      rectCheck(doc, x, y, w, h, "칠하기 영역");
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setTile(doc, xx, yy, op.tileId);
      ctx.summary.painted += w * h;
      return;
    }
    case "clearRect": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const w = int(op.w, "w");
      const h = int(op.h, "h");
      rectCheck(doc, x, y, w, h, "지우기 영역");
      removeWhere(ctx, (o) => objectCells(o).some(([cx, cy]) => cx >= x && cy >= y && cx < x + w && cy < y + h));
      const ids = new Set(interactionsInRect(doc, x, y, w, h).map((i) => i.id));
      ctx.summary.interactions += ids.size;
      removeInteractionAndLinks(doc, ids);
      return;
    }
    case "line": {
      const x1 = int(op.x1, "x1");
      const y1 = int(op.y1, "y1");
      const x2 = int(op.x2, "x2");
      const y2 = int(op.y2, "y2");
      if (x1 !== x2 && y1 !== y2) throw new OpError("line 은 가로 또는 세로 직선만 지원합니다");
      const a = getAsset(op.assetId);
      if (!a) throw new OpError(`카탈로그에 없는 에셋입니다: ${op.assetId}`);
      const step = x1 === x2 ? a.footprint.d : a.footprint.w;
      if (x1 === x2) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += step) place(ctx, op.assetId, x1, y);
      else for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += step) place(ctx, op.assetId, x, y1);
      return;
    }
    case "scatter": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const w = int(op.w, "w");
      const h = int(op.h, "h");
      rectCheck(doc, x, y, w, h, "흩뿌리기 영역");
      if (!getAsset(op.assetId)) throw new OpError(`카탈로그에 없는 에셋입니다: ${op.assetId}`);
      const count = Math.min(int(op.count, "count"), w * h, 400);
      const rand = rng(op.seed ?? doc.nextId * 7919);
      let placed = 0;
      for (let tries = 0; placed < count && tries < count * 8; tries++) {
        const px = x + Math.floor(rand() * w);
        const py = y + Math.floor(rand() * h);
        if (px === doc.spawn.x && py === doc.spawn.y) continue;
        if (place(ctx, op.assetId, px, py, 0, false)) placed++;
      }
      return;
    }
    case "room": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const w = int(op.w, "w");
      const h = int(op.h, "h");
      if (w < 3 || h < 3) throw new OpError("방은 최소 3×3 이어야 합니다");
      rectCheck(doc, x, y, w, h, "방");
      const wallId = op.wallId ?? "wall.wood";
      const wall = getAsset(wallId);
      if (!wall || wall.kind !== "object") throw new OpError(`카탈로그에 없는 벽 에셋입니다: ${wallId}`);
      const floorId = op.floorId ?? "tile.wood";
      const floor = getAsset(floorId);
      if (!floor || floor.kind !== "tile") throw new OpError(`카탈로그에 없는 바닥 타일입니다: ${floorId}`);
      // 방 영역은 비우고 다시 짓는다 (기존 방 수정 요청을 단순하게 처리)
      removeWhere(ctx, (o) => objectCells(o).some(([cx, cy]) => cx >= x && cy >= y && cx < x + w && cy < y + h));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setTile(doc, xx, yy, floorId);
      const gaps = new Set<string>();
      const doors = op.doors && op.doors.length ? op.doors : [{ side: "S" as Side }];
      for (const d of doors) {
        const width = Math.max(1, Math.min(int(d.width ?? 2, "door.width"), 4));
        const horizontal = d.side === "N" || d.side === "S";
        const span = horizontal ? w - 2 : h - 2;
        const at = Math.max(1, Math.min(int(d.at ?? Math.floor((span - width) / 2) + 1, "door.at"), span - width + 1));
        for (let k = 0; k < width; k++) {
          if (d.side === "N") gaps.add(`${x + at + k},${y}`);
          else if (d.side === "S") gaps.add(`${x + at + k},${y + h - 1}`);
          else if (d.side === "W") gaps.add(`${x},${y + at + k}`);
          else if (d.side === "E") gaps.add(`${x + w - 1},${y + at + k}`);
          else throw new OpError(`문 방향은 N/S/E/W 중 하나여야 합니다`);
        }
      }
      for (let xx = x; xx < x + w; xx++) {
        for (const yy of [y, y + h - 1]) if (!gaps.has(`${xx},${yy}`)) place(ctx, wallId, xx, yy);
      }
      for (let yy = y + 1; yy < y + h - 1; yy++) {
        for (const xx of [x, x + w - 1]) if (!gaps.has(`${xx},${yy}`)) place(ctx, wallId, xx, yy);
      }
      if (op.name) upsertZone(ctx, { name: op.name, x: x + 1, y: y + 1, w: w - 2, h: h - 2 });
      return;
    }
    case "zone": {
      upsertZone(ctx, { ...op, x: int(op.x, "x"), y: int(op.y, "y"), w: int(op.w, "w"), h: int(op.h, "h") });
      return;
    }
    case "removeZone": {
      const before = doc.zones.length;
      doc.zones = doc.zones.filter((z) => z.id !== op.id);
      if (doc.zones.length === before) throw new OpError(`구역 ${op.id} 를 찾을 수 없습니다`);
      return;
    }
    case "sign": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      if (!String(op.text ?? "").trim()) throw new OpError("안내판 문구가 비어 있습니다");
      place(ctx, "act.sign", x, y);
      doc.interactions.push({ id: newId(doc, "i"), type: "sign", x, y, text: String(op.text).slice(0, 400) });
      ctx.summary.interactions++;
      return;
    }
    case "quiz": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      const choices = Array.isArray(op.choices) ? op.choices.map((c) => String(c).slice(0, 80)) : [];
      if (choices.length < 2 || choices.length > 5) throw new OpError("퀴즈 보기는 2~5개여야 합니다");
      const answer = int(op.answer, "answer");
      if (answer < 0 || answer >= choices.length) throw new OpError("퀴즈 정답 번호가 보기 범위를 벗어납니다");
      if (!String(op.question ?? "").trim()) throw new OpError("퀴즈 질문이 비어 있습니다");
      place(ctx, "act.quiz", x, y);
      doc.interactions.push({ id: newId(doc, "i"), type: "quiz", x, y, question: String(op.question).slice(0, 200), choices, answer });
      ctx.summary.interactions++;
      return;
    }
    case "portalPair": {
      const ax = int(op.a?.x, "a.x");
      const ay = int(op.a?.y, "a.y");
      const bx = int(op.b?.x, "b.x");
      const by = int(op.b?.y, "b.y");
      place(ctx, "act.portal", ax, ay);
      place(ctx, "act.portal", bx, by);
      const ia: Interaction = { id: newId(doc, "i"), type: "portal", x: ax, y: ay, label: op.label };
      const ib: Interaction = { id: newId(doc, "i"), type: "portal", x: bx, y: by, label: op.label };
      ia.targetId = ib.id;
      ib.targetId = ia.id;
      doc.interactions.push(ia, ib);
      ctx.summary.interactions += 2;
      return;
    }
    case "removeInteraction": {
      if (!doc.interactions.some((i) => i.id === op.id)) throw new OpError(`상호작용 ${op.id} 를 찾을 수 없습니다`);
      removeInteractionAndLinks(doc, new Set([op.id]));
      return;
    }
    case "editInteraction": {
      const i = doc.interactions.find((q) => q.id === op.id);
      if (!i) throw new OpError(`상호작용 ${op.id} 를 찾을 수 없습니다`);
      if (i.type === "sign" && op.text !== undefined) {
        if (!String(op.text).trim()) throw new OpError("안내판 문구가 비어 있습니다");
        i.text = String(op.text).slice(0, 400);
      }
      if (i.type === "quiz") {
        if (op.question !== undefined) i.question = String(op.question).slice(0, 200);
        if (op.choices !== undefined) i.choices = op.choices.map((c) => String(c).slice(0, 80));
        if (op.answer !== undefined) i.answer = int(op.answer, "answer");
        if (i.choices.length < 2 || i.choices.length > 5) throw new OpError("퀴즈 보기는 2~5개여야 합니다");
        if (i.answer < 0 || i.answer >= i.choices.length) throw new OpError("퀴즈 정답 번호가 보기 범위를 벗어납니다");
      }
      if (i.type === "portal") {
        if (op.label !== undefined) i.label = String(op.label).slice(0, 40);
        if (op.targetMapId !== undefined) {
          if (op.targetMapId) i.targetMapId = String(op.targetMapId);
          else delete i.targetMapId;
        }
      }
      return;
    }
    case "setSpawn": {
      const x = int(op.x, "x");
      const y = int(op.y, "y");
      if (!inBounds(doc, x, y)) throw new OpError("시작 위치가 맵 경계를 벗어납니다");
      doc.spawn = { x, y };
      return;
    }
    default:
      throw new OpError(`알 수 없는 작업입니다: ${(op as { op?: string }).op}`);
  }
}

function upsertZone(ctx: Ctx, z: { name: string; x: number; y: number; w: number; h: number; id?: string }) {
  const doc = ctx.doc;
  if (!String(z.name ?? "").trim()) throw new OpError("구역 이름이 비어 있습니다");
  rectCheck(doc, z.x, z.y, z.w, z.h, `구역 '${z.name}'`);
  const existing = doc.zones.find((q) => (z.id && q.id === z.id) || q.name === z.name);
  if (existing) Object.assign(existing, { name: z.name, x: z.x, y: z.y, w: z.w, h: z.h });
  else doc.zones.push({ id: newId(doc, "z"), name: String(z.name).slice(0, 40), x: z.x, y: z.y, w: z.w, h: z.h });
  ctx.summary.zones++;
}

export interface ApplyOptions {
  /** 에이전트 변경: 도달 불가 구역·상호작용도 오류로 처리 */
  strict?: boolean;
  maxOps?: number;
  /** 이 요청에서 쓸 수 있는 사용자(공방) 에셋 정의 (예: actor 의 보관함). 맵에 이미 내장된 정의가 우선 */
  extraAssets?: Record<string, EmbeddedAsset>;
}

/** 요청 범위: 보관함 정의 위에 맵 내장 정의를 덮어 맵 정의를 우선 */
export function assetScopeFor(doc: MapDoc, extra?: Record<string, EmbeddedAsset>) {
  if (!extra) return doc.assets;
  return doc.assets ? { ...extra, ...doc.assets } : extra;
}

export function applyOps(source: MapDoc, ops: unknown, opts: ApplyOptions = {}): ApplyResult {
  return withAssetScope(assetScopeFor(source, opts.extraAssets), () => applyOpsScoped(source, ops, opts));
}

function applyOpsScoped(source: MapDoc, ops: unknown, opts: ApplyOptions): ApplyResult {
  const summary = { added: 0, removed: 0, moved: 0, painted: 0, zones: 0, interactions: 0 };
  const fail = (message: string): ApplyResult => ({
    ok: false,
    doc: source,
    errors: [{ code: "op", message }],
    warnings: [],
    summary,
  });
  if (!Array.isArray(ops)) return fail("작업 목록(ops)이 배열이 아닙니다");
  if (ops.length === 0) return fail("적용할 작업이 없습니다");
  if (ops.length > (opts.maxOps ?? 600)) return fail(`작업이 너무 많습니다 (${ops.length}개)`);

  const ctx: Ctx = { doc: cloneMap(source), occ: new Int32Array(0), summary };
  rebuildOcc(ctx);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as MapOp;
    if (!op || typeof op !== "object" || !OP_NAMES.includes(op.op)) {
      return fail(`${i + 1}번째 작업 형식이 올바르지 않습니다`);
    }
    try {
      applyOne(ctx, op);
    } catch (e) {
      if (e instanceof OpError) return fail(`${i + 1}번째 작업(${op.op}): ${e.message}`);
      // 모델 출력의 null 필드 등 예상 못 한 형태도 원본을 보존하고 실패로 돌려준다
      return fail(`${i + 1}번째 작업(${op.op}) 형식이 올바르지 않습니다`);
    }
  }
  // 사용한 사용자 에셋 정의를 맵에 내장(이식·서버 검증용), 안 쓰는 정의는 제거
  const out = syncEmbeddedAssets(ctx.doc);
  const v = validateMap(out, { strict: opts.strict });
  if (v.errors.length) return { ok: false, doc: source, errors: v.errors, warnings: v.warnings, summary };
  return { ok: true, doc: out, errors: [], warnings: v.warnings, summary };
}
