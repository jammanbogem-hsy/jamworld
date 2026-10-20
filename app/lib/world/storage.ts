// 브라우저 로컬 저장소(localStorage). 프로젝트 = 여러 맵을 가진 스페이스.
import { createMap } from "./map.ts";
import { parseMapJson, serializeMap } from "./io.ts";
import { SAMPLE_BUILDERS } from "./samples.ts";
import type { ProjectState } from "./project.ts";
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

/** 프로젝트의 모든 페이지를 읽어 편집 상태로 (읽을 수 없는 페이지는 순서에서 제외) */
export function loadProjectState(p: Project): ProjectState | null {
  const docs: Record<string, MapDoc> = {};
  const order: string[] = [];
  for (const id of p.mapIds) {
    const m = loadMap(id);
    if (m) {
      docs[id] = m;
      order.push(id);
    }
  }
  return order.length ? { order, docs } : null;
}

/**
 * 프로젝트 저장: 바뀐 페이지와 순서를 한 번에 쓴다. 중간에 실패(용량 초과 등)하면 이미 쓴 키를 이전 값으로 되돌린다.
 * 주의: localStorage 에는 트랜잭션이 없어 되돌리기는 best-effort 다(되돌리는 중 다시 실패하거나 탭이 닫히면
 * 일부 키만 바뀐 상태가 남을 수 있음). 서버 저장(D1 batch)으로 옮기면 진짜 원자 저장이 된다.
 * saved 는 마지막으로 저장한 상태(참조 비교로 바뀐 페이지만 쓴다).
 */
export function saveProjectState(project: Project, ps: ProjectState, saved: ProjectState | null): Project {
  const s = store();
  if (!s) throw new Error("이 브라우저에서는 저장소를 사용할 수 없습니다");
  const writes: Array<[string, string | null]> = [];
  for (const id of ps.order) if (!saved || saved.docs[id] !== ps.docs[id]) writes.push([MAP_KEY(id), serializeMap(ps.docs[id])]);
  for (const id of saved?.order ?? project.mapIds) if (!ps.order.includes(id)) writes.push([MAP_KEY(id), null]);
  const nextProject: Project = { ...project, mapIds: [...ps.order], updatedAt: Date.now() };
  const index = [nextProject, ...listProjects().filter((q) => q.id !== project.id)];
  writes.push([INDEX_KEY, JSON.stringify(index)]);
  const backup = writes.map(([k]) => [k, s.getItem(k)] as const);
  try {
    for (const [k, v] of writes) {
      if (v === null) s.removeItem(k);
      else s.setItem(k, v);
    }
  } catch (e) {
    for (const [k, v] of backup) {
      try {
        if (v === null) s.removeItem(k);
        else s.setItem(k, v);
      } catch {
        /* 복구 중 실패는 무시 */
      }
    }
    throw e;
  }
  return nextProject;
}

/** 가져온 번들(이미 새 id 를 받은 상태)을 새 스페이스로 저장 */
export function importProjectState(name: string, description: string, ps: ProjectState): Project {
  const now = Date.now();
  const project: Project = { id: newId("prj"), name: name || "가져온 스페이스", description: description || "JSON 에서 가져옴", mapIds: [...ps.order], createdAt: now, updatedAt: now };
  return saveProjectState(project, ps, null);
}
