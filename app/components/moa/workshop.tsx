"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR_COLORS, COLOR_HSL, COLOR_KO, DEFAULT_LOOK, type AvatarLook } from "@/lib/server/workshop/avatar";
import { ASSET_CATEGORIES, CATEGORY_KO, STATUS_LABEL, type RequestDraft, type RequestStatus } from "@/lib/server/workshop/types";
import AvatarPreview from "./avatar-preview";
import { api, ApiError, getMe, runGenerate, type LibraryAsset, type Me, type RequestView } from "./workshop-api";

const EMPTY_DRAFT: RequestDraft = { name: "", description: "", category: "furniture", tags: [], footprint: { w: 1, d: 1 }, passable: false, height: 1 };

const STATUS_CHIP: Record<RequestStatus, string> = {
  draft: "",
  pending: "warn",
  rejected: "coral",
  approved: "teal",
  generating: "teal",
  generated: "teal",
  failed: "coral",
  saved: "teal",
  discarded: "",
};

/** 승인 전 안내용: medium 1024² 출력 약 439 토큰 × gpt-image-2.5-flare 출력 단가 $30/1M (요금표 2026-10-20). 실제 금액은 생성 후 usage 로 계산 */
const EST_OUTPUT_USD = (439 * 30) / 1_000_000;

const hsl = ([h, s, l]: [number, number, number]) => `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
const timeText = (t: number) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function useToast() {
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(null);
  const show = useCallback((text: string, err = false) => {
    setToast({ text, err });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), err ? 4500 : 2500);
  }, []);
  const node = toast ? (
    <div className={`toast ${toast.err ? "err" : ""}`} role="status">
      {toast.text}
    </div>
  ) : null;
  return { show, node };
}

/** 탭이 보일 때만 주기적으로 실행 */
function useVisiblePoll(fn: () => void, ms: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (!document.hidden) fn();
    }, ms);
    return () => window.clearInterval(id);
  }, [fn, ms, active]);
}

export default function Workshop() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    getMe()
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오지 못했어요"));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <main className="dash"><div className="empty">{error}</div></main>;
  if (!me) return <main className="dash">불러오는 중…</main>;
  return (
    <main className="dash ws">
      <header className="dash-top">
        <a className="brand" href="/">
          <span className="brand-mark">모</span>
          에셋 공방
        </a>
        <nav className="row">
          <a className="btn sm ghost" href="/">내 월드</a>
          {me.role === "student" && <span className="chip teal">{me.student!.className} · {me.student!.nickname}</span>}
          {me.role === "teacher" && <span className="chip teal">교사 {me.teacher!.name}</span>}
          {me.role === "student" && (
            <button className="btn sm" onClick={() => api("/api/workshop/logout", { method: "POST", json: {} }).then(() => (window.location.href = "/workshop"))}>
              나가기
            </button>
          )}
        </nav>
      </header>
      {!me.status.db && <div className="issue err">서버 저장소(D1/R2)가 연결되지 않아 공방을 쓸 수 없어요.</div>}
      {me.role === "student" && <StudentHome me={me} onMe={reload} />}
      {me.role === "teacher" && <TeacherHome me={me} />}
      {me.role === "pending-teacher" && (
        <div className="empty">
          <b>{me.identity?.name}</b> 님은 아직 허용된 교사로 등록되지 않았어요. 학교 관리자에게 교사 등록(허용 목록 추가)을 요청해 주세요.
        </div>
      )}
      {me.role === null && <Landing />}
    </main>
  );
}

function Landing() {
  const [code, setCode] = useState("");
  return (
    <div className="ws-landing">
      <section className="card ws-pad">
        <h2>학생</h2>
        <p>선생님께 받은 초대 링크로 들어오세요. 링크 끝의 코드를 붙여 넣어도 돼요.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            const token = code.trim().split("/join/").pop()?.trim();
            if (token) window.location.href = `/join/${encodeURIComponent(token)}`;
          }}
        >
          <input className="input" placeholder="초대 링크 또는 코드" value={code} onChange={(e) => setCode(e.target.value)} aria-label="초대 링크 또는 코드" />
          <button className="btn primary">들어가기</button>
        </form>
      </section>
      <section className="card ws-pad">
        <h2>선생님</h2>
        <p>Sites 로그인으로 들어오세요. 허용된 교사만 학급을 만들고 요청을 승인할 수 있어요.</p>
        <a className="btn coral" href="/signin-with-chatgpt?return_to=/workshop" target="_top">
          교사 로그인
        </a>
      </section>
    </div>
  );
}

// ======================= 학생 =======================

function StudentHome({ me, onMe }: { me: Me; onMe: () => void }) {
  const [tab, setTab] = useState<"studio" | "library" | "avatar">(() => {
    const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    return t === "avatar" || t === "library" ? t : "studio";
  });
  return (
    <>
      <div className="tabs ws-tabs" role="tablist">
        {(
          [
            ["studio", "공방"],
            ["library", "내 에셋 보관함"],
            ["avatar", "내 아바타"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {/* 탭을 바꿔도 대화·작성 중 카드가 사라지지 않도록 마운트 유지 */}
      <div hidden={tab !== "studio"}>
        <Studio me={me} />
      </div>
      <div hidden={tab !== "library"}>{tab === "library" && <Library />}</div>
      <div hidden={tab !== "avatar"}>
        <AvatarEditor initial={me.student!.avatar ?? DEFAULT_LOOK} onSaved={onMe} />
      </div>
    </>
  );
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  model?: string;
}

function Studio({ me }: { me: Me }) {
  const { show, node } = useToast();
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; draft: RequestDraft }>({ id: null, draft: EMPTY_DRAFT });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [chatProvider, setChatProvider] = useState<"openai" | "anthropic">("openai");
  const [pendingCard, setPendingCard] = useState<RequestDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ requests: RequestView[] }>("/api/workshop/requests")
      .then((r) => setRequests(r.requests))
      .catch((e) => show(e.message, true));
  }, [show]);
  useEffect(load, [load]);
  const waiting = requests.some((r) => ["pending", "approved", "generating"].includes(r.status));
  useVisiblePoll(load, 8000, waiting);

  const current = editing.id ? requests.find((r) => r.id === editing.id) ?? null : null;
  const editable = !current || current.status === "draft" || current.status === "rejected";

  const send = async () => {
    const t = text.trim();
    if (!t || thinking) return;
    const next = [...turns, { role: "user" as const, text: t }];
    setTurns(next);
    setText("");
    setThinking(true);
    try {
      const r = await api<{ reply: string; card: RequestDraft | null; model: string }>("/api/workshop/assist", {
        method: "POST",
        json: { turns: next.map(({ role, text }) => ({ role, text })), provider: chatProvider },
      });
      setTurns((x) => [...x, { role: "assistant", text: r.reply, model: r.model }]);
      if (r.card) setPendingCard(r.card);
    } catch (e) {
      setTurns((x) => [...x, { role: "assistant", text: e instanceof Error ? e.message : "도우미가 답하지 못했어요" }]);
    } finally {
      setThinking(false);
    }
  };

  const saveDraft = async (): Promise<RequestView | null> => {
    setBusy(true);
    try {
      if (!editing.id) {
        const r = await api<{ request: RequestView }>("/api/workshop/requests", { method: "POST", json: { draft: editing.draft } });
        setEditing({ id: r.request.id, draft: r.request.draft });
        load();
        show("초안을 저장했어요");
        return r.request;
      }
      const r = await api<{ request: RequestView }>(`/api/workshop/requests/${editing.id}`, { method: "PATCH", json: { rev: current?.rev, draft: editing.draft } });
      setEditing({ id: r.request.id, draft: r.request.draft });
      load();
      show("초안을 저장했어요");
      return r.request;
    } catch (e) {
      show(e instanceof Error ? e.message : "저장하지 못했어요", true);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    let req = current;
    if (!req) req = await saveDraft();
    if (!req) return;
    if (file.size > 4 * 1024 * 1024) return show("그림 파일은 4MB 이하만 올릴 수 있어요", true);
    setBusy(true);
    try {
      await api(`/api/workshop/requests/${req.id}/upload?rev=${req.rev}`, { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
      load();
      show("그림을 첨부했어요");
    } catch (e) {
      show(e instanceof Error ? e.message : "올리지 못했어요", true);
    } finally {
      setBusy(false);
    }
  };

  const act = async (r: RequestView, action: string, msg: string) => {
    setBusy(true);
    try {
      await api(`/api/workshop/requests/${r.id}/action`, { method: "POST", json: { action, rev: r.rev } });
      load();
      show(msg);
    } catch (e) {
      show(e instanceof Error ? e.message : "처리하지 못했어요", true);
      load();
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const r = await saveDraft();
    if (r) await act(r, "submit", "선생님께 요청했어요. 승인되면 그림을 만들어요");
  };

  return (
    <div className="ws-studio">
      <section className="card ws-chat" aria-label="공방 도우미 대화">
        <div className="row ws-chat-head">
          <b style={{ fontSize: 13 }}>공방 도우미</b>
          <select className="select" style={{ width: "auto", height: 30, padding: "0 8px", marginLeft: "auto" }} value={chatProvider} onChange={(e) => setChatProvider(e.target.value as "openai" | "anthropic")} aria-label="대화 모델">
            <option value="openai">OpenAI gpt-6-luna (기본)</option>
            <option value="anthropic">Anthropic claude-sonnet-5-5</option>
          </select>
        </div>
        <div className="ws-chat-log">
          <div className="msg agent">무엇을 만들고 싶나요? 예) “교실에 놓을 무지개색 책장”, “용암처럼 빛나는 바닥”. 생각을 말해 주면 제작 카드를 같이 채워 줄게요. 그림만 그려서 올려도 돼요.</div>
          {turns.map((t, i) => (
            <div key={i} className={`msg ${t.role === "user" ? "user" : "agent"}`}>
              {t.text}
              {t.model && (
                <div className="meta">
                  <span className="chip teal">{t.model}</span>
                </div>
              )}
            </div>
          ))}
          {thinking && <div className="msg agent">생각하는 중…</div>}
          {pendingCard && (
            <div className="preview-bar">
              <b>도우미가 제안한 카드</b>
              <div style={{ fontSize: 13 }}>
                {pendingCard.name} · {CATEGORY_KO[pendingCard.category]} · {pendingCard.tags.join(", ")}
              </div>
              <div className="row">
                <button
                  className="btn primary sm"
                  disabled={!editable}
                  onClick={() => {
                    setEditing((e) => ({ ...e, draft: pendingCard }));
                    setPendingCard(null);
                  }}
                >
                  카드에 넣기
                </button>
                <button className="btn sm" onClick={() => setPendingCard(null)}>
                  닫기
                </button>
              </div>
            </div>
          )}
        </div>
        <form
          className="ws-chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea className="textarea" value={text} maxLength={800} placeholder="만들고 싶은 것을 말해 주세요" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
          <button className="btn primary" disabled={!text.trim() || thinking}>
            보내기
          </button>
        </form>
      </section>

      <section className="ws-right">
        <div className="card ws-pad">
          <div className="section-title">
            <h2>{editing.id ? "제작 카드" : "새 제작 카드"}</h2>
            {current && (
              <span className={`chip ${STATUS_CHIP[current.status]}`}>
                {STATUS_LABEL[current.status]} · v{current.version}
              </span>
            )}
          </div>
          {current?.status === "rejected" && <div className="issue warn">선생님 의견: {current.rejectReason} — 고쳐서 다시 요청할 수 있어요.</div>}
          <DraftForm draft={editing.draft} onChange={(d) => setEditing((e) => ({ ...e, draft: d }))} disabled={!editable || busy} />
          <div className="row" style={{ flexWrap: "wrap", marginTop: 10 }}>
            <button className="btn sm" disabled={!editable || busy} onClick={() => fileRef.current?.click()}>
              그림 첨부
            </button>
            {current?.uploadUrl && <img className="ws-thumb" src={current.uploadUrl} alt="첨부한 그림" />}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <div className="grow" style={{ flex: 1 }} />
            <button className="btn sm" disabled={!editable || busy} onClick={() => void saveDraft()}>
              초안 저장
            </button>
            <button className="btn primary sm" disabled={!editable || busy || !editing.draft.name || !editing.draft.tags.length} onClick={() => void submit()}>
              선생님께 요청
            </button>
          </div>
          <p className="ws-note">{editing.draft.category === "terrain" ? "바닥은 이어 붙는 정사각 텍스처 1장으로 만들고, 탑뷰·아이소에 같은 무늬로 투영돼요." : "승인되면 탑뷰·아이소 그림 2장을 만들어요."} {editing.draft.category === "character" && "인물은 배치용 정지 그림이에요(걷는 플레이 아바타가 아님)."} {editing.draft.category === "interactive" && "그림만 만들어요. 포털·퀴즈 기능은 편집기에서 따로 지정해요."}</p>
          {editing.id && (
            <button className="btn ghost sm" onClick={() => setEditing({ id: null, draft: EMPTY_DRAFT })}>
              ＋ 새 카드
            </button>
          )}
        </div>

        <div className="card ws-pad">
          <div className="section-title">
            <h2>내 요청</h2>
            <button className="btn ghost sm" onClick={load}>
              새로고침
            </button>
          </div>
          {requests.length === 0 && <div className="empty">아직 요청이 없어요.</div>}
          <div className="ws-list">
            {requests.map((r) => (
              <div key={r.id} className={`ws-item ${r.id === editing.id ? "on" : ""}`}>
                <button className="ws-item-main" onClick={() => setEditing({ id: r.id, draft: r.draft })}>
                  <b>{r.draft.name}</b>
                  <span className={`chip ${STATUS_CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  <span className="ws-meta">{CATEGORY_KO[r.draft.category]} · {timeText(r.updatedAt)}</span>
                </button>
                {r.status === "pending" && (
                  <button className="btn sm" disabled={busy} onClick={() => void act(r, "withdraw", "요청을 회수했어요. 고친 뒤 다시 요청하세요")}>
                    회수
                  </button>
                )}
                {(r.status === "approved" || r.status === "generating") && <span className="ws-meta">선생님이 그림을 만드는 중이에요</span>}
                {r.status === "failed" && <span className="ws-meta">{r.generation?.error ?? "생성 실패"} — 선생님이 다시 시도할 수 있어요</span>}
                {r.status === "generated" && r.generation?.outputs && (
                  <div className="ws-result">
                    <ResultViews outputs={r.generation.outputs} />
                    <div className="row">
                      <button className="btn primary sm" disabled={busy} onClick={() => void act(r, "save", "내 에셋 보관함에 저장했어요")}>
                        내 에셋에 저장
                      </button>
                      <button className="btn sm" disabled={busy} onClick={() => void act(r, "discard", "저장하지 않았어요")}>
                        저장하지 않기
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      {node}
      <span hidden>{me.student?.id}</span>
    </div>
  );
}

function DraftForm({ draft, onChange, disabled }: { draft: RequestDraft; onChange: (d: RequestDraft) => void; disabled: boolean }) {
  const set = (p: Partial<RequestDraft>) => onChange({ ...draft, ...p });
  const terrain = draft.category === "terrain";
  return (
    <fieldset className="ws-form" disabled={disabled}>
      <div className="field">
        <label htmlFor="d-name">이름</label>
        <input id="d-name" className="input" maxLength={30} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="예) 무지개 책장" />
      </div>
      <div className="field">
        <label htmlFor="d-desc">설명 (색·모양·재료)</label>
        <textarea id="d-desc" className="textarea" maxLength={300} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="ws-grid2">
        <div className="field">
          <label htmlFor="d-cat">분류</label>
          <select id="d-cat" className="select" value={draft.category} onChange={(e) => set({ category: e.target.value as RequestDraft["category"] })}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_KO[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-tags">검색 태그 (쉼표로, 1~8개)</label>
          <input id="d-tags" className="input" value={draft.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(/[,]/).map((t) => t.trim()).filter(Boolean).slice(0, 8) })} />
        </div>
        {!terrain && (
          <>
            <div className="field">
              <label>크기 (가로×세로 칸)</label>
              <div className="row">
                <select className="select" aria-label="가로 칸" value={draft.footprint.w} onChange={(e) => set({ footprint: { ...draft.footprint, w: Number(e.target.value) } })}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                ×
                <select className="select" aria-label="세로 칸" value={draft.footprint.d} onChange={(e) => set({ footprint: { ...draft.footprint, d: Number(e.target.value) } })}>
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="d-h">높이</label>
              <select id="d-h" className="select" value={draft.height} onChange={(e) => set({ height: Number(e.target.value) })}>
                {[0.3, 0.6, 1, 1.5, 2, 2.5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </>
        )}
      </div>
      <label className="row" style={{ fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={draft.passable} onChange={(e) => set({ passable: e.target.checked })} />
        {terrain ? "걸어서 지나갈 수 있는 바닥 (끄면 물처럼 못 지나감)" : "캐릭터가 지나갈 수 있음 (꽃·풀처럼)"}
      </label>
    </fieldset>
  );
}

function ResultViews({ outputs }: { outputs: { texture: string | null; td: string | null; iso: string | null } }) {
  const [v, setV] = useState<"td" | "iso">("td");
  if (outputs.texture) return <img className="ws-out" src={outputs.texture} alt="바닥 텍스처 결과" />;
  return (
    <div>
      <div className="seg" role="group" aria-label="결과 시점">
        <button className={v === "td" ? "on" : ""} onClick={() => setV("td")}>탑뷰</button>
        <button className={v === "iso" ? "on" : ""} onClick={() => setV("iso")}>아이소</button>
      </div>
      {(v === "td" ? outputs.td : outputs.iso) && <img className="ws-out" src={(v === "td" ? outputs.td : outputs.iso)!} alt={v === "td" ? "탑뷰 결과" : "아이소 결과"} loading="lazy" />}
    </div>
  );
}

function Library() {
  const [assets, setAssets] = useState<LibraryAsset[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | LibraryAsset["category"]>("all");
  useEffect(() => {
    api<{ assets: LibraryAsset[] }>("/api/workshop/library").then((r) => setAssets(r.assets)).catch(() => setAssets([]));
  }, []);
  const list = (assets ?? []).filter((a) => (cat === "all" || a.category === cat) && (!q.trim() || a.name.includes(q.trim()) || a.tags.some((t) => t.includes(q.trim()))));
  return (
    <div className="card ws-pad">
      <div className="section-title">
        <h2>내 에셋 보관함</h2>
        <div className="row">
          <select className="select" style={{ width: "auto" }} value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="분류">
            <option value="all">전체 분류</option>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_KO[c]}
              </option>
            ))}
          </select>
          <input className="input" style={{ maxWidth: 220 }} placeholder="이름·태그 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="보관함 검색" />
        </div>
      </div>
      <p className="ws-note">저장한 에셋은 편집기 왼쪽 ‘내 에셋’ 분류에서 배치할 수 있어요.</p>
      {assets === null ? "불러오는 중…" : list.length === 0 ? <div className="empty">아직 저장한 에셋이 없어요.</div> : null}
      <div className="grid-cards">
        {list.map((a) => (
          <article key={a.id} className="card">
            <div className="card-thumb ws-lib-thumb">
              {/* 목록에서는 한 장만, 지연 로딩 */}
              <img src={(a.urls.td ?? a.urls.texture)!} alt={a.name} loading="lazy" />
            </div>
            <div className="card-body">
              <h3>{a.name}</h3>
              <p>
                {CATEGORY_KO[a.category]} · {a.behavior.footprint.w}×{a.behavior.footprint.d}칸 · {a.behavior.blocking ? "막힘" : "통과"}
              </p>
              <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
                {a.tags.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AvatarEditor({ initial, onSaved }: { initial: AvatarLook; onSaved: () => void }) {
  const [look, setLook] = useState<AvatarLook>(initial);
  const [saving, setSaving] = useState(false);
  const { show, node } = useToast();
  const slot = (key: "top" | "shoes" | "pack", label: string) => (
    <div className="field">
      <label>{label}</label>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {AVATAR_COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={look[key] === c} aria-label={COLOR_KO[c]} title={COLOR_KO[c]} className={`swatch ${look[key] === c ? "on" : ""}`} style={{ background: hsl(COLOR_HSL[c]) }} onClick={() => setLook((l) => ({ ...l, [key]: c }))} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="ws-avatar">
      <div className="card ws-pad">
        <h2 style={{ marginTop: 0 }}>내 플레이 아바타 꾸미기</h2>
        <p className="ws-note">기본 탐험가의 색을 바꿔요. 바로 적용되고 비용이 들지 않아요. 저장하면 플레이(탑뷰·아이소)에 나타나요.</p>
        {slot("top", "옷")}
        {slot("pack", "가방")}
        {slot("shoes", "신발")}
        <p className="ws-note">머리색 바꾸기는 준비 중이에요(지금 그림에서는 깔끔하게 바꿀 수 없어요).</p>
        <div className="row">
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api("/api/workshop/avatar", { method: "PUT", json: { look } });
                show("아바타를 저장했어요. 플레이에 바로 적용돼요");
                onSaved();
              } catch (e) {
                show(e instanceof ApiError ? e.message : "저장하지 못했어요", true);
              } finally {
                setSaving(false);
              }
            }}
          >
            저장
          </button>
          <button className="btn" onClick={() => setLook(DEFAULT_LOOK)}>
            기본으로
          </button>
        </div>
        <p className="ws-note">AI로 새 아바타 만들기는 준비 중이에요. 선생님 승인 후 두 시점·8방향·걷기 프레임이 모두 갖춰진 경우에만 플레이 아바타로 쓸 수 있어요(한 장짜리 인물 그림은 배치용).</p>
      </div>
      <div className="card ws-pad">
        <AvatarPreview look={look} />
      </div>
      {node}
    </div>
  );
}

// ======================= 교사 =======================

interface ClassInfo {
  id: string;
  name: string;
  inviteActive: boolean;
  students: Array<{ id: string; nickname: string }>;
  pending: number;
}

function TeacherHome({ me }: { me: Me }) {
  const { show, node } = useToast();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [invite, setInvite] = useState<{ classId: string; url: string } | null>(null);
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [filter, setFilter] = useState<RequestStatus | "all">("pending");
  const [genLog, setGenLog] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const loadClasses = useCallback(() => {
    api<{ classes: ClassInfo[] }>("/api/workshop/classes")
      .then((r) => {
        setClasses(r.classes);
        setSel((s) => s ?? r.classes[0]?.id ?? null);
      })
      .catch((e) => show(e.message, true));
  }, [show]);
  useEffect(loadClasses, [loadClasses]);
  const loadRequests = useCallback(() => {
    if (!sel) return;
    api<{ requests: RequestView[] }>(`/api/workshop/requests?classId=${encodeURIComponent(sel)}`)
      .then((r) => setRequests(r.requests))
      .catch((e) => show(e.message, true));
  }, [sel, show]);
  useEffect(loadRequests, [loadRequests]);
  const refreshAll = useCallback(() => {
    loadRequests();
    loadClasses();
  }, [loadRequests, loadClasses]);
  useVisiblePoll(refreshAll, 10000, !!sel);

  const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;

  const act = async (r: RequestView, action: "approve" | "reject") => {
    try {
      await api(`/api/workshop/requests/${r.id}/action`, { method: "POST", json: { action, rev: r.rev, reason: reasons[r.id] } });
      show(action === "approve" ? "승인했어요" : "반려했어요");
      loadRequests();
      loadClasses();
    } catch (e) {
      show(e instanceof Error ? e.message : "처리하지 못했어요", true);
      loadRequests();
    }
  };

  const generate = async (id: string) => {
    setGenLog((g) => ({ ...g, [id]: "생성 시작…" }));
    try {
      await runGenerate(id, (ev, data) => {
        if (ev === "status") setGenLog((g) => ({ ...g, [id]: data.started ? "생성 중… (보통 30초~1분)" : "이미 진행 중인 생성이에요" }));
        if (ev === "done") setGenLog((g) => ({ ...g, [id]: "생성 완료" }));
        if (ev === "failed") setGenLog((g) => ({ ...g, [id]: String(data.error ?? "생성 실패") }));
        if (ev === "info") setGenLog((g) => ({ ...g, [id]: String(data.message ?? "") }));
      });
    } catch (e) {
      setGenLog((g) => ({ ...g, [id]: e instanceof Error ? e.message : "생성 요청 실패" }));
    }
    loadRequests();
  };

  const approveAndGenerate = async (r: RequestView) => {
    try {
      await api(`/api/workshop/requests/${r.id}/action`, { method: "POST", json: { action: "approve", rev: r.rev } });
    } catch (e) {
      show(e instanceof Error ? e.message : "승인하지 못했어요", true);
      return loadRequests();
    }
    loadRequests();
    await generate(r.id);
  };

  const shown = requests.filter((r) => filter === "all" || r.status === filter);
  const counts = (s: RequestStatus) => requests.filter((r) => r.status === s).length;

  return (
    <div className="ws-teacher">
      <aside className="card ws-pad">
        <h2 style={{ marginTop: 0 }}>내 학급</h2>
        <div className="ws-list">
          {classes.map((c) => (
            <button key={c.id} className={`ws-item-main ${sel === c.id ? "on" : ""}`} onClick={() => setSel(c.id)}>
              <b>{c.name}</b>
              <span className="ws-meta">학생 {c.students.length} · 대기 {c.pending}</span>
            </button>
          ))}
        </div>
        <form
          className="row"
          style={{ marginTop: 10 }}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api<{ class: { id: string }; invite: string }>("/api/workshop/classes", { method: "POST", json: { name: newName } });
              setNewName("");
              setInvite({ classId: r.class.id, url: inviteUrl(r.invite) });
              setSel(r.class.id);
              loadClasses();
            } catch (er) {
              show(er instanceof Error ? er.message : "만들지 못했어요", true);
            }
          }}
        >
          <input className="input" placeholder="새 학급 이름" value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} aria-label="새 학급 이름" />
          <button className="btn primary sm" disabled={!newName.trim()}>
            만들기
          </button>
        </form>
        {sel && (
          <div style={{ marginTop: 14 }}>
            <b style={{ fontSize: 13 }}>초대 링크</b>
            {invite?.classId === sel ? (
              <div className="ws-invite">
                <input className="input" readOnly value={invite.url} aria-label="초대 링크" onFocus={(e) => e.currentTarget.select()} />
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(invite.url).then(() => show("복사했어요"))}>
                  복사
                </button>
                <p className="ws-note">이 링크는 지금만 보여요. 잃어버리면 새로 만드세요(이전 링크는 막혀요).</p>
              </div>
            ) : (
              <p className="ws-note">보안을 위해 링크 원문은 저장하지 않아요.</p>
            )}
            <div className="row">
              <button
                className="btn sm"
                onClick={async () => {
                  const r = await api<{ invite: string }>(`/api/workshop/classes/${sel}/invite`, { method: "POST", json: { active: true } });
                  setInvite({ classId: sel, url: inviteUrl(r.invite) });
                }}
              >
                새 링크 만들기
              </button>
              <button
                className="btn sm ghost"
                onClick={async () => {
                  await api(`/api/workshop/classes/${sel}/invite`, { method: "POST", json: { active: false } });
                  setInvite(null);
                  show("초대를 멈췄어요");
                  loadClasses();
                }}
              >
                초대 멈춤
              </button>
            </div>
            <p className="ws-note">학생 {classes.find((c) => c.id === sel)?.students.map((s) => s.nickname).join(", ") || "없음"}</p>
          </div>
        )}
      </aside>

      <section className="card ws-pad">
        <div className="section-title">
          <h2>요청 검토</h2>
          <div className="cat-tabs">
            {(["pending", "approved", "generating", "generated", "failed", "rejected", "saved", "all"] as const).map((s) => (
              <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>
                {s === "all" ? `전체 ${requests.length}` : `${STATUS_LABEL[s]} ${counts(s)}`}
              </button>
            ))}
          </div>
        </div>
        {!me.status.imageGeneration && <div className="issue warn">서버에 이미지 생성 키가 없어 승인 후 생성은 할 수 없어요.</div>}
        {shown.length === 0 && <div className="empty">해당하는 요청이 없어요.</div>}
        <div className="ws-review">
          {shown.map((r) => {
            const snap = r.submitted ?? r.approved;
            const d = snap?.draft ?? r.draft;
            return (
              <article key={r.id} className="ws-review-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>
                    {r.nickname} · {d.name}
                  </b>
                  <span className={`chip ${STATUS_CHIP[r.status]}`}>
                    {STATUS_LABEL[r.status]} · v{r.version}
                  </span>
                </div>
                <div className="ws-meta">
                  {timeText(r.updatedAt)} · {CATEGORY_KO[d.category]} · {d.footprint.w}×{d.footprint.d}칸 · {d.passable ? "통과" : "막힘"} · 생성 {snap?.outputs.length ?? (d.category === "terrain" ? 1 : 2)}장({(snap?.outputs ?? []).join("+")})
                </div>
                <p style={{ margin: "6px 0", fontSize: 13.5 }}>{d.description || "(설명 없음)"}</p>
                <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{d.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>
                {r.status === "pending" && (
                  <div className="ws-meta">
                    예상 비용(출력 기준): {(snap?.outputs.length ?? 2)}장 × 약 ${EST_OUTPUT_USD.toFixed(4)} = 약 ${((snap?.outputs.length ?? 2) * EST_OUTPUT_USD).toFixed(4)} · 입력(설명·그림·참조) 토큰 비용은 별도
                  </div>
                )}
                {(snap?.uploadUrl ?? r.uploadUrl) && <img className="ws-thumb lg" src={(snap?.uploadUrl ?? r.uploadUrl)!} alt="학생이 첨부한 그림" loading="lazy" />}
                {r.status === "pending" && (
                  <div className="ws-actions">
                    <button className="btn coral" disabled={!me.status.imageGeneration} onClick={() => void approveAndGenerate(r)}>
                      승인하고 생성
                    </button>
                    <button className="btn" onClick={() => void act(r, "approve")}>
                      승인만
                    </button>
                    <input className="input" placeholder="반려 사유 (학생에게 보여요)" value={reasons[r.id] ?? ""} maxLength={200} onChange={(e) => setReasons((x) => ({ ...x, [r.id]: e.target.value }))} aria-label="반려 사유" />
                    <button className="btn" disabled={!reasons[r.id]?.trim()} onClick={() => void act(r, "reject")}>
                      반려하기
                    </button>
                  </div>
                )}
                {(r.status === "approved" || r.status === "failed") && (
                  <div className="ws-actions">
                    <button className="btn coral" disabled={!me.status.imageGeneration || r.attempts >= 3} onClick={() => void generate(r.id)}>
                      {r.status === "failed" ? `다시 시도 (${r.attempts}/3)` : "생성하기"}
                    </button>
                    {r.status === "failed" && <span className="ws-meta">{r.generation?.error}</span>}
                  </div>
                )}
                {genLog[r.id] && <div className="issue ok">{genLog[r.id]}</div>}
                {r.generation?.outputs && (r.status === "generated" || r.status === "saved" || r.status === "discarded") && <ResultViews outputs={r.generation.outputs} />}
                {r.generation?.cost !== undefined && r.generation.cost && (
                  <div className="ws-meta">
                    받은 이미지 {r.generation.cost.images}장 · 이미지 호출 {r.generation.cost.calls ?? r.generation.cost.images}회 · 생성 시도 {r.generation.attempt}회 ·{" "}
                    {r.generation.cost.complete ? `약 $${r.generation.cost.usdKnown.toFixed(4)}` : `확인된 금액 $${r.generation.cost.usdKnown.toFixed(4)} (일부 미확인: ${r.generation.cost.unknown.join(", ")})`} · 요금표 {r.generation.cost.pricingVersion}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {node}
    </div>
  );
}
