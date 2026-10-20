// 공방 클라이언트 API (서버가 역할·권한을 판정하므로 여기에는 역할 정보를 싣지 않는다)
import type { AvatarLook } from "@/lib/server/workshop/avatar";
import type { CostSummary } from "@/lib/server/workshop/pricing";
import type { LibraryManifest, RequestDraft, RequestStatus } from "@/lib/server/workshop/types";

export interface Me {
  role: "teacher" | "student" | "pending-teacher" | null;
  teacher?: { id: string; name: string };
  student?: { id: string; nickname: string; classId: string; className: string; avatar: AvatarLook | null };
  identity?: { name: string };
  status: { db: boolean; files: boolean; imageGeneration: boolean; imageModel: string };
}

export interface RequestView {
  id: string;
  status: RequestStatus;
  rev: number;
  version: number;
  nickname?: string;
  draft: RequestDraft;
  uploadUrl: string | null;
  submitted: { version: number; draft: RequestDraft; uploadUrl: string | null; outputs: string[] } | null;
  approved: { version: number; draft: RequestDraft; uploadUrl: string | null; outputs: string[]; at: number | null } | null;
  rejectReason: string | null;
  attempts: number;
  generation: {
    id: string;
    status: "queued" | "running" | "succeeded" | "failed";
    attempt: number;
    error: string | null;
    model: string;
    startedAt: number;
    outputs: { texture: string | null; td: string | null; iso: string | null } | null;
    cost?: (CostSummary & { computedAt: number }) | null;
    calls?: number;
  } | null;
  updatedAt: number;
}

export type LibraryAsset = LibraryManifest & { urls: { texture?: string | null; td?: string | null; iso?: string | null } };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, res.status, data.code);
  return data as T;
}

export const getMe = () => api<Me>("/api/workshop/me");

/** 생성: SSE 응답을 끝까지 읽으며 진행 상황 콜백 */
export async function runGenerate(id: string, onEvent: (event: string, data: Record<string, unknown>) => void, signal?: AbortSignal) {
  const key = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetch(`/api/workshop/requests/${id}/generate`, { method: "POST", headers: { "idempotency-key": key }, signal });
  if (!res.ok || !res.body) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(d.error ?? `생성 요청 실패 (${res.status})`, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (ev && data) {
        try {
          onEvent(ev, JSON.parse(data));
        } catch {
          /* 무시 */
        }
      }
    }
  }
}
