"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadViewAtlases } from "@/lib/render/atlas";
import type { ViewMode } from "@/lib/render/projection";
import { createRenderScheduler } from "@/lib/render/loop";
import { WorldRenderer, type Ghost, type SceneState } from "@/lib/render/renderer";
import { drawAssetThumb } from "@/lib/render/thumb";
import { readView, saveView, VIEW_LABEL } from "@/lib/render/view-pref";
import { CATALOG, CATEGORY_LABEL, footprintOf, getAsset, SCALE_MAX, SCALE_MIN, userAssets } from "@/lib/world/catalog";
import { loadImagesFor } from "@/lib/render/user-images";
import { registerLibrary, syncEmbeddedAssets, type LibraryLike } from "@/lib/world/user-assets";
import { diffCells } from "@/lib/world/diff";
import { History } from "@/lib/world/history";
import { parseBundle, serializeProject } from "@/lib/world/bundle";
import { serializeMap } from "@/lib/world/io";
import { inBounds, objectCells, occupancy } from "@/lib/world/map";
import { applyOps, type MapOp } from "@/lib/world/ops";
import {
  addPage,
  cleanupOrphanPortals,
  deletePage,
  duplicatePage,
  incomingPortals,
  linkPortals,
  movePage,
  projectDiffBytes,
  renamePage,
  validateProject,
  withDoc,
  type ProjectState,
} from "@/lib/world/project";
import { buildTemplate, getProject, loadProjectState, newId, saveProject, saveProjectState, type TemplateKey } from "@/lib/world/storage";
import type { AssetDef, MapDoc, Project, Rot } from "@/lib/world/types";
import { validateMap } from "@/lib/world/validate";
import AgentPanel, { type AgentLogEntry, type AgentProposal } from "./agent-panel";

type Tool = "select" | "place" | "paint" | "erase" | "zone" | "spawn";

const TOOLS: Array<{ id: Tool; label: string; key: string; hint: string }> = [
  { id: "select", label: "선택", key: "1", hint: "클릭해 선택, 끌어서 이동 · 빈 곳을 끌면 화면 이동 · Delete 삭제 · R 회전" },
  { id: "place", label: "배치", key: "2", hint: "왼쪽에서 에셋을 고르고 클릭해 배치 · R 회전 · 포털은 두 번 클릭해 한 쌍" },
  { id: "paint", label: "바닥", key: "3", hint: "바닥 타일을 고르고 클릭하거나 끌어서 칠하기" },
  { id: "erase", label: "지우기", key: "4", hint: "클릭해 오브젝트 지우기 · 끌어서 영역 지우기" },
  { id: "zone", label: "구역", key: "5", hint: "끌어서 이름 있는 구역 만들기 (에이전트가 '오른쪽 교실'처럼 부를 수 있어요)" },
  { id: "spawn", label: "시작점", key: "6", hint: "클릭해 플레이 시작 위치 지정" },
];

const CATEGORIES = ["all", "mine", ...Object.keys(CATEGORY_LABEL)] as const;

function AssetThumb({ asset, ready, view }: { asset: AssetDef; ready: number; view: ViewMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawAssetThumb(ref.current, asset.id, view);
  }, [asset.id, ready, view]);
  return <canvas ref={ref} aria-hidden="true" />;
}

interface Toast {
  text: string;
  err?: boolean;
}

interface Preview {
  doc: MapDoc;
  proposal: AgentProposal;
  highlight: { added: Set<string>; removed: Set<string> };
  stats: string;
  warnings: string[];
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  /** 프로젝트 전체 편집 상태(모든 페이지). 현재 페이지 = ps.docs[curId] */
  const [ps, setPsState] = useState<ProjectState | null>(null);
  const [curId, setCurId] = useState<string>("");
  /** 마지막으로 저장한 상태 (참조 비교로 변경 여부 판단) */
  const [saved, setSaved] = useState<ProjectState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const doc = ps?.docs[curId] ?? null;
  const dirty = !!ps && !!saved && (ps.order.join() !== saved.order.join() || ps.order.some((id) => ps.docs[id] !== saved.docs[id]));
  const [tool, setTool] = useState<Tool>("select");
  const [assetId, setAssetId] = useState("nature.tree");
  const [rot, setRot] = useState<Rot>(0);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"agent" | "props" | "check">("agent");
  const [toast, setToast] = useState<Toast | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [atlasReady, setAtlasReady] = useState(0);
  const [view, setViewState] = useState<ViewMode>("td");
  /** 저장된 시점을 읽기 전에는 아틀라스를 불러오지 않는다(다른 시점 이미지 낭비 방지) */
  const [viewReady, setViewReady] = useState(false);
  const [addMapOpen, setAddMapOpen] = useState(false);
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [xray, setXray] = useState(false);
  /** 포털 1단계에서 찍은 시작 지점 (페이지 이동해도 유지, 커밋 전까지 맵에는 아무것도 없음 → 고아 포털 없음) */
  const [pendingPortal, setPendingPortal] = useState<{ mapId: string; x: number; y: number } | null>(null);
  const [placeScale, setPlaceScale] = useState(1);
  const [pageMenu, setPageMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pageListOpen, setPageListOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const historyRef = useRef(new History<ProjectState>(80, 12 * 1024 * 1024, projectDiffBytes));
  const psRef = useRef<ProjectState | null>(null);
  const curIdRef = useRef("");
  const docRef = useRef<MapDoc | null>(null);
  const sceneRef = useRef<SceneState>({ mode: "edit", time: 0, showGrid: true, showZones: true });
  const schedRef = useRef<ReturnType<typeof createRenderScheduler> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    kind: "pan" | "rect" | "move" | "pinch";
    sx: number;
    sy: number;
    cam: { cx: number; cy: number };
    cell?: { x: number; y: number };
    objectId?: string;
    moved?: boolean;
    dist?: number;
    zoom?: number;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const spaceDown = useRef(false);

  const flash = useCallback((text: string, err = false) => {
    setToast({ text, err });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), err ? 4200 : 2200);
  }, []);

  // ---------- 로드 ----------
  useEffect(() => {
    const p = getProject(projectId);
    if (!p) {
      setLoadError("이 브라우저에서 스페이스를 찾을 수 없어요. 대시보드에서 다시 열어 주세요.");
      return;
    }
    const loaded = loadProjectState(p);
    if (!loaded) {
      setLoadError("맵 데이터를 읽을 수 없어요.");
      return;
    }
    const want = new URLSearchParams(window.location.search).get("map");
    const first = want && loaded.docs[want] ? want : loaded.order[0];
    setProject(p);
    psRef.current = loaded;
    curIdRef.current = first;
    docRef.current = loaded.docs[first];
    setPsState(loaded);
    setSaved(loaded);
    setCurId(first);
    setViewState(readView());
    setViewReady(true);
  }, [projectId]);

  // 학생이면 공방 보관함 에셋을 카탈로그에 등록 (서버가 권한 판정)
  const [libVersion, setLibVersion] = useState(0);
  useEffect(() => {
    fetch("/api/workshop/library")
      .then((r) => (r.ok ? (r.json() as Promise<{ assets: LibraryLike[] }>) : null))
      .then((d) => {
        if (d?.assets?.length) {
          registerLibrary(d.assets);
          setLibVersion((n) => n + 1);
        }
      })
      .catch(() => undefined);
  }, []);

  // 시점별 아틀라스만 불러오고 다른 시점 이미지는 해제 (사용자 에셋 그림도 현재 시점 것만)
  useEffect(() => {
    if (!viewReady) return;
    let alive = true;
    const userIds = userAssets().map((a) => a.id);
    void Promise.all([loadViewAtlases(view), loadImagesFor(view, userIds)]).then(() => {
      if (!alive) return;
      rendererRef.current?.clearCaches();
      schedRef.current?.request();
      setAtlasReady((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [view, viewReady, libVersion]);

  const changeView = (v: ViewMode) => {
    setViewState(v);
    saveView(v);
    const r = rendererRef.current;
    if (r) {
      r.setView(v);
      r.fitToMap();
      schedRef.current?.request();
    }
  };

  /** 편집 상태 교체(현재 페이지가 없어지면 첫 페이지로) */
  const setPs = useCallback((next: ProjectState, focus?: string) => {
    let id = focus && next.docs[focus] ? focus : curIdRef.current;
    if (!next.docs[id]) id = next.order[0];
    psRef.current = next;
    curIdRef.current = id;
    docRef.current = next.docs[id];
    setPsState(next);
    setCurId(id);
  }, []);

  /** 여러 페이지에 걸친 변경: 고아 포털 정리 후 한 단계로 undo 기록 */
  const commitPs = useCallback(
    (next: ProjectState, label: string, focus?: string) => {
      const prev = psRef.current;
      if (!prev) return false;
      const cleaned = cleanupOrphanPortals(next);
      historyRef.current.record(prev, label, cleaned, focus ?? curIdRef.current);
      setPs(cleaned, focus);
      return true;
    },
    [setPs],
  );

  /** 현재 페이지 편집은 이 함수로: 원자적 적용 + (다른 페이지 짝 포털 정리) + undo 기록 */
  const commit = useCallback(
    (ops: MapOp[], label: string) => {
      const cur = docRef.current;
      const prev = psRef.current;
      if (!cur || !prev) return false;
      const r = applyOps(cur, ops);
      if (!r.ok) {
        flash(r.errors[0]?.message ?? "적용할 수 없어요", true);
        return false;
      }
      // 공방 에셋을 쓰면 맵에 동작 정보를 내장(이식성), 안 쓰면 제거
      return commitPs(withDoc(prev, syncEmbeddedAssets(r.doc)), label);
    },
    [flash, commitPs],
  );

  // ---------- 렌더러 (문서가 처음 준비될 때 한 번 생성) ----------
  const hasDoc = doc !== null;
  useEffect(() => {
    const canvas = canvasRef.current;
    const doc = docRef.current;
    if (!canvas || !doc) return;
    const r = new WorldRenderer(canvas, "standard", readView());
    rendererRef.current = r;
    r.resize();
    r.setDoc(doc);
    r.fitToMap();
    const sched = createRenderScheduler(() => r.render({ ...sceneRef.current, time: performance.now() / 1000 }));
    schedRef.current = sched;
    const ro = new ResizeObserver(() => {
      r.resize();
      sched.request();
    });
    ro.observe(canvas);
    sched.request();
    return () => {
      ro.disconnect();
      sched.cancel();
      r.clearCaches();
      rendererRef.current = null;
    };
  }, [hasDoc]);

  // 문서·장면 상태가 바뀔 때만 다시 그림 (편집 화면은 rAF 루프 없음)
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !doc || !ps) return;
    const shown = preview ? preview.doc : doc;
    r.setDoc(shown);
    const portalTags = shown.interactions.flatMap((i) => {
      if (i.type !== "portal") return [];
      if (i.targetMapId) return [{ x: i.x, y: i.y, text: `→ ${ps.docs[i.targetMapId]?.name ?? "(없는 페이지)"}` }];
      return [{ x: i.x, y: i.y, text: "↔ 이 페이지" }];
    });
    sceneRef.current = {
      ...sceneRef.current,
      showGrid,
      xray,
      selectedId,
      highlight: preview?.highlight ?? null,
      portalTags,
      pendingPortal: pendingPortal && pendingPortal.mapId === doc.id ? { x: pendingPortal.x, y: pendingPortal.y, label: "시작 포털" } : null,
      portalLink: null,
    };
    schedRef.current?.request();
  }, [doc, ps, preview, showGrid, xray, selectedId, atlasReady, pendingPortal]);

  // 페이지가 바뀌면 렌더러 문서 교체 + 전체 보기
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !curId || !psRef.current) return;
    r.setDoc(psRef.current.docs[curId]);
    r.fitToMap();
    schedRef.current?.request();
    window.history.replaceState(null, "", `/editor/${projectId}?map=${curId}`);
  }, [curId, projectId]);

  // ---------- 저장 ----------
  const save = useCallback(() => {
    const cur = psRef.current;
    if (!cur || !project) return false;
    try {
      // 모든 페이지(포털 짝 포함)를 한 번에 저장, 실패하면 이전 값으로 되돌림
      const p = saveProjectState(project, cur, saved);
      setProject(p);
      setSaved(cur);
      flash("저장했어요");
      return true;
    } catch (e) {
      flash(`저장 실패: ${e instanceof Error ? e.message : "저장소 오류"}`, true);
      return false;
    }
  }, [project, saved, flash]);

  const saveAndPlay = useCallback(() => {
    if (preview) {
      flash("미리보기를 적용하거나 취소한 뒤 플레이할 수 있어요", true);
      return;
    }
    const cur = docRef.current;
    if (!cur) return;
    const v = validateMap(cur);
    const pv = psRef.current ? validateProject(psRef.current) : [];
    if (v.errors.length || pv.length) {
      flash(`플레이할 수 없어요: ${(v.errors[0] ?? pv[0]).message}`, true);
      setTab("check");
      return;
    }
    if (save()) window.location.href = `/play/${projectId}?map=${cur.id}`;
  }, [save, projectId, preview, flash]);

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  // ---------- undo/redo ----------
  const undo = useCallback(() => {
    const cur = psRef.current;
    if (!cur || preview) return;
    const e = historyRef.current.undo(cur);
    if (e) {
      setPs(e.doc, e.focus);
      setSelectedId(null);
      flash(`되돌림: ${e.label}`);
    }
  }, [preview, setPs, flash]);

  const redo = useCallback(() => {
    const cur = psRef.current;
    if (!cur || preview) return;
    const e = historyRef.current.redo(cur);
    if (e) {
      setPs(e.doc, e.focus);
      setSelectedId(null);
      flash(`다시 실행: ${e.label}`);
    }
  }, [preview, setPs, flash]);

  // ---------- 에이전트 미리보기 ----------
  const onProposal = useCallback(
    (p: AgentProposal): string | null => {
      const cur = docRef.current;
      if (!cur) return "맵이 없습니다";
      const r = applyOps(cur, p.ops, { strict: true });
      if (!r.ok) return r.errors.map((e) => e.message).slice(0, 3).join(" / ");
      const d = diffCells(cur, r.doc);
      setPreview({
        doc: r.doc,
        proposal: p,
        highlight: { added: d.added, removed: d.removed },
        stats: `오브젝트 +${d.objectsAdded} −${d.objectsRemoved} · 구역 ${r.doc.zones.length}개 · 상호작용 ${r.doc.interactions.length}개`,
        warnings: r.warnings.map((w) => w.message),
      });
      setSelectedId(null);
      return null;
    },
    [],
  );

  const applyPreview = () => {
    const prev = psRef.current;
    if (!preview || !prev) return;
    commitPs(withDoc(prev, preview.doc), `에이전트: ${preview.proposal.summary.slice(0, 24)}`);
    setPreview(null);
    setAgentLog((l) => [...l, { role: "agent", text: "적용했어요. 되돌리기(Ctrl+Z)로 취소할 수 있어요.", meta: ["적용됨"] }]);
  };

  const cancelPreview = () => {
    setPreview(null);
    setAgentLog((l) => [...l, { role: "agent", text: "변경안을 취소했어요. 맵은 그대로예요." }]);
  };

  // ---------- 캔버스 입력 ----------
  const canPlaceGhost = useCallback((id: string, x: number, y: number, r: Rot, scale = 1) => {
    const cur = docRef.current;
    const a = getAsset(id);
    if (!cur || !a) return false;
    if (a.kind === "tile") return inBounds(cur, x, y);
    const fp = footprintOf(a, r, scale);
    const occ = occupancy(cur);
    for (let dy = 0; dy < fp.d; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        if (!inBounds(cur, x + dx, y + dy) || occ[(y + dy) * cur.width + x + dx]) return false;
      }
    }
    return true;
  }, []);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const updateHover = (sx: number, sy: number) => {
    const r = rendererRef.current;
    const cur = docRef.current;
    if (!r || !cur) return;
    const c = r.screenToCell(sx, sy);
    const drag = dragRef.current;
    let ghost: Ghost | null = null;
    let hover: SceneState["hoverCell"] = inBounds(cur, c.x, c.y) ? c : null;
    if (drag?.kind === "rect" && drag.cell) {
      const x0 = Math.min(drag.cell.x, c.x);
      const y0 = Math.min(drag.cell.y, c.y);
      hover = { x: x0, y: y0, w: Math.abs(c.x - drag.cell.x) + 1, h: Math.abs(c.y - drag.cell.y) + 1 };
    } else if (!preview && (tool === "place" || tool === "paint") && inBounds(cur, c.x, c.y)) {
      const id = assetId;
      const a = getAsset(id);
      const sc = a && a.kind === "object" && !a.interaction ? placeScale : 1;
      if (a && ((tool === "paint") === (a.kind === "tile"))) ghost = { assetId: id, x: c.x, y: c.y, rot: a.interaction ? 0 : rot, valid: canPlaceGhost(id, c.x, c.y, a.interaction ? 0 : rot, sc), scale: sc };
    } else if (drag?.kind === "move" && drag.objectId) {
      const o = cur.objects.find((q) => q.id === drag.objectId);
      if (o) ghost = { assetId: o.assetId, x: c.x, y: c.y, rot: o.rot, valid: true, scale: o.scale };
    }
    const pp = pendingPortal;
    const portalLink = pp && pp.mapId === cur.id && tool === "place" && inBounds(cur, c.x, c.y) ? { from: pp, to: c } : null;
    sceneRef.current = { ...sceneRef.current, ghost, hoverCell: hover, portalLink };
    schedRef.current?.request();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    const cur = docRef.current;
    if (!r || !cur) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      dragRef.current = { kind: "pinch", sx: 0, sy: 0, cam: { ...r.camera }, dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: r.camera.zoom };
      return;
    }
    const c = r.screenToCell(p.x, p.y);
    const base = { sx: p.x, sy: p.y, cam: { cx: r.camera.cx, cy: r.camera.cy } };
    if (e.button === 1 || e.button === 2 || spaceDown.current || preview) {
      dragRef.current = { kind: "pan", ...base };
      return;
    }
    if (tool === "select") {
      const hit = r.pickObject(p.x, p.y);
      setSelectedId(hit?.id ?? null);
      if (hit) {
        setTab("props");
        dragRef.current = { kind: "move", ...base, objectId: hit.id, cell: c };
      } else dragRef.current = { kind: "pan", ...base };
      return;
    }
    if (tool === "paint" || tool === "zone" || tool === "erase") {
      dragRef.current = { kind: "rect", ...base, cell: c };
      updateHover(p.x, p.y);
      return;
    }
    if (!inBounds(cur, c.x, c.y)) return;
    if (tool === "spawn") {
      commit([{ op: "setSpawn", x: c.x, y: c.y }], "시작 위치");
      return;
    }
    if (tool === "place") {
      const a = getAsset(assetId);
      if (!a || a.kind !== "object") {
        flash("배치할 오브젝트를 왼쪽에서 골라 주세요", true);
        return;
      }
      if (a.interaction === "portal") {
        if (!canPlaceGhost(assetId, c.x, c.y, 0)) return flash("그 자리에는 포털을 놓을 수 없어요", true);
        if (!pendingPortal) {
          // 1단계: 시작 지점만 기억(맵은 그대로). 화면에 시작 포털·라벨·연결선이 보인다
          setPendingPortal({ mapId: cur.id, x: c.x, y: c.y });
          return;
        }
        if (pendingPortal.mapId === cur.id && pendingPortal.x === c.x && pendingPortal.y === c.y) {
          setPendingPortal(null);
          return;
        }
        // 2단계: 도착 지정과 동시에 양방향 한 쌍을 한 번에 커밋(페이지가 다르면 두 페이지 함께)
        const prev = psRef.current!;
        const r2 = linkPortals(prev, pendingPortal, { mapId: cur.id, x: c.x, y: c.y });
        if (!r2.ok) return flash(r2.error, true);
        const from = prev.docs[pendingPortal.mapId]?.name ?? "";
        commitPs(r2.ps, pendingPortal.mapId === cur.id ? "포털 한 쌍" : `포털 연결: ${from} ↔ ${cur.name}`);
        flash(pendingPortal.mapId === cur.id ? "포털 한 쌍을 연결했어요" : `'${from}' ↔ '${cur.name}' 포털을 연결했어요`);
        setPendingPortal(null);
        return;
      }
      if (a.interaction === "sign") {
        if (commit([{ op: "sign", x: c.x, y: c.y, text: "안내 문구를 입력하세요" }], "안내판")) {
          selectAt(c.x, c.y);
        }
        return;
      }
      if (a.interaction === "quiz") {
        if (commit([{ op: "quiz", x: c.x, y: c.y, question: "질문을 입력하세요", choices: ["보기 1", "보기 2", "보기 3"], answer: 0 }], "퀴즈판")) {
          selectAt(c.x, c.y);
        }
        return;
      }
      commit([{ op: "place", assetId, x: c.x, y: c.y, rot, ...(placeScale !== 1 ? { scale: placeScale } : {}) }], `${a.name} 배치${placeScale !== 1 ? ` ×${placeScale}` : ""}`);
    }
  };

  function selectAt(x: number, y: number) {
    const o = docRef.current?.objects.find((q) => objectCells(q).some(([cx, cy]) => cx === x && cy === y));
    if (o) {
      setSelectedId(o.id);
      setTab("props");
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    if (!r) return;
    const p = localPoint(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const d = dragRef.current;
    if (d?.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      r.camera.zoom = Math.max(0.2, Math.min(2.2, (d.zoom ?? 1) * (Math.hypot(a.x - b.x, a.y - b.y) / (d.dist || 1))));
      schedRef.current?.request();
      return;
    }
    if (d?.kind === "pan") {
      r.panFrom(d.cam, p.x - d.sx, p.y - d.sy);
      schedRef.current?.request();
      return;
    }
    if (d?.kind === "move" && Math.hypot(p.x - d.sx, p.y - d.sy) > 6) d.moved = true;
    updateHover(p.x, p.y);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    const cur = docRef.current;
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    dragRef.current = null;
    if (!r || !cur || !d) return;
    const p = localPoint(e);
    const c = r.screenToCell(p.x, p.y);
    if (d.kind === "move" && d.moved && d.objectId) {
      const o = cur.objects.find((q) => q.id === d.objectId);
      if (o && d.cell) {
        const nx = o.x + (c.x - d.cell.x);
        const ny = o.y + (c.y - d.cell.y);
        if (nx !== o.x || ny !== o.y) commit([{ op: "move", id: o.id, x: nx, y: ny }], "이동");
      }
    } else if (d.kind === "rect" && d.cell) {
      const x = Math.max(0, Math.min(d.cell.x, c.x));
      const y = Math.max(0, Math.min(d.cell.y, c.y));
      const x2 = Math.min(cur.width - 1, Math.max(d.cell.x, c.x));
      const y2 = Math.min(cur.height - 1, Math.max(d.cell.y, c.y));
      const w = x2 - x + 1;
      const h = y2 - y + 1;
      if (w >= 1 && h >= 1) {
        if (tool === "paint") {
          const a = getAsset(assetId);
          if (a?.kind !== "tile") flash("칠할 바닥 타일을 왼쪽 '바닥' 분류에서 골라 주세요", true);
          else commit([{ op: "paint", tileId: assetId, x, y, w, h }], `${a.name} 칠하기`);
        } else if (tool === "erase") {
          if (w === 1 && h === 1) {
            const hit = r.pickObject(p.x, p.y);
            if (hit) commit([{ op: "remove", id: hit.id }], "지우기");
          } else commit([{ op: "clearRect", x, y, w, h }], "영역 지우기");
        } else if (tool === "zone") {
          const n = cur.zones.length + 1;
          if (commit([{ op: "zone", name: `구역 ${n}`, x, y, w, h }], "구역 만들기")) {
            setTab("props");
            flash(`'구역 ${n}'을 만들었어요. 오른쪽에서 이름을 바꿀 수 있어요`);
          }
        }
      }
    }
    updateHover(p.x, p.y);
  };

  const onWheel = useCallback((e: WheelEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      r.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      r.panFrom(r.camera, -e.deltaX, 0);
    }
    schedRef.current?.request();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [onWheel, hasDoc]);

  // ---------- 키보드 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === " ") spaceDown.current = e.type === "keydown";
      if (e.type !== "keydown") return;
      const t = TOOLS.find((q) => q.key === e.key);
      if (t && !mod) setTool(t.id);
      if (e.key === "Escape") {
        setSelectedId(null);
        setPendingPortal(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        if (commit([{ op: "remove", id: selectedId }], "삭제")) setSelectedId(null);
      }
      if (e.key.toLowerCase() === "r" && !mod) {
        if (selectedId) {
          const o = docRef.current?.objects.find((q) => q.id === selectedId);
          if (o) commit([{ op: "rotate", id: o.id, rot: (((o.rot + 90) % 360) as Rot) }], "회전");
        } else setRot((r) => (((r + 90) % 360) as Rot));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [save, undo, redo, selectedId, commit]);

  // 시작 페이지가 되돌리기·삭제로 사라지면 대기 정리 (페이지 추가·전환으로는 취소되지 않음)
  useEffect(() => {
    if (pendingPortal && ps && !ps.docs[pendingPortal.mapId]) setPendingPortal(null);
  }, [ps, pendingPortal]);

  // 도구를 바꾸거나 포털이 아닌 에셋을 고르면 포털 대기 취소 (아직 맵에 아무것도 없으므로 고아 없음)
  useEffect(() => {
    if (tool !== "place" || getAsset(assetId)?.interaction !== "portal") setPendingPortal(null);
  }, [tool, assetId]);

  // ---------- 페이지(맵) 관리 ----------
  const switchMap = (id: string) => {
    if (id === curIdRef.current || !psRef.current?.docs[id]) return;
    setPreview(null);
    setSelectedId(null);
    setPageMenu(null);
    setPageListOpen(false);
    curIdRef.current = id;
    docRef.current = psRef.current.docs[id];
    setCurId(id);
  };

  const addMap = (template: TemplateKey, name: string) => {
    const prev = psRef.current;
    if (!prev) return;
    const m = buildTemplate(template, newId("map"), name);
    commitPs(addPage(prev, m, prev.order.indexOf(curIdRef.current) + 1), `페이지 추가: ${m.name}`, m.id);
    setAddMapOpen(false);
  };

  const pageAction = (id: string, action: "dup" | "left" | "right" | "delete") => {
    const prev = psRef.current;
    if (!prev) return;
    setPageMenu(null);
    const name = prev.docs[id]?.name ?? "";
    if (action === "dup") {
      const r = duplicatePage(prev, id, newId("map"));
      if (!r.ok) return flash(r.error, true);
      const nid = r.ps.order[r.ps.order.indexOf(id) + 1];
      commitPs(r.ps, `페이지 복제: ${name}`, nid);
    } else if (action === "left" || action === "right") {
      const next = movePage(prev, id, action === "left" ? -1 : 1);
      if (next !== prev) commitPs(next, `페이지 순서: ${name}`, id);
    } else {
      const incoming = incomingPortals(prev, id);
      const msg = incoming ? `'${name}' 페이지를 삭제할까요? 다른 페이지에서 이 페이지로 오는 포털 ${incoming}개도 함께 지워집니다. (되돌리기 가능)` : `'${name}' 페이지를 삭제할까요? (되돌리기 가능)`;
      if (!window.confirm(msg)) return;
      const r = deletePage(prev, id);
      if (!r.ok) return flash(r.error, true);
      commitPs(r.ps, `페이지 삭제: ${name}`);
    }
  };

  const commitRename = (id: string, name: string) => {
    setRenaming(null);
    const prev = psRef.current;
    if (!prev || prev.docs[id]?.name === name.trim()) return;
    const r = renamePage(prev, id, name);
    if (!r.ok) return flash(r.error, true);
    commitPs(r.ps, `페이지 이름: ${name.trim()}`, id);
  };

  /** 가져오기: 기존 페이지를 덮어쓰지 않고 새 id 의 페이지로 추가 (프로젝트 번들이면 페이지 간 포털 유지) */
  const importJson = async (file: File) => {
    const r = parseBundle(await file.text(), () => newId("map"));
    if (!r.ok) return flash(`가져오기 실패: ${r.errors[0]?.message}`, true);
    let next = psRef.current!;
    for (const id of r.ps.order) next = addPage(next, r.ps.docs[id]);
    commitPs(next, `가져오기: 페이지 ${r.ps.order.length}개`, r.ps.order[0]);
    if (r.warnings.some((w) => w.code === "portal")) flash(r.warnings.find((w) => w.code === "portal")!.message);
    flash("JSON 맵을 불러왔어요 (되돌리기 가능)");
  };

  // ---------- 파생 ----------
  const assets = useMemo(() => {
    const q = query.trim();
    const all = [...CATALOG, ...userAssets()];
    return all.filter(
      (a) =>
        (category === "all" || (category === "mine" ? a.source === "user" : a.category === category)) &&
        (!q || a.name.includes(q) || a.tags.some((t) => t.includes(q)) || a.id.includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query, libVersion]);

  const validation = useMemo(() => (doc ? validateMap(doc) : null), [doc]);
  const projectIssues = useMemo(() => (ps ? validateProject(ps) : []), [ps]);
  const selected = doc?.objects.find((o) => o.id === selectedId) ?? null;
  const selectedAsset = selected ? getAsset(selected.assetId) : null;
  const selectedInteraction = selected ? doc?.interactions.find((i) => i.x === selected.x && i.y === selected.y) : null;
  const history = historyRef.current;
  const pendingName = pendingPortal ? (ps?.docs[pendingPortal.mapId]?.name ?? "") : "";
  const hint = pendingPortal
    ? pendingPortal.mapId === curId
      ? "2단계: 도착 위치를 클릭하세요 · 다른 페이지로 연결하려면 아래 페이지 탭을 고르세요"
      : `2단계: '${pendingName}'의 시작 포털과 연결할 도착 위치를 이 페이지에서 클릭하세요`
    : preview ? "미리보기 중 — 오른쪽에서 적용 또는 취소 · 드래그로 화면 이동" : TOOLS.find((t) => t.id === tool)?.hint;

  if (loadError) {
    return (
      <main className="dash">
        <div className="empty">
          {loadError}
          <div style={{ marginTop: 12 }}>
            <a className="btn primary" href="/">
              대시보드로
            </a>
          </div>
        </div>
      </main>
    );
  }
  if (!doc || !project) return <main className="dash">불러오는 중…</main>;

  return (
    <div className="editor">
      <header className="ed-top">
        <a className="btn ghost icon" href="/" aria-label="대시보드" title="대시보드">
          ←
        </a>
        <span className="brand-mark" style={{ width: 28, height: 28, fontSize: 14 }}>
          모
        </span>
        <input
          className="ed-title"
          value={project.name}
          maxLength={40}
          aria-label="스페이스 이름"
          onChange={(e) => {
            const p = { ...project, name: e.target.value };
            setProject(p);
            saveProject(p);
          }}
        />
        <div className="sep" />
        <button className="btn icon sm" onClick={undo} disabled={!history.canUndo || !!preview} title="되돌리기 (Ctrl+Z)" aria-label="되돌리기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
        </button>
        <button className="btn icon sm" onClick={redo} disabled={!history.canRedo || !!preview} title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
        </button>
        <div className="sep" />
        <div className="seg" role="group" aria-label="시점">
          {(["td", "iso"] as const).map((v) => (
            <button key={v} className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => changeView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <div className="grow" />
        <a className="btn sm ghost hide-sm" href="/workshop" target="_blank" rel="noopener" title="새 탭에서 에셋 공방 열기 (편집 중인 내용은 그대로)">
          에셋 공방 ↗
        </a>
        <span className={`chip ${dirty ? "coral" : "teal"}`} data-testid="save-state">
          {dirty ? "저장 안 됨" : "저장됨"}
        </span>
        <button className="btn sm hide-sm" onClick={() => fileRef.current?.click()}>
          가져오기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = "";
          }}
        />
        <button className="btn sm hide-sm" title="모든 페이지와 페이지 간 포털을 함께 내보내기" onClick={() => download(`${project.name}.moa-project.json`, serializeProject(project.name, project.description, ps!))}>
          내보내기
        </button>
        <button className="btn sm" onClick={save} title="저장 (Ctrl+S)">
          저장
        </button>
        <button className="btn coral sm" onClick={saveAndPlay}>
          저장 후 플레이 ▶
        </button>
      </header>

      <aside className="ed-left">
        <div className="panel-head">
          <input className="input" placeholder="에셋 검색 (예: 나무, 교실)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="에셋 검색" />
          <div className="cat-tabs">
            {CATEGORIES.map((c) => (
              <button key={c} className={category === c ? "on" : ""} onClick={() => setCategory(c)}>
                {c === "all" ? "전체" : c === "mine" ? "내 에셋" : CATEGORY_LABEL[c as AssetDef["category"]]}
              </button>
            ))}
          </div>
        </div>
        <div className="asset-grid">
          {assets.map((a) => (
            <button
              key={a.id}
              className={`asset ${assetId === a.id && (tool === "place" || tool === "paint") ? "on" : ""}`}
              title={`${a.name} · ${a.footprint.w}×${a.footprint.d}${a.blocking ? " · 막힘" : ""}`}
              onClick={() => {
                setAssetId(a.id);
                setTool(a.kind === "tile" ? "paint" : "place");
                setPendingPortal(null);
              }}
            >
              <AssetThumb asset={a} ready={atlasReady} view={view} />
              {a.name}
            </button>
          ))}
        </div>
      </aside>

      <section className="ed-center">
        <canvas
          ref={canvasRef}
          data-testid="editor-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            dragRef.current = null;
          }}
          onPointerLeave={() => {
            sceneRef.current = { ...sceneRef.current, ghost: null, hoverCell: null };
            schedRef.current?.request();
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div className="toolbar" role="toolbar" aria-label="편집 도구">
          {TOOLS.map((t) => (
            <button key={t.id} className={`tool ${tool === t.id ? "on" : ""}`} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`} disabled={!!preview}>
              {t.label}
            </button>
          ))}
          {(tool === "place" || tool === "paint") && (
            <button className="tool" onClick={() => setRot((r) => (((r + 90) % 360) as Rot))} title="회전 (R)">
              ⟳ {rot}°
            </button>
          )}
          {tool === "place" && !getAsset(assetId)?.interaction && (
            <>
              <ScaleSelect value={placeScale} onChange={setPlaceScale} label="배치 크기" compact />
              {(() => {
                const a = getAsset(assetId);
                const fp = a ? footprintOf(a, rot, placeScale) : null;
                return fp ? <span className="tool" style={{ cursor: "default" }} title="실제로 차지하는 칸(충돌 동일)">{fp.w}×{fp.d}칸</span> : null;
              })()}
            </>
          )}
        </div>
        <div className="canvas-hud">
          <button className={`btn sm ${showGrid ? "" : "ghost"}`} onClick={() => setShowGrid((v) => !v)}>
            격자
          </button>
          <button className={`btn sm ${xray ? "primary" : ""}`} onClick={() => setXray((v) => !v)} title="높은 오브젝트를 반투명하게">
            투시
          </button>
          <button
            className="btn sm"
            onClick={() => {
              rendererRef.current?.fitToMap();
              schedRef.current?.request();
            }}
            title="맵 전체 보기"
          >
            전체 보기
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const r = rendererRef.current;
              if (r) {
                r.camera.zoom = Math.max(0.2, Math.min(2.2, r.camera.zoom * 1.2));
                schedRef.current?.request();
              }
            }}
            aria-label="확대"
          >
            ＋
          </button>
          <button
            className="btn sm"
            onClick={() => {
              const r = rendererRef.current;
              if (r) {
                r.camera.zoom = Math.max(0.2, r.camera.zoom / 1.2);
                schedRef.current?.request();
              }
            }}
            aria-label="축소"
          >
            －
          </button>
        </div>
        {hint && <div className="hint">{hint}</div>}
        <nav className="page-tabs" aria-label="페이지">
          {ps!.order.map((id, i) => {
            const m = ps!.docs[id];
            const portals = m.interactions.filter((q) => q.type === "portal" && q.targetMapId).length;
            return (
              <div key={id} className={`page-tab ${id === curId ? "on" : ""} ${pendingPortal?.mapId === id ? "pending" : ""}`}>
                {renaming === id ? (
                  <input
                    className="page-rename"
                    autoFocus
                    defaultValue={m.name}
                    maxLength={60}
                    aria-label="페이지 이름"
                    onBlur={(e) => commitRename(id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button className="page-name" onClick={() => switchMap(id)} onDoubleClick={() => setRenaming(id)} title={`${i + 1}. ${m.name} (두 번 클릭해 이름 변경)`}>
                    <span className="page-no">{i + 1}</span>
                    {m.name}
                    {portals > 0 && <span className="page-portal" title={`다른 페이지로 가는 포털 ${portals}개`}>⇄{portals}</span>}
                  </button>
                )}
                <button className="page-more" aria-label={`${m.name} 메뉴`} onClick={() => setPageMenu(pageMenu === id ? null : id)}>
                  ⋯
                </button>
                {pageMenu === id && (
                  <div className="page-menu" role="menu">
                    <button role="menuitem" onClick={() => { setPageMenu(null); setRenaming(id); }}>이름 변경</button>
                    <button role="menuitem" onClick={() => pageAction(id, "dup")}>복제</button>
                    <button role="menuitem" onClick={() => { setPageMenu(null); download(`${m.name}.moa.json`, serializeMap(m)); }}>이 페이지만 내보내기</button>
                    <button role="menuitem" disabled={i === 0} onClick={() => pageAction(id, "left")}>◀ 앞으로</button>
                    <button role="menuitem" disabled={i === ps!.order.length - 1} onClick={() => pageAction(id, "right")}>뒤로 ▶</button>
                    <button role="menuitem" className="danger" disabled={ps!.order.length <= 1} onClick={() => pageAction(id, "delete")}>삭제</button>
                  </div>
                )}
              </div>
            );
          })}
          <button className="page-add" onClick={() => setAddMapOpen(true)} aria-label="페이지 추가">
            ＋
          </button>
          <button className="page-list-btn" onClick={() => setPageListOpen((v) => !v)} aria-expanded={pageListOpen}>
            목록 {ps!.order.length}
          </button>
          {pageListOpen && (
            <div className="page-list" role="menu">
              {ps!.order.map((id, i) => (
                <button key={id} role="menuitem" className={id === curId ? "on" : ""} onClick={() => switchMap(id)}>
                  <span className="page-no">{i + 1}</span> {ps!.docs[id].name}
                  <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>
                    오브젝트 {ps!.docs[id].objects.length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>
      </section>

      <aside className="ed-right">
        {pendingPortal && (
          <div className="portal-banner" role="status" data-testid="portal-pending">
            <span className="chip coral">포털 2단계</span>
            <span>
              시작: <b>{pendingName}</b> ({pendingPortal.x}, {pendingPortal.y}) → {pendingPortal.mapId === curId ? "이 페이지나 다른 페이지 탭에서 도착 위치를 클릭" : <>이 페이지(<b>{doc.name}</b>)에서 도착 위치를 클릭</>}
            </span>
            {pendingPortal.mapId !== curId && (
              <button className="btn sm" onClick={() => switchMap(pendingPortal.mapId)}>
                시작 페이지 보기
              </button>
            )}
            <button className="btn sm" onClick={() => setPendingPortal(null)}>
              취소 (Esc)
            </button>
          </div>
        )}
        <div className="tabs" role="tablist">
          {(
            [
              ["agent", "에이전트"],
              ["props", "속성"],
              ["check", `검사${validation && (validation.errors.length || validation.warnings.length) ? ` (${validation.errors.length + validation.warnings.length})` : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {preview && (
          <div style={{ padding: "12px 14px 0" }}>
            <div className="preview-bar" data-testid="agent-preview">
              <b>변경 미리보기</b>
              <div style={{ fontSize: 13 }}>{preview.proposal.summary}</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                <span className={`chip ${preview.proposal.provider === "demo" ? "warn" : "teal"}`}>
                  {preview.proposal.provider === "demo" ? "데모 (규칙 기반)" : `${preview.proposal.provider} · ${preview.proposal.model}`}
                </span>
                <span className="chip">{preview.stats}</span>
              </div>
              {preview.warnings.slice(0, 3).map((w) => (
                <div key={w} className="issue warn">
                  {w}
                </div>
              ))}
              <div className="row">
                <button className="btn primary" style={{ flex: 1 }} onClick={applyPreview}>
                  적용
                </button>
                <button className="btn" style={{ flex: 1 }} onClick={cancelPreview}>
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "agent" && <AgentPanel doc={doc} disabled={!!preview} onProposal={onProposal} log={agentLog} setLog={setAgentLog} />}

        {tab === "props" && (
          <div className="tab-body">
            {selected && selectedAsset ? (
              <>
                <h3 style={{ margin: 0 }}>{selectedAsset.name}</h3>
                <dl className="kv">
                  <dt>위치</dt>
                  <dd>
                    ({selected.x}, {selected.y})
                  </dd>
                  <dt>크기</dt>
                  <dd>
                    {footprintOf(selectedAsset, selected.rot, selected.scale ?? 1).w}×{footprintOf(selectedAsset, selected.rot, selected.scale ?? 1).d} 칸 (충돌 동일)
                  </dd>
                  <dt>회전</dt>
                  <dd>{selected.rot}°</dd>
                  <dt>크기</dt>
                  <dd>
                    {selectedAsset.interaction ? (
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>상호작용 오브젝트는 1배</span>
                    ) : (
                      <span className="row" style={{ gap: 6 }}>
                        <ScaleSelect
                          value={selected.scale ?? 1}
                          onChange={(v) => commit([{ op: "scale", id: selected.id, scale: v }], `크기 ×${v}`)}
                          label={`${selectedAsset.name} 크기`}
                        />
                        {(selected.scale ?? 1) !== 1 && (
                          <button className="btn sm" onClick={() => commit([{ op: "scale", id: selected.id, scale: 1 }], "크기 ×1")}>
                            1배로
                          </button>
                        )}
                      </span>
                    )}
                  </dd>
                  <dt>충돌</dt>
                  <dd>{selectedAsset.blocking ? "막힘" : "지나갈 수 있음"}</dd>
                  <dt>에셋</dt>
                  <dd style={{ fontSize: 12, color: "var(--ink-2)" }}>
                    {selectedAsset.id} · {selectedAsset.source === "codex" ? "Codex 아틀라스" : "도형"}
                  </dd>
                </dl>
                <div className="row">
                  <button className="btn sm" onClick={() => commit([{ op: "rotate", id: selected.id, rot: (((selected.rot + 90) % 360) as Rot) }], "회전")}>
                    회전 (R)
                  </button>
                  <button
                    className="btn sm"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      if (commit([{ op: "remove", id: selected.id }], "삭제")) setSelectedId(null);
                    }}
                  >
                    삭제 (Del)
                  </button>
                </div>
                {selectedInteraction && (
                  <InteractionEditor
                    key={selectedInteraction.id}
                    interaction={selectedInteraction}
                    ps={ps!}
                    commit={commit}
                    onJump={(mapId, x, y) => {
                      switchMap(mapId);
                      const o = psRef.current?.docs[mapId]?.objects.find((q) => q.x === x && q.y === y);
                      if (o) setSelectedId(o.id);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="map-name">맵 이름</label>
                  <input
                    id="map-name"
                    key={doc.id + doc.name}
                    className="input"
                    defaultValue={doc.name}
                    maxLength={60}
                    onBlur={(e) => commitRename(doc.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </div>
                <dl className="kv">
                  <dt>크기</dt>
                  <dd>
                    {doc.width}×{doc.height} 칸
                  </dd>
                  <dt>시작 위치</dt>
                  <dd>
                    ({doc.spawn.x}, {doc.spawn.y})
                  </dd>
                  <dt>오브젝트</dt>
                  <dd>{doc.objects.length}개</dd>
                </dl>
                <div>
                  <b style={{ fontSize: 13 }}>구역 ({doc.zones.length})</b>
                  {doc.zones.length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>‘구역’ 도구로 끌어서 만들거나 에이전트에게 요청하세요.</p>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {doc.zones.map((z) => (
                      <div key={z.id} className="row">
                        <input
                          className="input"
                          defaultValue={z.name}
                          aria-label={`${z.name} 이름`}
                          onBlur={(e) => {
                            const name = e.target.value.trim();
                            if (name && name !== z.name) commit([{ op: "zone", id: z.id, name, x: z.x, y: z.y, w: z.w, h: z.h }], "구역 이름");
                          }}
                        />
                        <button className="btn sm ghost" onClick={() => commit([{ op: "removeZone", id: z.id }], "구역 삭제")} aria-label={`${z.name} 삭제`}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6 }}>
                  단축키: 1~6 도구 · R 회전 · Del 삭제 · Ctrl+Z/Ctrl+Shift+Z · Ctrl+S 저장 · 스페이스+드래그·휠로 화면 이동/확대
                </p>
              </>
            )}
          </div>
        )}

        {tab === "check" && validation && (
          <div className="tab-body">
            {projectIssues.map((e, i) => (
              <div key={`p${i}`} className="issue err">
                {e.message}
              </div>
            ))}
            {validation.errors.length === 0 && validation.warnings.length === 0 && projectIssues.length === 0 && <div className="issue ok">문제 없음 — 시작 위치에서 모든 구역과 상호작용에 갈 수 있어요.</div>}
            {validation.errors.map((e, i) => (
              <div key={`e${i}`} className="issue err">
                {e.message}
              </div>
            ))}
            {validation.warnings.map((e, i) => (
              <div key={`w${i}`} className="issue warn">
                {e.message}
              </div>
            ))}
            <dl className="kv">
              <dt>오브젝트</dt>
              <dd>{doc.objects.length}</dd>
              <dt>구역</dt>
              <dd>{doc.zones.length}</dd>
              <dt>상호작용</dt>
              <dd>{doc.interactions.length}</dd>
            </dl>
          </div>
        )}
      </aside>

      {addMapOpen && <AddMapModal onClose={() => setAddMapOpen(false)} onAdd={addMap} />}
      {toast && (
        <div className={`toast ${toast.err ? "err" : ""}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function InteractionEditor({
  interaction: i,
  ps,
  commit,
  onJump,
}: {
  interaction: MapDoc["interactions"][number];
  ps: ProjectState;
  commit: (ops: MapOp[], label: string) => boolean;
  onJump: (mapId: string, x: number, y: number) => void;
}) {
  const [text, setText] = useState(i.type === "sign" ? i.text : "");
  const [question, setQuestion] = useState(i.type === "quiz" ? i.question : "");
  const [choices, setChoices] = useState(i.type === "quiz" ? i.choices.join("\n") : "");
  const [answer, setAnswer] = useState(i.type === "quiz" ? i.answer : 0);
  if (i.type === "sign") {
    return (
      <div className="field">
        <label htmlFor="sign-text">안내판 문구</label>
        <textarea id="sign-text" className="textarea" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary sm" onClick={() => commit([{ op: "editInteraction", id: i.id, text }], "안내판 문구")}>
          문구 저장
        </button>
      </div>
    );
  }
  if (i.type === "quiz") {
    const list = choices.split("\n").map((c) => c.trim()).filter(Boolean);
    return (
      <>
        <div className="field">
          <label htmlFor="quiz-q">퀴즈 질문</label>
          <input id="quiz-q" className="input" value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="quiz-c">보기 (한 줄에 하나, 2~5개)</label>
          <textarea id="quiz-c" className="textarea" value={choices} onChange={(e) => setChoices(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="quiz-a">정답</label>
          <select id="quiz-a" className="select" value={answer} onChange={(e) => setAnswer(Number(e.target.value))}>
            {list.map((c, k) => (
              <option key={k} value={k}>
                {k + 1}. {c}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary sm" onClick={() => commit([{ op: "editInteraction", id: i.id, question, choices: list, answer }], "퀴즈 수정")}>
          퀴즈 저장
        </button>
      </>
    );
  }
  // 포털: 도착 페이지·위치 표시와 바로 가기
  const targetMap = i.targetMapId ? ps.docs[i.targetMapId] : null;
  const partner = i.targetId ? (targetMap ?? null)?.interactions.find((q) => q.id === i.targetId) ?? (i.targetMapId ? null : undefined) : null;
  return (
    <div className="field" data-testid="portal-props">
      <label>포털 도착지</label>
      <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
        {i.targetMapId ? (
          <>
            다른 페이지 <b>{targetMap?.name ?? "(없는 페이지)"}</b>
            {partner ? ` · 도착 포털 (${partner.x}, ${partner.y})` : " · 시작 위치"}
          </>
        ) : (
          <>같은 페이지의 짝 포털로 이동</>
        )}
      </div>
      {i.targetMapId && targetMap && (
        <button className="btn sm" onClick={() => onJump(i.targetMapId!, partner?.x ?? -1, partner?.y ?? -1)}>
          도착 페이지로 가기 →
        </button>
      )}
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>포털을 지우면 짝 포털도 함께 지워집니다(되돌리기 가능).</p>
    </div>
  );
}

const SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].filter((v) => v >= SCALE_MIN && v <= SCALE_MAX);

function ScaleSelect({ value, onChange, label, compact }: { value: number; onChange: (v: number) => void; label: string; compact?: boolean }) {
  return (
    <select
      className={compact ? "tool-select" : "select"}
      style={compact ? undefined : { height: 30, padding: "0 8px", width: "auto" }}
      value={value}
      aria-label={label}
      title="크기 배율 (점유 칸·충돌도 함께 바뀜)"
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {SCALES.map((v) => (
        <option key={v} value={v}>
          {compact ? `크기 ×${v}` : `×${v}`}
        </option>
      ))}
    </select>
  );
}

function AddMapModal({ onClose, onAdd }: { onClose: () => void; onAdd: (t: TemplateKey, name: string) => void }) {
  const [name, setName] = useState("새 맵");
  const [tpl, setTpl] = useState<TemplateKey>("blank");
  return (
    <div className="modal-back" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-map-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          onAdd(tpl, name.trim() || "새 맵");
        }}
      >
        <h3 id="add-map-title">맵 추가</h3>
        <div className="field">
          <label htmlFor="new-map-name">맵 이름</label>
          <input id="new-map-name" className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-map-tpl">템플릿</label>
          <select id="new-map-tpl" className="select" value={tpl} onChange={(e) => setTpl(e.target.value as TemplateKey)}>
            <option value="blank">빈 맵</option>
            <option value="forest">숲속 광장</option>
            <option value="school">모아 학교</option>
          </select>
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn primary">
            추가
          </button>
        </div>
      </form>
    </div>
  );
}
