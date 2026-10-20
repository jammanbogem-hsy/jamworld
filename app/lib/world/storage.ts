// 브라우저 로컬 저장소(localStorage). 프로젝트 = 여러 맵을 가진 스페이스.
import { createMap } from "./map.ts";
import { parseMapJson, serializeMap } from "./io.ts";
import { SAMPLE_BUILDERS } from "./samples.ts";
import type { MapDoc, Project } from "./types.ts";

const INDEX_KEY = "moa.projects.v1";
const MAP_KEY = (id: string) => `moa.map.v1.${id}`;

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function newId(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

export function listProjects(): Project[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(INDEX_KEY) ?? "[]");
    return Array.isArray(raw) ? (raw as Project[]).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function writeIndex(projects: Project[]) {
  store()?.setItem(INDEX_KEY, JSON.stringify(projects));
}

export function getProject(id: string): Project | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function saveProject(p: Project) {
  const all = listProjects().filter((q) => q.id !== p.id);
  writeIndex([{ ...p, updatedAt: Date.now() }, ...all]);
}

export function loadMap(id: string): MapDoc | null {
  const raw = store()?.getItem(MAP_KEY(id));
  if (!raw) return null;
  const r = parseMapJson(raw);
  return r.ok ? r.doc : null;
}

/** 저장 실패(용량 초과 등)는 예외로 알린다 */
export function saveMap(doc: MapDoc) {
  const s = store();
  if (!s) throw new Error("이 브라우저에서는 저장소를 사용할 수 없습니다");
  s.setItem(MAP_KEY(doc.id), serializeMap(doc));
}

export type TemplateKey = "blank" | (typeof SAMPLE_BUILDERS)[number]["key"];

export function buildTemplate(key: TemplateKey, mapId: string, name?: string): MapDoc {
  if (key === "blank") return createMap(mapId, name ?? "새 맵", 40, 30);
  const t = SAMPLE_BUILDERS.find((b) => b.key === key);
  if (!t) return createMap(mapId, name ?? "새 맵", 40, 30);
  const doc = t.build(mapId);
  if (name) doc.name = name;
  return doc;
}

export function createProject(name: string, template: TemplateKey): { project: Project; map: MapDoc } {
  const mapId = newId("map");
  const map = buildTemplate(template, mapId);
  const now = Date.now();
  const project: Project = {
    id: newId("prj"),
    name,
    description: template === "blank" ? "빈 맵에서 시작" : (SAMPLE_BUILDERS.find((b) => b.key === template)?.description ?? ""),
    mapIds: [mapId],
    createdAt: now,
    updatedAt: now,
  };
  saveMap(map);
  saveProject(project);
  return { project, map };
}

export function addMapToProject(projectId: string, template: TemplateKey, name: string): MapDoc {
  const p = getProject(projectId);
  if (!p) throw new Error("프로젝트를 찾을 수 없습니다");
  const map = buildTemplate(template, newId("map"), name);
  saveMap(map);
  saveProject({ ...p, mapIds: [...p.mapIds, map.id] });
  return map;
}

export function importProjectFromMap(doc: MapDoc): Project {
  const map = { ...doc, id: newId("map") };
  saveMap(map);
  const now = Date.now();
  const project: Project = { id: newId("prj"), name: map.name, description: "JSON 에서 가져옴", mapIds: [map.id], createdAt: now, updatedAt: now };
  saveProject(project);
  return project;
}

export function deleteProject(id: string) {
  const p = getProject(id);
  if (!p) return;
  for (const m of p.mapIds) store()?.removeItem(MAP_KEY(m));
  writeIndex(listProjects().filter((q) => q.id !== id));
}

export function projectMaps(p: Project): MapDoc[] {
  return p.mapIds.map((id) => loadMap(id)).filter((m): m is MapDoc => !!m);
}
