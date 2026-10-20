"use client";

import { useEffect, useRef, useState } from "react";
import { loadViewAtlases } from "@/lib/render/atlas";
import { readView } from "@/lib/render/view-pref";
import { drawMiniMap } from "@/lib/render/minimap";
import { WorldRenderer } from "@/lib/render/renderer";
import { parseMapJson } from "@/lib/world/io";
import { SAMPLE_BUILDERS } from "@/lib/world/samples";
import {
  buildTemplate,
  createProject,
  deleteProject,
  importProjectFromMap,
  listProjects,
  loadMap,
  type TemplateKey,
} from "@/lib/world/storage";
import type { MapDoc, Project } from "@/lib/world/types";

/** 카드 썸네일: 실제 2.5D 렌더러로 맵 전체를 한 번 그린 뒤 캐시를 비운다 (아틀라스 로드 실패 시 미니맵) */
function MiniMap({ doc }: { doc: MapDoc | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !doc) return;
    let cancelled = false;
    const draw = () => {
      try {
        const r = new WorldRenderer(canvas, "low", view);
        r.resize();
        r.setDoc(doc);
        r.fitToMap(6);
        r.render({ mode: "edit", time: 0 });
        r.clearCaches();
      } catch {
        drawMiniMap(canvas, doc);
      }
    };
    const view = readView();
    void loadViewAtlases(view).then(() => {
      if (!cancelled) draw();
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);
  if (!doc) return <div className="card-thumb blank">＋</div>;
  return (
    <div className="card-thumb">
      <canvas ref={ref} aria-hidden="true" />
    </div>
  );
}

const TEMPLATES: Array<{ key: TemplateKey; name: string; description: string }> = [
  { key: "blank", name: "빈 맵", description: "잔디 40×30 맵에서 직접 만들기" },
  ...SAMPLE_BUILDERS.map((b) => ({ key: b.key as TemplateKey, name: b.name, description: b.description })),
];

function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(ts).toLocaleDateString("ko-KR");
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, MapDoc | null>>({});
  const [templatePreviews, setTemplatePreviews] = useState<Record<string, MapDoc>>({});
  const [naming, setNaming] = useState<{ key: TemplateKey; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = listProjects();
    setProjects(list);
    const p: Record<string, MapDoc | null> = {};
    for (const pr of list) p[pr.id] = loadMap(pr.mapIds[0]);
    setPreviews(p);
    const t: Record<string, MapDoc> = {};
    for (const b of SAMPLE_BUILDERS) t[b.key] = buildTemplate(b.key as TemplateKey, `preview-${b.key}`);
    setTemplatePreviews(t);
  }, []);

  function create() {
    if (!naming) return;
    try {
      const { project } = createProject(naming.name.trim() || "새 스페이스", naming.key);
      window.location.href = `/editor/${project.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "만들 수 없습니다");
    }
  }

  async function onImport(file: File) {
    const r = parseMapJson(await file.text());
    if (!r.ok) {
      setError(`가져오기 실패: ${r.errors.map((e) => e.message).join(", ")}`);
      return;
    }
    const p = importProjectFromMap(r.doc);
    window.location.href = `/editor/${p.id}`;
  }

  function remove(p: Project) {
    if (!window.confirm(`'${p.name}' 스페이스를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    deleteProject(p.id);
    setProjects(listProjects());
  }

  return (
    <main className="dash">
      <header className="dash-top">
        <div className="brand">
          <span className="brand-mark">모</span>
          모아 월드
        </div>
        <div className="row">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            JSON 가져오기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = "";
            }}
          />
          <button className="btn primary" onClick={() => setNaming({ key: "blank", name: "새 스페이스" })}>
            ＋ 새 스페이스
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <h1>
            말로 만들고,
            <br />
            바로 들어가 노는 맵
          </h1>
          <p>
            템플릿이나 빈 맵에서 시작해 에셋을 직접 배치하거나 “숲속 학교에 교실 세 개와 퀴즈 구역을 만들어 줘”처럼 요청하세요. 저장하고 바로
            입장해서 캐릭터로 걸어 다닐 수 있어요.
          </p>
        </div>
        <div className="hero-art">
          <MiniMap doc={templatePreviews.school ?? null} />
        </div>
      </section>

      <div className="section-title">
        <h2>템플릿으로 시작하기</h2>
      </div>
      <div className="grid-cards">
        {TEMPLATES.map((t) => (
          <article className="card" key={t.key}>
            <MiniMap doc={t.key === "blank" ? null : (templatePreviews[t.key] ?? null)} />
            <div className="card-body">
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <div className="card-actions">
                <button className="btn primary sm" onClick={() => setNaming({ key: t.key, name: t.key === "blank" ? "새 스페이스" : t.name })}>
                  이 템플릿으로 만들기
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="section-title">
        <h2>최근 작업</h2>
        <span className="chip">이 브라우저에 저장됨</span>
      </div>
      {projects === null ? null : projects.length === 0 ? (
        <div className="empty">아직 만든 스페이스가 없어요. 위 템플릿에서 시작해 보세요.</div>
      ) : (
        <div className="grid-cards">
          {projects.map((p) => (
            <article className="card" key={p.id} data-testid="project-card">
              <MiniMap doc={previews[p.id] ?? null} />
              <div className="card-body">
                <h3>{p.name}</h3>
                <p>
                  맵 {p.mapIds.length}개 · {timeAgo(p.updatedAt)} 수정
                </p>
                <div className="card-actions">
                  <a className="btn sm" href={`/editor/${p.id}`}>
                    편집
                  </a>
                  <a className="btn coral sm" href={`/play/${p.id}`}>
                    입장
                  </a>
                  <button className="btn ghost sm" onClick={() => remove(p)} aria-label={`${p.name} 삭제`}>
                    삭제
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {naming && (
        <div className="modal-back" onClick={() => setNaming(null)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-space-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setNaming(null);
            }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <h3 id="new-space-title">새 스페이스 만들기</h3>
            <div className="field">
              <label htmlFor="space-name">스페이스 이름</label>
              <input id="space-name" className="input" autoFocus value={naming.name} maxLength={40} onChange={(e) => setNaming({ ...naming, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="space-tpl">시작 맵</label>
              <select id="space-tpl" className="select" value={naming.key} onChange={(e) => setNaming({ ...naming, key: e.target.value as TemplateKey })}>
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setNaming(null)}>
                취소
              </button>
              <button type="submit" className="btn primary">
                만들고 편집하기
              </button>
            </div>
          </form>
        </div>
      )}
      {error && (
        <div className="toast err" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </main>
  );
}
