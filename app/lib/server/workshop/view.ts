// 클라이언트로 내보내는 요청 보기(내부 해시·키 원문 대신 파일 URL)
import { readStoredUsage } from "./pricing";
import type { GenerationRow, RequestRow } from "./store";
import type { ApprovedSnapshot, GenerationOutputs, RequestDraft } from "./types";

export function fileUrl(key: string | null | undefined) {
  return key ? `/api/workshop/files/${key.split("/").map(encodeURIComponent).join("/")}` : null;
}

export function requestView(r: RequestRow, gen: GenerationRow | null, nickname?: string, withCost = false) {
  const outs = gen?.outputs ? (JSON.parse(gen.outputs) as GenerationOutputs) : null;
  const approved = r.approvedSnapshot ? (JSON.parse(r.approvedSnapshot) as ApprovedSnapshot) : null;
  const submitted = r.submittedSnapshot ? (JSON.parse(r.submittedSnapshot) as ApprovedSnapshot) : null;
  return {
    id: r.id,
    status: r.status,
    rev: r.rev,
    version: r.version,
    nickname,
    draft: JSON.parse(r.draft) as RequestDraft,
    uploadUrl: fileUrl(r.uploadKey),
    submitted: submitted ? { version: submitted.version, draft: submitted.draft, uploadUrl: fileUrl(submitted.uploadKey), outputs: submitted.outputs } : null,
    approved: approved ? { version: approved.version, draft: approved.draft, uploadUrl: fileUrl(approved.uploadKey), outputs: approved.outputs, at: r.approvedAt } : null,
    rejectReason: r.rejectReason,
    attempts: r.attempts,
    generation: gen
      ? {
          id: gen.id,
          status: gen.status,
          attempt: gen.attempt,
          error: gen.error,
          model: gen.model,
          startedAt: gen.startedAt,
          outputs: outs ? { texture: fileUrl(outs.texture), td: fileUrl(outs.td), iso: fileUrl(outs.iso) } : null,
          // 교사 화면용: 이번 실행의 이미지 수·토큰·비용(단가 설정 시)
          // 완료 시점에 고정한 비용(적용 요금표·날짜 포함). 진행 중이면 호출 기록만
          cost: withCost ? (readStoredUsage(gen.usage).cost ?? null) : undefined,
          calls: withCost ? readStoredUsage(gen.usage).entries.length : undefined,
        }
      : null,
    updatedAt: r.updatedAt,
  };
}

/** 보관함 매니페스트 → 클라이언트·에이전트용(그림 URL 포함) */
export function libraryLike(m: import("./types").LibraryManifest) {
  return {
    ...m,
    urls: m.appearance.kind === "texture" ? { texture: fileUrl(m.appearance.texture) } : { td: fileUrl(m.appearance.td), iso: fileUrl(m.appearance.iso) },
  };
}
