import { providerStatus } from "@/lib/agent/providers";
import { providerEnv } from "@/lib/server/env";

export const dynamic = "force-dynamic";

// 키 존재 여부와 모델명만 알려 준다 (값은 절대 반환하지 않음)
export async function GET() {
  return Response.json({ providers: providerStatus(providerEnv()) }, { headers: { "cache-control": "no-store" } });
}
