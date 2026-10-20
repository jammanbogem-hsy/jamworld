/** 셀 1칸의 바닥 윗면 폭(px, 줌 1) */
export const TW = 64;
/** 셀 1칸의 바닥 윗면 깊이(px). 사선 시점이라 폭보다 짧다 */
export const TD = 48;
/** 높이 1단위(px) */
export const HU = 40;

export const OUTLINE = "rgba(27,36,64,0.55)";
export const SHADOW = "rgba(24,28,58,0.22)";

export type Quality = "low" | "standard";

const MB = 1024 * 1024;

/** 저전력 = 4GB 크롬북 기준. 캐시 예산은 RGBA 픽셀 byte 합 */
export const QUALITY = {
  low: { dprCap: 1, fps: 30, chunkScaleCap: 1, chunkBudget: 16 * MB, spriteBudget: 12 * MB },
  standard: { dprCap: 2, fps: 60, chunkScaleCap: 1.5, chunkBudget: 32 * MB, spriteBudget: 24 * MB },
} as const;
