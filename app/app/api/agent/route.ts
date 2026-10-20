import { repairMessage, userMessage, MAX_AGENT_CELLS } from "@/lib/agent/prompt";
import { callModel, ProviderError, type Provider, type Turn } from "@/lib/agent/providers";
import { checkMapValue } from "@/lib/world/io";
import { applyOps } from "@/lib/world/ops";
import { providerEnv } from "@/lib/server/env";
import { accessFrom, assertSameOrigin, getWorkshop } from "@/lib/server/workshop/runtime";
import { libraryLike } from "@/lib/server/workshop/view";
import { embeddedFromLibrary } from "@/lib/world/user-assets";
import type { EmbeddedAsset } from "@/lib/world/types";

/**
 * 모델 호출(비용 발생)은 허용 교사 또는 허용 교사 학급의 학생만 (SIWC 헤더 존재만으로는 불가).
 * 사용할 수 있는 사용자 에셋 = 그 학생의 보관함(본인+학급 공유). 교사는 맵에 내장된 정의만.
 */
async function authorize(request: Request): Promise<{ ok: false } | { ok: true; library: Record<string, EmbeddedAsset> }> {
  try {
    const ws = getWorkshop();
    const a = await accessFrom(request, ws);
    if (a.kind === "student") {
      const lib: Record<string, EmbeddedAsset> = {};
      for (const m of await ws.library(a.student)) {
        const { id, embed } = embeddedFromLibrary(libraryLike(m));
        lib[id] = embed;
      }
      return { ok: true, library: lib };
    }
    return a.kind === "teacher" ? { ok: true, library: {} } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export const dynamic = "force-dynamic";

const MAX_BODY = 2_500_000;
const TIMEOUT_MS = 90_000;

function fail(error: string, status: number, detail?: string[]) {
  return Response.json({ error, detail }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    assertSameOrigin(request);
  } catch {
    return fail("다른 사이트에서 온 요청은 받을 수 없어요", 403);
  }
  const auth = await authorize(request);
  if (!auth.ok) return fail("사용 권한이 없어요 — 허용된 교사(Sites 로그인) 또는 그 학급 초대 링크로 들어온 학생만 쓸 수 있어요", 401);
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return fail("요청이 너무 큽니다", 413);
  let body: { provider?: unknown; prompt?: unknown; doc?: unknown };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return fail("요청이 너무 큽니다", 413);
    body = JSON.parse(text);
  } catch {
    return fail("요청 형식이 올바르지 않습니다", 400);
  }
  const provider = body.provider;
  if (provider !== "openai" && provider !== "anthropic") return fail("provider 는 openai 또는 anthropic 이어야 합니다", 400);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1000) : "";
  if (!prompt) return fail("요청 문장이 비어 있습니다", 400);
  const parsed = checkMapValue(body.doc);
  if (!parsed.ok) return fail("맵 데이터가 올바르지 않습니다", 400, parsed.errors.map((e) => e.message).slice(0, 5));
  const doc = parsed.doc;
  if (doc.width * doc.height > MAX_AGENT_CELLS) return fail("에이전트는 120×120 이하 맵만 지원합니다", 400);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  request.signal?.addEventListener("abort", () => ctrl.abort());
  const env = providerEnv();
  const turns: Turn[] = [{ role: "user", text: userMessage(doc, prompt, auth.library) }];
  try {
    let result = await callModel(provider as Provider, env, turns, ctrl.signal);
    let check = applyOps(doc, result.ops, { strict: true, maxOps: 300, extraAssets: auth.library });
    let repaired = false;
    if (!check.ok) {
      // 한 번만 오류를 알려 주고 다시 받는다. 그래도 실패하면 원본 유지
      repaired = true;
      turns.push({ role: "assistant", text: JSON.stringify({ summary: result.summary, ops: result.ops }).slice(0, 60_000) });
      turns.push({ role: "user", text: repairMessage(check.errors.map((e) => e.message)) });
      result = await callModel(provider as Provider, env, turns, ctrl.signal);
      check = applyOps(doc, result.ops, { strict: true, maxOps: 300, extraAssets: auth.library });
      if (!check.ok) {
        return fail("모델이 만든 변경안이 검증을 통과하지 못해 맵을 바꾸지 않았습니다", 422, check.errors.map((e) => e.message).slice(0, 6));
      }
    }
    return Response.json(
      { provider, model: result.model, summary: result.summary, ops: result.ops, latencyMs: Date.now() - started, repaired },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof ProviderError) return fail(e.message, e.status);
    if (ctrl.signal.aborted) return fail("응답 시간이 초과되었거나 취소되었습니다", 504);
    return fail("에이전트 처리 중 오류가 발생했습니다", 500);
  } finally {
    clearTimeout(timer);
  }
}
