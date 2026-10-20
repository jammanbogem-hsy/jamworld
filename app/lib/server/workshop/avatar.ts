// 플레이 아바타 외형(학생 프로필). 기본 제공 탐험가 시트의 색 영역만 바꾸는 무료·즉시 선택.
// AI 신규 외형은 교사 승인 생성 파이프라인을 거치고, 두 시점 × 방향 × 걷기 프레임이 모두 갖춰진 것만 플레이 아바타로 쓴다(현재 미지원).

export const AVATAR_COLORS = ["teal", "coral", "gold", "violet", "navy", "green", "pink", "white"] as const;
/**
 * 머리색 바꾸기는 보류: 갈색 머리 밝은 부분이 피부 그림자와 색 범위가 겹쳐 색 영역만으로는 얼룩 없이 분리되지 않는다.
 * (원본 시트에 머리 마스크가 생기면 다시 연다.) 데이터 필드는 유지하고 기본값만 허용.
 */
export const AVATAR_HAIR = ["brown"] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];
export type AvatarHair = (typeof AVATAR_HAIR)[number];

export interface AvatarLook {
  base: "explorer";
  top: AvatarColor;
  shoes: AvatarColor;
  pack: AvatarColor;
  hair: AvatarHair;
}

export const DEFAULT_LOOK: AvatarLook = { base: "explorer", top: "teal", shoes: "coral", pack: "gold", hair: "brown" };

/** 표시용 색(HSL 색상각·채도·명도 목표) */
export const COLOR_HSL: Record<AvatarColor, [number, number, number]> = {
  teal: [174, 0.72, 0.42],
  coral: [6, 0.9, 0.62],
  gold: [46, 0.95, 0.55],
  violet: [262, 0.62, 0.58],
  navy: [228, 0.45, 0.3],
  green: [118, 0.55, 0.45],
  pink: [330, 0.8, 0.68],
  white: [210, 0.12, 0.92],
};

export const HAIR_HSL: Record<AvatarHair, [number, number, number]> = {
  brown: [22, 0.55, 0.3],
};

export const COLOR_KO: Record<AvatarColor, string> = { teal: "청록", coral: "코랄", gold: "금색", violet: "보라", navy: "남색", green: "초록", pink: "분홍", white: "흰색" };
export const HAIR_KO: Record<AvatarHair, string> = { brown: "갈색" };

export function isDefaultLook(a: AvatarLook) {
  return a.top === "teal" && a.shoes === "coral" && a.pack === "gold" && a.hair === "brown";
}
