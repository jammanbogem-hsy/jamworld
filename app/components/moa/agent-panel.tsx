"use client";

import { useEffect, useRef, useState } from "react";
import { planDemo } from "@/lib/agent/demo";
import type { MapOp } from "@/lib/world/ops";
import type { MapDoc } from "@/lib/world/types";

export type ProviderId = "openai" | "anthropic" | "demo";

interface ProviderStatus {
  configured: boolean;
  model: string;
  reason?: string;
}

export interface AgentProposal {
  ops: MapOp[];
  summary: string;
  provider: ProviderId;
  model: string;
  latencyMs: number;
  repaired?: boolean;
}

interface Entry {
  role: "user" | "agent";
  text: string;
  meta?: string[];
  error?: boolean;
}

const LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  demo: "데모 (규칙 기반, AI 아님)",
};

export default function AgentPanel({
  doc,
  disabled,
  onProposal,
  log,
  setLog,
}: {
  doc: MapDoc;
  disabled: boolean;
  onProposal: (p: AgentProposal) => string | null;
  log: Entry[];
  setLog: (fn: (l: Entry[]) => Entry[]) => void;
}) {
  const [status, setStatus] = useState<Record<string, ProviderStatus> | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>("demo");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agent/status")
      .then((r) => r.json() as Promise<{ providers: Record<string, ProviderStatus> }>)
      .then((s) => {
        setStatus(s.providers);
        if (s.providers.anthropic?.configured) setProvider("anthropic");
        else if (s.providers.openai?.configured) setProvider("openai");
      })
      .catch(() => setStatusError("서버 상태를 확인할 수 없습니다"));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log, busy]);

  async function send() {
    const request = text.trim();
    if (!request || busy) return;
    setText("");
    setLog((l) => [...l, { role: "user", text: request }]);
    if (provider === "demo") {
      const t0 = performance.now();
      const plan = planDemo(doc, request);
      if (!plan.ops.length) {
        setLog((l) => [...l, { role: "agent", text: plan.summary, meta: ["데모"] }]);
        return;
      }
      const err = onProposal({ ...plan, provider: "demo", model: "rule-based", latencyMs: Math.round(performance.now() - t0) });
      setLog((l) => [...l, err ? { role: "agent", text: `${plan.summary}\n\n적용 불가: ${err}`, error: true, meta: ["데모"] } : { role: "agent", text: plan.summary, meta: ["데모", `작업 ${plan.ops.length}개`, "미리보기 중"] }]);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, prompt: request, doc }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as Partial<AgentProposal> & { error?: string; detail?: string[] };
      if (!res.ok || data.error) {
        const detail = data.detail?.length ? `\n- ${data.detail.join("\n- ")}` : "";
        setLog((l) => [...l, { role: "agent", text: `${data.error ?? `요청 실패 (${res.status})`}${detail}`, error: true, meta: [LABEL[provider]] }]);
        return;
      }
      const proposal = data as AgentProposal;
      const err = onProposal(proposal);
      const meta = [`${LABEL[proposal.provider]} · ${proposal.model}`, `${(proposal.latencyMs / 1000).toFixed(1)}초`, `작업 ${proposal.ops.length}개`];
      if (proposal.repaired) meta.push("자동 수정 1회");
      setLog((l) => [...l, err ? { role: "agent", text: `${proposal.summary}\n\n적용 불가: ${err}`, error: true, meta } : { role: "agent", text: proposal.summary || "변경안을 만들었어요.", meta: [...meta, "미리보기 중"] }]);
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setLog((l) => [...l, { role: "agent", text: aborted ? "요청을 취소했어요. 맵은 그대로예요." : "서버에 연결하지 못했어요. 맵은 그대로예요.", error: !aborted }]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const sel = status?.[provider];
  return (
    <>
      <div className="tab-body" ref={logRef}>
        <div className="provider-status" data-testid="provider-status">
          {statusError && <div className="issue err">{statusError}</div>}
          {status &&
            (["anthropic", "openai"] as const).map((p) => (
              <div key={p}>
                <span className={`dot ${status[p]?.configured ? "ok" : "bad"}`} />
                {LABEL[p]} <b>{status[p]?.model}</b> — {status[p]?.configured ? "키 설정됨 (실제 호출 시 확인)" : (status[p]?.reason ?? "미연결")}
              </div>
            ))}
        </div>
        <div className="agent-log">
          {log.length === 0 && (
            <div className="msg agent">
              맵을 말로 만들어 보세요. 예) “숲속 학교에 교실 세 개와 퀴즈 구역을 만들어 줘”, “오른쪽 교실을 넓히고 입구를 아래로 옮겨 줘”. 변경은 미리보기로 먼저 보여 드리고, 적용을 눌러야 반영돼요.
            </div>
          )}
          {log.map((e, i) => (
            <div key={i} className={`msg ${e.role}`} style={e.error ? { borderColor: "#f3b4b4", background: "#fff4f4" } : undefined}>
              {e.text}
              {e.meta && (
                <div className="meta">
                  {e.meta.map((m) => (
                    <span key={m} className={`chip ${m.startsWith("데모") ? "warn" : "teal"}`}>
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="msg agent">맵을 계획하는 중… (최대 90초)</div>}
        </div>
      </div>
      <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
        <select className="select" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)} aria-label="에이전트 모델">
          <option value="anthropic">Anthropic {status?.anthropic?.model ?? "claude-sonnet-5-5"}{status && !status.anthropic?.configured ? " (미연결)" : ""}</option>
          <option value="openai">OpenAI {status?.openai?.model ?? "gpt-6-luna"}{status && !status.openai?.configured ? " (미연결)" : ""}</option>
          <option value="demo">{LABEL.demo}</option>
        </select>
        {sel && !sel.configured && provider !== "demo" && <div className="issue warn">{sel.reason}</div>}
        <textarea
          className="textarea"
          placeholder="예) 왼쪽 위에 연못과 벤치가 있는 쉼터를 만들어 줘"
          value={text}
          maxLength={1000}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <div className="row">
          {busy ? (
            <button className="btn" style={{ flex: 1 }} onClick={() => abortRef.current?.abort()}>
              취소
            </button>
          ) : (
            <button className="btn primary" style={{ flex: 1 }} disabled={disabled || !text.trim()} onClick={() => void send()}>
              {provider === "demo" ? "데모로 만들기" : "에이전트에게 요청"}
            </button>
          )}
        </div>
        {disabled && <div className="provider-status">미리보기를 적용하거나 취소한 뒤 다음 요청을 보낼 수 있어요.</div>}
      </div>
    </>
  );
}

export type { Entry as AgentLogEntry };
