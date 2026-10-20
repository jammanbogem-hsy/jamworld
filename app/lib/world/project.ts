// 프로젝트(여러 페이지=맵) 단위 편집 상태. 페이지 간 포털처럼 두 맵을 함께 바꾸는 변경을 원자적으로 다룬다.
// 바뀌지 않은 맵은 같은 참조를 유지해 undo 스냅샷 비용과 저장 대상을 줄인다.
import { estimateDocBytes } from "./history.ts";
import { cloneMap } from "./map.ts";
import { applyOps, type MapOp } from "./ops.ts";
import type { MapDoc, PortalInteraction } from "./types.ts";
import type { ValidationIssue } from "./validate.ts";

export interface ProjectState {
  order: string[];
  docs: Readonly<Record<string, MapDoc>>;
}

export type PsResult = { ok: true; ps: ProjectState } | { ok: false; error: string };

export interface PortalEnd {
  mapId: string;
  x: number;
  y: number;
}

export function withDoc(ps: ProjectState, doc: MapDoc): ProjectState {
  return { order: ps.order, docs: { ...ps.docs, [doc.id]: doc } };
}

/** undo 스냅샷 비용: 이웃 상태와 참조가 다른 맵만 센다 */
export function projectDiffBytes(a: ProjectState, b: ProjectState) {
  let n = 64 + a.order.length * 16;
  for (const id of a.order) if (a.docs[id] && a.docs[id] !== b.docs[id]) n += estimateDocBytes(a.docs[id]);
  return n;
}

function portalId() {
  return `pt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 두 지점을 포털 한 쌍으로 연결. 같은 페이지면 portalPair, 다른 페이지면 양쪽 맵에 portalTo 를 함께 적용.
 * 한쪽이라도 실패하면 아무것도 바꾸지 않는다.
 */
export function linkPortals(ps: ProjectState, a: PortalEnd, b: PortalEnd, label = "포털", ids: [string, string] = [portalId(), portalId()]): PsResult {
  const da = ps.docs[a.mapId];
  const db = ps.docs[b.mapId];
  if (!da || !db) return { ok: false, error: "페이지를 찾을 수 없습니다" };
  if (a.mapId === b.mapId) {
    if (a.x === b.x && a.y === b.y) return { ok: false, error: "시작과 도착이 같은 칸입니다" };
    const r = applyOps(da, [{ op: "portalPair", a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, label }]);
    return r.ok ? { ok: true, ps: withDoc(ps, r.doc) } : { ok: false, error: r.errors[0]?.message ?? "포털을 놓을 수 없습니다" };
  }
  const [ia, ib] = ids;
  const ra = applyOps(da, [{ op: "portalTo", x: a.x, y: a.y, id: ia, targetMapId: b.mapId, targetId: ib, label }]);
  if (!ra.ok) return { ok: false, error: `시작 페이지: ${ra.errors[0]?.message}` };
  const rb = applyOps(db, [{ op: "portalTo", x: b.x, y: b.y, id: ib, targetMapId: a.mapId, targetId: ia, label }]);
  if (!rb.ok) return { ok: false, error: `도착 페이지: ${rb.errors[0]?.message}` };
  return { ok: true, ps: withDoc(withDoc(ps, ra.doc), rb.doc) };
}

function crossTargetValid(ps: ProjectState, p: PortalInteraction) {
  if (!p.targetMapId) return true;
  const t = ps.docs[p.targetMapId];
  if (!t) return false;
  if (!p.targetId) return true; // 예전 형식: 도착 맵 시작점으로
  const q = t.interactions.find((i) => i.id === p.targetId);
  return !!q && q.type === "portal";
}

/** 짝을 잃은 페이지 간 포털(대상 페이지 삭제·도착 포털 삭제)을 포털 오브젝트까지 함께 정리한다 */
export function cleanupOrphanPortals(ps: ProjectState): ProjectState {
  let next = ps;
  for (const id of ps.order) {
    const doc = next.docs[id];
    if (!doc) continue;
    const orphans = doc.interactions.filter((i): i is PortalInteraction => i.type === "portal" && !!i.targetMapId && !crossTargetValid(next, i));
    if (!orphans.length) continue;
    const ops = orphans.flatMap((p): MapOp[] => {
      const obj = doc.objects.find((o) => o.assetId === "act.portal" && o.x === p.x && o.y === p.y);
      return obj ? [{ op: "remove" as const, id: obj.id }] : [{ op: "removeInteraction" as const, id: p.id }];
    });
    const r = applyOps(doc, ops);
    if (r.ok) next = withDoc(next, r.doc);
    else {
      // 오브젝트 제거가 막히면 상호작용만이라도 제거
      const d = cloneMap(doc);
      d.interactions = d.interactions.filter((i) => !orphans.some((o) => o.id === i.id));
      next = withDoc(next, d);
    }
  }
  return next;
}

/** 페이지 간 포털 무결성 (맵 단위 검증과 별개) */
export function validateProject(ps: ProjectState): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const id of ps.order) {
    const doc = ps.docs[id];
    if (!doc) {
      out.push({ code: "page", message: `페이지 ${id} 데이터가 없습니다` });
      continue;
    }
    for (const i of doc.interactions) {
      if (i.type !== "portal" || !i.targetMapId) continue;
      if (!crossTargetValid(ps, i)) out.push({ code: "portal", message: `'${doc.name}' 의 포털(${i.x},${i.y}) 도착 페이지나 도착 포털이 없습니다` });
    }
  }
  return out;
}

export function addPage(ps: ProjectState, doc: MapDoc, index = ps.order.length): ProjectState {
  const order = [...ps.order];
  order.splice(index, 0, doc.id);
  return { order, docs: { ...ps.docs, [doc.id]: doc } };
}

export function renamePage(ps: ProjectState, id: string, name: string): PsResult {
  const doc = ps.docs[id];
  const n = name.trim().slice(0, 60);
  if (!doc) return { ok: false, error: "페이지를 찾을 수 없습니다" };
  if (!n) return { ok: false, error: "페이지 이름이 비어 있습니다" };
  return { ok: true, ps: withDoc(ps, { ...doc, name: n }) };
}

/** 페이지 복제: 같은 페이지 안의 포털 쌍은 그대로, 다른 페이지로 가는 포털은 한쪽 방향으로 남는다 */
export function duplicatePage(ps: ProjectState, id: string, newId: string): PsResult {
  const doc = ps.docs[id];
  if (!doc) return { ok: false, error: "페이지를 찾을 수 없습니다" };
  const copy = { ...cloneMap(doc), id: newId, name: `${doc.name} 복사본`.slice(0, 60) };
  return { ok: true, ps: addPage(ps, copy, ps.order.indexOf(id) + 1) };
}

export function movePage(ps: ProjectState, id: string, delta: number): ProjectState {
  const i = ps.order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ps.order.length) return ps;
  const order = [...ps.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { order, docs: ps.docs };
}

/** 페이지 삭제: 이 페이지로 오는 다른 페이지의 포털도 함께 정리 */
export function deletePage(ps: ProjectState, id: string): PsResult {
  if (ps.order.length <= 1) return { ok: false, error: "마지막 페이지는 삭제할 수 없습니다" };
  if (!ps.docs[id]) return { ok: false, error: "페이지를 찾을 수 없습니다" };
  const docs = { ...ps.docs };
  delete docs[id];
  return { ok: true, ps: cleanupOrphanPortals({ order: ps.order.filter((x) => x !== id), docs }) };
}

/** 이 페이지로 들어오는 포털 수 (삭제 확인용) */
export function incomingPortals(ps: ProjectState, id: string) {
  let n = 0;
  for (const mid of ps.order) {
    if (mid === id) continue;
    n += ps.docs[mid]?.interactions.filter((i) => i.type === "portal" && i.targetMapId === id).length ?? 0;
  }
  return n;
}
