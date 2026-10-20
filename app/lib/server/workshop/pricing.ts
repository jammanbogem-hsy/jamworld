// 이미지 생성 비용: provider 응답 usage(토큰) × 모델별 토큰 단가.
// 원칙: 모르면 0이 아니라 '미확인'. usage 누락·입력 분해 누락(참조 이미지가 있었는데 text/image 구분 없음)·단가 누락은
// 확인된 금액에서 빼고 complete=false 로 표시한다. 생성 완료 시 적용 요금표와 날짜를 함께 고정 저장한다.

export interface ImageUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  output_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

export interface UsageEntry {
  output: "texture" | "td" | "iso";
  model: string;
  usage: ImageUsage | null;
  ms: number;
  attempt: number;
  /** 참조 이미지(학생 그림·탑뷰 결과)를 넣은 호출인가 — 입력 분해가 없을 때 판단용 */
  hadReferences?: boolean;
  /** pending: 호출 직전 기록(응답 전 중단), ok: 이미지 받음, failed: 오류·타임아웃 — pending/failed 는 과금 여부 미확인 */
  status?: "pending" | "ok" | "failed";
}

/** USD per 1M tokens */
export interface ModelRates {
  input_text?: number;
  input_image?: number;
  output_image?: number;
  output_text?: number;
}

export type PricingTable = Record<string, ModelRates>;

/**
 * 기본 단가 (USD / 1M 토큰). 출처: developers.openai.com — image-generation#cost-and-latency, models/gpt-image-2.5-flare,
 * 검증일 2026-10-20 (Codex 확인). Images API 직접 호출은 캐시 할인 없음. 다른 모델 장당 가격을 대신 쓰지 않는다.
 * 참고: medium 1024×1024 출력 약 439 토큰 ≈ $0.01317/장 (입력 별도).
 */
export const DEFAULT_PRICING: PricingTable = {
  "gpt-image-2.5-flare": { input_text: 5, input_image: 8, output_image: 30 },
};
export const DEFAULT_PRICING_VERSION = "openai-2026-10-20";

export interface PricingConfig {
  table: PricingTable;
  /** 요금표 식별자: 기본표 날짜 또는 'env:…' (설정 덮어씀) */
  version: string;
}

/** 환경변수 OPENAI_IMAGE_PRICING(JSON)으로 덮어쓸 수 있다. 덮어쓰면 버전에 그 사실을 남긴다 */
export function parsePricing(raw: string | undefined | null): PricingConfig {
  if (!raw) return { table: { ...DEFAULT_PRICING }, version: DEFAULT_PRICING_VERSION };
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object") return { table: { ...DEFAULT_PRICING, ...(v as PricingTable) }, version: `${DEFAULT_PRICING_VERSION}+env` };
  } catch {
    /* 잘못된 설정은 무시 */
  }
  return { table: { ...DEFAULT_PRICING }, version: DEFAULT_PRICING_VERSION };
}

type TokenKind = "input_text" | "input_image" | "output_image" | "output_text";

export interface CostSummary {
  /** 이미지를 실제로 받은 호출 수 */
  images: number;
  /** provider 호출 시도 수 (실패·중단 포함) */
  calls: number;
  /** 분해가 확인된 토큰 */
  tokens: Record<TokenKind, number>;
  /** 분해되지 않은 입력 토큰(참조 이미지가 있는데 text/image 구분이 없던 경우) */
  unsplitInputTokens: number;
  /** 확인된 부분 금액 */
  usdKnown: number;
  /** 모든 호출의 usage·분해·단가가 확인됐으면 true (그때만 usdKnown 이 전체 금액) */
  complete: boolean;
  unknown: string[];
  pricingVersion: string;
}

export function summarizeCost(entries: UsageEntry[], pricing: PricingConfig): CostSummary {
  const tokens: Record<TokenKind, number> = { input_text: 0, input_image: 0, output_image: 0, output_text: 0 };
  let unsplit = 0;
  let usd = 0;
  const unknown = new Set<string>();
  for (const e of entries) {
    if (e.status === "pending" || e.status === "failed") {
      // 응답을 받지 못한 호출: 과금됐는지 알 수 없으므로 0 이 아니라 미확인
      unknown.add(`${e.output}: ${e.status === "pending" ? "응답 전 중단" : "오류·타임아웃"}(과금 여부 미확인)`);
      continue;
    }
    const u = e.usage;
    if (!u) {
      unknown.add(`${e.output}: usage 없음`);
      continue;
    }
    const parts: Partial<Record<TokenKind, number>> = {};
    // 입력
    if (u.input_tokens_details) {
      parts.input_text = u.input_tokens_details.text_tokens ?? 0;
      parts.input_image = u.input_tokens_details.image_tokens ?? 0;
    } else if ((u.input_tokens ?? 0) > 0) {
      if (e.hadReferences) {
        unsplit += u.input_tokens!;
        unknown.add(`${e.output}: 입력 text/image 구분 없음`);
      } else parts.input_text = u.input_tokens!;
    }
    // 출력
    if (u.output_tokens_details) {
      parts.output_image = u.output_tokens_details.image_tokens ?? 0;
      parts.output_text = u.output_tokens_details.text_tokens ?? 0;
    } else if (u.output_tokens !== undefined) parts.output_image = u.output_tokens;
    else unknown.add(`${e.output}: 출력 토큰 없음`);

    const rates = pricing.table[e.model];
    for (const [k, n] of Object.entries(parts) as Array<[TokenKind, number]>) {
      tokens[k] += n;
      if (!n) continue;
      const rate = rates?.[k];
      if (rate === undefined) unknown.add(`${e.model}: ${k} 단가 없음`);
      else usd += (rate * n) / 1_000_000;
    }
  }
  return {
    images: entries.filter((e) => e.status === undefined || e.status === "ok").length,
    calls: entries.length,
    tokens,
    unsplitInputTokens: unsplit,
    usdKnown: Math.round(usd * 1_000_000) / 1_000_000,
    complete: unknown.size === 0,
    unknown: [...unknown],
    pricingVersion: pricing.version,
  };
}

/** 생성 기록에 저장하는 usage 묶음: 호출 기록 + 완료 시점에 고정한 비용(적용 요금표·시각) */
export interface StoredUsage {
  entries: UsageEntry[];
  cost?: CostSummary & { computedAt: number; rates: PricingTable };
}

export function readStoredUsage(raw: string | null | undefined): StoredUsage {
  if (!raw) return { entries: [] };
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? { entries: v as UsageEntry[] } : (v as StoredUsage);
  } catch {
    return { entries: [] };
  }
}

export function freezeCost(entries: UsageEntry[], pricing: PricingConfig, at: number): StoredUsage {
  const used = new Set(entries.map((e) => e.model));
  const rates = Object.fromEntries(Object.entries(pricing.table).filter(([m]) => used.has(m)));
  return { entries, cost: { ...summarizeCost(entries, pricing), computedAt: at, rates } };
}
