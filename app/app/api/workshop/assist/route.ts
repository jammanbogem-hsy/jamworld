import { assistCard, type AssistTurn } from "@/lib/agent/assist";
import { providerEnv } from "@/lib/server/env";
import { handle, jsonBody, need } from "@/lib/server/workshop/http";
import { noStore, studentFrom } from "@/lib/server/workshop/runtime";
import { WorkshopError } from "@/lib/server/workshop/service";

export const dynamic = "force-dynamic";

/** 학생 공방 대화: 카드 제안만 (생성·제출 없음). 학급 학생만 */
export async function POST(req: Request) {
  return handle(req, async (ws) => {
    need(await studentFrom(req, ws), "학급에 들어간 학생만 사용할 수 있어요");
    const b = await jsonBody<{ turns?: AssistTurn[]; provider?: string }>(req, 32 * 1024);
    const turns = (Array.isArray(b.turns) ? b.turns : [])
      .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
      .slice(-12);
    if (!turns.length || turns[turns.length - 1].role !== "user") throw new WorkshopError("turns", "메시지를 입력해 주세요");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const r = await assistCard(providerEnv(), turns, ctrl.signal, b.provider === "anthropic" ? "anthropic" : "openai");
      // 카드는 서버 검증을 거쳐 돌려준다(잘못된 값은 기본값으로)
      let card = null;
      if (r.card) {
        try {
          card = ws.validateDraft(r.card);
        } catch {
          card = null;
        }
      }
      return Response.json({ reply: r.reply, card, model: r.model, provider: r.provider }, { headers: noStore });
    } catch (e) {
      if (e instanceof WorkshopError) throw e;
      throw new WorkshopError("assist", "도우미가 지금 답하지 못했어요. 잠시 뒤 다시 시도하거나 카드를 직접 채워 주세요", 502);
    } finally {
      clearTimeout(timer);
    }
  });
}
