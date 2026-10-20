"use client";

import { useEffect, useRef, useState } from "react";
import { loadViewAtlases } from "@/lib/render/atlas";
import { applyAvatarLook } from "@/lib/render/avatar-look";
import { loadImagesFor } from "@/lib/render/user-images";
import type { AvatarLook } from "@/lib/server/workshop/avatar";
import { screenInputToGrid, type ViewMode } from "@/lib/render/projection";
import { readView, saveView, VIEW_LABEL } from "@/lib/render/view-pref";
import { QUALITY, type Quality } from "@/lib/render/constants";
import { FrameLoop } from "@/lib/render/loop";
import { WorldRenderer } from "@/lib/render/renderer";
import { AVATAR_COLORS } from "@/lib/render/shapes";
import { moveIso, walkFrame } from "@/lib/world/movement";
import { PlayWorld, type PlayerState } from "@/lib/world/play";
import { emptyScore, recordAnswer, type QuizScore } from "@/lib/world/quiz";
import { getProject, loadMap } from "@/lib/world/storage";
import type { Interaction, MapDoc, Project, QuizInteraction, SignInteraction } from "@/lib/world/types";

type Dialog = { kind: "sign"; i: SignInteraction } | { kind: "quiz"; i: QuizInteraction; picked: number | null };

interface PerfReport {
  view: ViewMode;
  quality: Quality;
  dpr: number;
  viewport: string;
  objects: number;
  mapSize: string;
  rafFps: number;
  renderMsAvg: number;
  renderMsP95: number;
  objectsDrawn: number;
  chunkCacheMB: number;
  spriteCacheMB: number;
  heapMB: number | null;
}

declare global {
  interface Window {
    __moaPerf?: () => PerfReport;
  }
}

const QUALITY_KEY = "moa.quality";

function readQuality(): Quality {
  try {
    const q = window.localStorage.getItem(QUALITY_KEY);
    if (q === "low" || q === "standard") return q;
  } catch {
    /* 저장소 없음 */
  }
  // 저사양 추정: 코어 4개 이하 또는 메모리 4GB 이하면 저전력 모드로 시작
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 ? "low" : "standard";
}

export default function Play({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [doc, setDoc] = useState<MapDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>("standard");
  const [near, setNear] = useState<Interaction | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [score, setScore] = useState<QuizScore>(emptyScore);
  const [showPerf, setShowPerf] = useState(false);
  const [perf, setPerf] = useState<PerfReport | null>(null);
  const [fading, setFading] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [view, setView] = useState<ViewMode>("td");
  /** 저장된 시점을 읽기 전에는 아틀라스를 불러오지 않는다(다른 시점 이미지 낭비 방지) */
  const [viewReady, setViewReady] = useState(false);
  const viewRef = useRef<ViewMode>("td");
  const followRef = useRef<((x: number, y: number) => { x: number; y: number }) | null>(null);
  /** 학생 프로필 외형(없으면 기본 탐험가) */
  const lookRef = useRef<AvatarLook | null>(null);
  const nameRef = useRef("나");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const joy = useRef({ x: 0, y: 0, id: -1 });
  const playerRef = useRef<PlayerState | null>(null);
  const worldRef = useRef<PlayWorld | null>(null);
  const dialogRef = useRef<Dialog | null>(null);
  const nearRef = useRef<Interaction | null>(null);
  const portalCooldown = useRef(0);
  const portalArmed = useRef(true);
  const arrivalRef = useRef<string | null>(null);
  const loopRef = useRef<FrameLoop | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  dialogRef.current = dialog;

  // 맵 로드
  useEffect(() => {
    const p = getProject(projectId);
    const mapId = new URLSearchParams(window.location.search).get("map") ?? p?.mapIds[0];
    const m = mapId ? loadMap(mapId) : null;
    if (!p || !m) {
      setError("스페이스나 맵을 찾을 수 없어요. 에디터에서 저장했는지 확인해 주세요.");
      return;
    }
    setProject(p);
    setDoc(m);
    setQuality(readQuality());
    // 학생이면 저장한 아바타 외형·별명 사용 (실패해도 기본 아바타로 플레이)
    fetch("/api/workshop/me")
      .then((r) => (r.ok ? (r.json() as Promise<{ role?: string; student?: { nickname: string; avatar: AvatarLook | null } }>) : null))
      .then((me) => {
        if (me?.role === "student" && me.student) {
          nameRef.current = me.student.nickname;
          lookRef.current = me.student.avatar;
          applyAvatarLook(lookRef.current);
        }
      })
      .catch(() => undefined);
    const v = readView();
    viewRef.current = v;
    setView(v);
    setViewReady(true);
    const t = window.setTimeout(() => setShowHint(false), 6000);
    return () => window.clearTimeout(t);
  }, [projectId]);

  // 게임 루프 (플레이 중에만 rAF)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const q = readQuality();
    const r = new WorldRenderer(canvas, q, viewRef.current);
    rendererRef.current = r;
    const world = new PlayWorld(doc);
    worldRef.current = world;
    // 다른 페이지 포털로 들어왔으면 도착 포털 옆에서, 아니면 시작점에서
    const arrival = arrivalRef.current;
    arrivalRef.current = null;
    playerRef.current = (arrival && world.portalExit(arrival)) || world.spawnState();
    // 도착 직후 바로 되돌아가지 않도록: 포털 칸을 한 번 벗어나야 다시 발동
    portalArmed.current = !arrival;
    r.resize();
    r.setDoc(doc);
    r.camera.zoom = window.innerWidth < 700 ? 0.8 : 1;
    // 카메라 목표: 발 위치를 화면에서 조금 위로(머리가 중앙 근처) 올린 셀 좌표
    const follow = (px: number, py: number) => {
      const s0 = r.projection.toScreen(px, py);
      const g = r.projection.toGround(s0.x, s0.y - 40);
      return r.clampToView(g.x, g.y);
    };
    followRef.current = follow;
    const start = follow(playerRef.current.x, playerRef.current.y);
    r.centerOn(start.x, start.y);
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(canvas);
    let lastStats = r.render({ mode: "play", time: 0 });
    let t = 0;
    let lastNearCheck = 0;

    const loop = new FrameLoop(QUALITY[q].fps, (dt, now) => {
      t += dt;
      const p = playerRef.current!;
      let ix = 0;
      let iy = 0;
      if (!dialogRef.current) {
        const k = keys.current;
        if (k.has("arrowleft") || k.has("a")) ix -= 1;
        if (k.has("arrowright") || k.has("d")) ix += 1;
        if (k.has("arrowup") || k.has("w")) iy -= 1;
        if (k.has("arrowdown") || k.has("s")) iy += 1;
        ix += joy.current.x;
        iy += joy.current.y;
      }
      // 입력은 화면 기준. 아이소는 화면 속도 일정 + 실제 이동 기준 8방향, 탑뷰는 기존 격자 이동
      const gin = screenInputToGrid("td", ix, iy);
      const next = viewRef.current === "iso" ? moveIso(world, p, ix, iy, dt) : world.step(p, gin.x, gin.y, dt);
      playerRef.current = next;

      // 포털: 밟으면 이동. 쿨다운 + 포털 칸을 벗어났다가 다시 밟아야 발동(도착 직후 되돌아감 방지)
      const portal = world.portalAt(next);
      if (!portal) portalArmed.current = true;
      if (portal && portal.type === "portal" && portalArmed.current && now > portalCooldown.current) {
        portalCooldown.current = now + 900;
        portalArmed.current = false;
        if (portal.targetMapId) {
          const target = loadMap(portal.targetMapId);
          if (target) {
            setFading(true);
            setTimeout(() => {
              arrivalRef.current = portal.targetId ?? null;
              window.history.replaceState(null, "", `/play/${projectId}?map=${target.id}`);
              setDoc(target);
              setFading(false);
            }, 220);
          }
        } else if (portal.targetId) {
          const exit = world.portalExit(portal.targetId);
          if (exit) teleport(exit);
        }
      }

      // 카메라: 부드럽게 따라가기
      const target = follow(next.x, next.y);
      const k = 1 - Math.pow(0.001, dt);
      r.camera.cx += (target.x - r.camera.cx) * k;
      r.camera.cy += (target.y - r.camera.cy) * k;

      if (now - lastNearCheck > 120) {
        lastNearCheck = now;
        const n = world.nearby(next);
        if (n?.id !== nearRef.current?.id) {
          nearRef.current = n;
          setNear(n);
        }
      }
      const n = nearRef.current;
      lastStats = r.render({
        mode: "play",
        time: t,
        player: {
          x: next.x,
          y: next.y,
          dir: next.dir,
          moving: next.moving,
          face8: next.face8,
          walkFrame: viewRef.current === "iso" ? walkFrame(next) : undefined,
          style: AVATAR_COLORS[0],
          name: nameRef.current,
        },
        nearInteraction: n && !dialogRef.current ? { x: n.x, y: n.y } : null,
      });
      return lastStats.frameMs;
    });
    loopRef.current = loop;
    loop.start();

    function teleport(exit: PlayerState) {
      setFading(true);
      setTimeout(() => {
        playerRef.current = exit;
        portalArmed.current = false;
        const c = follow(exit.x, exit.y);
        r.centerOn(c.x, c.y);
        setFading(false);
      }, 220);
    }

    window.__moaPerf = () => {
      const s = loop.sample();
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      const vp = r.viewport;
      const caches = r.cacheBytes;
      return {
        view: r.view,
        quality: r.quality,
        dpr: Math.min(window.devicePixelRatio || 1, QUALITY[r.quality].dprCap),
        viewport: `${Math.round(vp.w)}x${Math.round(vp.h)}`,
        objects: doc.objects.length,
        mapSize: `${doc.width}x${doc.height}`,
        rafFps: s.fps,
        renderMsAvg: s.frameMsAvg,
        renderMsP95: s.frameMsP95,
        objectsDrawn: lastStats.objectsDrawn,
        chunkCacheMB: +(caches.chunks / 1048576).toFixed(1),
        spriteCacheMB: +(caches.sprites / 1048576).toFixed(1),
        heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      };
    };
    const perfTimer = window.setInterval(() => setPerf(window.__moaPerf?.() ?? null), 1000);

    return () => {
      loop.stop();
      ro.disconnect();
      window.clearInterval(perfTimer);
      r.clearCaches();
      delete window.__moaPerf;
    };
  }, [doc, projectId]);

  // 시점 전환: 그 시점 아틀라스만 불러오고(다른 시점 해제) 카메라는 플레이어 기준 유지
  useEffect(() => {
    viewRef.current = view;
    const r = rendererRef.current;
    if (r) {
      r.setView(view);
      const p = playerRef.current;
      const f = followRef.current;
      if (p && f) {
        const c = f(p.x, p.y);
        r.centerOn(c.x, c.y);
      }
    }
    if (!viewReady) return;
    let alive = true;
    // 맵에 내장된 공방 에셋 그림도 현재 시점 것만 (권한 없으면 도형으로 대체)
    void Promise.all([loadViewAtlases(view), loadImagesFor(view, Object.keys(doc?.assets ?? {}))]).then(() => {
      if (!alive) return;
      applyAvatarLook(lookRef.current); // 시점 아틀라스를 새로 불러오면 외형 다시 적용
      rendererRef.current?.clearCaches();
    });
    return () => {
      alive = false;
    };
  }, [view, doc, viewReady]);

  // 품질 전환
  useEffect(() => {
    rendererRef.current?.setQuality(quality);
    loopRef.current?.setFps(QUALITY[quality].fps);
  }, [quality]);

  // 키보드
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (k === "escape") {
        setDialog(null);
        return;
      }
      if (k === " " || k === "e" || k === "enter") {
        interact();
        return;
      }
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  });

  function interact() {
    if (dialogRef.current) {
      if (dialogRef.current.kind === "sign" || dialogRef.current.picked !== null) setDialog(null);
      return;
    }
    const n = nearRef.current;
    if (!n) return;
    if (n.type === "sign") setDialog({ kind: "sign", i: n });
    else if (n.type === "quiz") setDialog({ kind: "quiz", i: n, picked: null });
  }

  function pick(k: number) {
    if (!dialog || dialog.kind !== "quiz" || dialog.picked !== null) return;
    setDialog({ ...dialog, picked: k });
    const id = dialog.i.id;
    const ok = k === dialog.i.answer;
    setScore((s) => recordAnswer(s, id, ok));
  }

  // 터치 조이스틱
  const onJoy = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.type === "pointerdown") {
      el.setPointerCapture(e.pointerId);
      joy.current.id = e.pointerId;
    }
    if (e.pointerId !== joy.current.id) return;
    if (e.type === "pointerup" || e.type === "pointercancel") {
      joy.current = { x: 0, y: 0, id: -1 };
      if (knobRef.current) knobRef.current.style.transform = "";
      return;
    }
    const rect = el.getBoundingClientRect();
    let dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    let dy = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    joy.current.x = Math.abs(dx) < 0.15 ? 0 : dx;
    joy.current.y = Math.abs(dy) < 0.15 ? 0 : dy;
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
  };

  if (error) {
    return (
      <main className="dash">
        <div className="empty">
          {error}
          <div style={{ marginTop: 12 }}>
            <a className="btn primary" href="/">
              대시보드로
            </a>
          </div>
        </div>
      </main>
    );
  }

  const quizCount = doc?.interactions.filter((i) => i.type === "quiz").length ?? 0;

  return (
    <main className="play">
      <canvas ref={canvasRef} data-testid="play-canvas" aria-label={`${doc?.name ?? ""} 플레이 화면`} />
      <div className="hud-top">
        <div className="hud-pill">
          <span>{project?.name}</span>
          <span style={{ opacity: 0.7, fontWeight: 600 }}>· {doc?.name}</span>
          <a className="hud-btn teal" href={`/editor/${projectId}${doc ? `?map=${doc.id}` : ""}`}>
            편집
          </a>
          <a className="hud-btn" href="/">
            나가기
          </a>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div className="hud-pill">
            {quizCount > 0 && (
              <span className="hud-score" data-testid="quiz-score">
                퀴즈 {score.correct.size}/{quizCount}
              </span>
            )}
            <button
              className="hud-btn"
              onClick={() => {
                const q = quality === "low" ? "standard" : "low";
                setQuality(q);
                try {
                  window.localStorage.setItem(QUALITY_KEY, q);
                } catch {
                  /* 무시 */
                }
              }}
              title="저전력 30fps · DPR 1 / 표준 60fps"
            >
              {quality === "low" ? "저전력 30fps" : "표준 60fps"}
            </button>
            <button
              className="hud-btn teal"
              onClick={() => {
                const v = view === "td" ? "iso" : "td";
                saveView(v);
                setView(v);
              }}
              title="탑뷰 / 아이소 시점 전환"
            >
              {VIEW_LABEL[view]}
            </button>
            <button className="hud-btn coral" onClick={() => setShowPerf((v) => !v)}>
              성능
            </button>
          </div>
          {showPerf && perf && (
            <div className="perf" data-testid="perf">
              {`rAF ${perf.rafFps} fps (목표 ${QUALITY[perf.quality].fps})
render CPU ${perf.renderMsAvg} ms · p95 ${perf.renderMsP95} ms
그린 오브젝트 ${perf.objectsDrawn}/${perf.objects}
시점 ${VIEW_LABEL[perf.view]} · 뷰포트 ${perf.viewport} · DPR ${perf.dpr} · 맵 ${perf.mapSize}
캐시 바닥 ${perf.chunkCacheMB}MB · 스프라이트 ${perf.spriteCacheMB}MB
JS heap ${perf.heapMB ?? "측정 불가"}${perf.heapMB !== null ? " MB" : ""}`}
            </div>
          )}
        </div>
      </div>

      <div className="joy" onPointerDown={onJoy} onPointerMove={onJoy} onPointerUp={onJoy} onPointerCancel={onJoy} aria-label="이동 조이스틱" role="application">
        <div className="joy-knob" ref={knobRef} />
      </div>
      <button className="act-btn" onClick={interact} disabled={!near && !dialog} aria-label="상호작용 (스페이스·E)">
        {dialog ? "닫기" : near?.type === "quiz" ? "퀴즈" : near?.type === "sign" ? "읽기" : "E"}
      </button>

      {dialog?.kind === "sign" && (
        <div className="dialog" role="dialog" aria-label="안내판">
          <h4>안내판</h4>
          <p>{dialog.i.text}</p>
          <button className="hud-btn teal" onClick={() => setDialog(null)}>
            닫기 (Esc)
          </button>
        </div>
      )}
      {dialog?.kind === "quiz" && (
        <div className="dialog" role="dialog" aria-label="퀴즈">
          <h4>퀴즈</h4>
          <p>{dialog.i.question}</p>
          <div className="choices">
            {dialog.i.choices.map((c, k) => (
              <button
                key={k}
                className={`choice ${dialog.picked !== null && k === dialog.i.answer ? "right" : ""} ${dialog.picked === k && k !== dialog.i.answer ? "wrong" : ""}`}
                onClick={() => pick(k)}
                disabled={dialog.picked !== null}
              >
                {k + 1}. {c}
              </button>
            ))}
          </div>
          {dialog.picked !== null && (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b style={{ color: dialog.picked === dialog.i.answer ? "var(--teal-d)" : "var(--coral)" }}>{dialog.picked === dialog.i.answer ? "정답이에요!" : "아쉬워요, 정답을 확인하세요"}</b>
              <button className="hud-btn teal" onClick={() => setDialog(null)}>
                닫기
              </button>
            </div>
          )}
        </div>
      )}
      <div className="fade" style={{ opacity: fading ? 1 : 0 }} />
      {showHint && (
        <div className="hint" style={{ top: 72, bottom: "auto" }}>
          WASD·방향키로 이동 · 스페이스/E 로 읽기·퀴즈 · 포털을 밟으면 순간이동
        </div>
      )}
    </main>
  );
}
