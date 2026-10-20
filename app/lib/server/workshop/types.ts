// 에셋 공방 도메인 타입 (서버·클라이언트 공용, 비밀 값 없음)

export const REQUEST_STATUSES = ["draft", "pending", "rejected", "approved", "generating", "generated", "failed", "saved", "discarded"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "초안",
  pending: "승인 대기",
  rejected: "반려",
  approved: "승인됨",
  generating: "생성 중",
  generated: "생성 완료",
  failed: "생성 실패",
  saved: "저장됨",
  discarded: "저장 안 함",
};

export const ASSET_CATEGORIES = ["terrain", "nature", "building", "furniture", "interactive", "decor", "character"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const CATEGORY_KO: Record<AssetCategory, string> = {
  terrain: "바닥",
  nature: "자연",
  building: "건물·벽",
  furniture: "가구",
  interactive: "상호작용",
  decor: "장식",
  character: "인물",
};

/** 학생이 작성하는 제작안 (서버에서 검증 후 저장) */
export interface RequestDraft {
  name: string;
  description: string;
  category: AssetCategory;
  tags: string[];
  /** 기본 점유 칸 (바닥은 1×1 고정) */
  footprint: { w: number; d: number };
  /** 통과 가능 여부 (바닥은 항상 걸을 수 있음, 물 같은 바닥은 passable=false) */
  passable: boolean;
  /** 높이(셀 단위, 렌더 전용) */
  height: number;
}

/** 승인 시 고정되는 스냅샷 */
export interface ApprovedSnapshot {
  version: number;
  draft: RequestDraft;
  uploadKey: string | null;
  uploadSha256: string | null;
  /** 생성할 이미지: 바닥은 texture 1장, 그 외 td+iso 2장 */
  outputs: Array<"texture" | "td" | "iso">;
}

export interface GenerationOutputs {
  texture?: string;
  td?: string;
  iso?: string;
}

/**
 * 보관함 에셋 매니페스트: 그림(appearance)과 동작(behavior) 분리.
 * 동작은 현재 정적 오브젝트(충돌 여부·크기)만 지원하며, 문·계단 같은 동작 모듈은 후속 단계(미구현).
 */
export interface LibraryManifest {
  schema: 1;
  id: string;
  name: string;
  category: AssetCategory;
  tags: string[];
  appearance: { kind: "texture"; texture: string } | { kind: "views"; td: string; iso: string };
  behavior: {
    footprint: { w: number; d: number };
    blocking: boolean;
    height: number;
    /** 인물은 한 장 그림의 배치용(static). 걷기 아바타가 아님 */
    character?: "static";
    actions: [];
  };
  provenance: {
    requestId: string;
    approvedVersion: number;
    generationId: string;
    model: string;
    createdBy: string;
  };
}
