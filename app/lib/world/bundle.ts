// 프로젝트 번들 내보내기/가져오기: 여러 페이지와 페이지 간 포털을 함께 옮긴다.
// 맵 한 장짜리 JSON(moa-world/map)도 계속 받는다. 가져올 때 맵 id 를 새로 매기고 포털 targetMapId 도 같이 바꾼다.
import { checkMapValue, IO_LIMITS, serializeMap } from "./io.ts";
import { cleanupOrphanPortals, type ProjectState } from "./project.ts";
import type { MapDoc } from "./types.ts";
import type { ValidationIssue } from "./validate.ts";

export const PROJECT_FORMAT = "moa-world/project";
export const PROJECT_VERSION = 1;
const MAX_PAGES = 50;
const MAX_BUNDLE_BYTES = IO_LIMITS.maxBytes * 10;

export function serializeProject(name: string, description: string, ps: ProjectState): string {
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    project: { name, description },
    maps: ps.order.map((id) => JSON.parse(serializeMap(ps.docs[id]))),
  });
}

export type BundleResult =
  | { ok: true; kind: "project" | "map"; name: string; description: string; ps: ProjectState; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[] };

/** 번들/맵 JSON → 새 id 를 받은 프로젝트 상태. newId 는 맵 id 생성기 */
export function parseBundle(text: string, newId: () => string): BundleResult {
  if (text.length > MAX_BUNDLE_BYTES) return { ok: false, errors: [{ code: "size", message: "파일이 너무 큽니다" }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: [{ code: "json", message: "JSON 형식이 아닙니다" }] };
  }
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const isProject = r.format === PROJECT_FORMAT;
  if (isProject && r.version !== PROJECT_VERSION) return { ok: false, errors: [{ code: "version", message: `지원하지 않는 프로젝트 버전입니다: ${String(r.version)}` }] };
  const rawMaps = isProject ? r.maps : [raw];
  if (!Array.isArray(rawMaps) || rawMaps.length === 0) return { ok: false, errors: [{ code: "maps", message: "페이지가 없습니다" }] };
  if (rawMaps.length > MAX_PAGES) return { ok: false, errors: [{ code: "maps", message: `페이지는 최대 ${MAX_PAGES}개까지 가져올 수 있어요` }] };

  const docs: MapDoc[] = [];
  const warnings: ValidationIssue[] = [];
  for (let i = 0; i < rawMaps.length; i++) {
    const v = checkMapValue(rawMaps[i]);
    if (!v.ok) return { ok: false, errors: v.errors.map((e) => ({ ...e, message: `${i + 1}번째 페이지: ${e.message}` })) };
    docs.push(v.doc);
    warnings.push(...v.warnings);
  }
  const ids = new Set(docs.map((d) => d.id));
  if (ids.size !== docs.length) return { ok: false, errors: [{ code: "ids", message: "페이지 id 가 중복됩니다" }] };

  // id 재매핑: 기존 맵을 덮어쓰지 않도록 모두 새 id
  const map = new Map(docs.map((d) => [d.id, newId()]));
  const remapped = docs.map((d) => ({
    ...d,
    id: map.get(d.id)!,
    interactions: d.interactions.map((it) => (it.type === "portal" && it.targetMapId ? { ...it, targetMapId: map.get(it.targetMapId) ?? `missing:${it.targetMapId}` } : it)),
  }));
  const ps0: ProjectState = { order: remapped.map((d) => d.id), docs: Object.fromEntries(remapped.map((d) => [d.id, d])) };
  // 번들 밖 페이지를 가리키던 포털은 정리(맵 한 장만 가져온 경우 등)
  const ps = cleanupOrphanPortals(ps0);
  const dropped = remapped.reduce((n, d) => n + d.interactions.length - ps.docs[d.id].interactions.length, 0);
  if (dropped) warnings.push({ code: "portal", message: `번들에 없는 페이지로 가는 포털 ${dropped}개를 정리했어요` });
  const proj = (r.project ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    kind: isProject ? "project" : "map",
    name: String(proj.name ?? docs[0].name ?? "가져온 스페이스").slice(0, 40),
    description: String(proj.description ?? "").slice(0, 200),
    ps,
    warnings,
  };
}
