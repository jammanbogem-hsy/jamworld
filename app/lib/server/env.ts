// 서버 전용: Worker 바인딩(cloudflare:workers) → process.env 순으로 키를 읽는다
import { env as workerEnv } from "cloudflare:workers";
import type { ProviderEnv } from "../agent/providers";

const NAMES = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL", "ANTHROPIC_MODEL"] as const;

export function providerEnv(): ProviderEnv {
  const out: ProviderEnv = {};
  const w = workerEnv as unknown as Record<string, unknown>;
  for (const n of NAMES) {
    const v = (typeof w?.[n] === "string" ? (w[n] as string) : undefined) ?? (typeof process !== "undefined" ? process.env?.[n] : undefined);
    if (v && v.trim()) out[n] = v.trim();
  }
  return out;
}
