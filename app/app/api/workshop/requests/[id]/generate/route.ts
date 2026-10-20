import { errorResponse, getWorkshop, assertSameOrigin, teacherFrom } from "@/lib/server/workshop/runtime";
import { need } from "@/lib/server/workshop/http";
import { sanitizeError } from "@/lib/server/workshop/service";

export const dynamic = "force-dynamic";

/**
 * 교사 '생성' : 응답 연결을 유지한 채(SSE) 생성을 끝까지 await 한다.
 * Workers 는 클라이언트가 연결돼 있는 동안 벽시계 시간 제한이 없고, 응답 뒤 waitUntil 은 30초 제한이라 쓰지 않는다.
 * 15초마다 heartbeat. 연결이 끊겨 멈추면 일정 시간 뒤 '실패(재시도 가능)'로 복구된다.
 * 같은 Idempotency-Key 재요청·동시 클릭은 기존 실행 상태만 돌려준다(중복 과금 없음).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let ws;
  let gen;
  let started = false;
  try {
    assertSameOrigin(req);
    ws = getWorkshop();
    const t = need(await teacherFrom(req, ws), "교사만 생성할 수 있어요", 403);
    const { id } = await ctx.params;
    const res = await ws.startGeneration(t, id, req.headers.get("idempotency-key") ?? "");
    gen = res.generation;
    started = res.started;
  } catch (e) {
    return errorResponse(e);
  }
  const workshop = ws;
  const generation = gen;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("status", { generationId: generation.id, status: generation.status, started });
      const beat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          clearInterval(beat);
        }
      }, 15_000);
      try {
        if (started) {
          const done = await workshop.runGeneration(generation.id);
          send(done.status === "succeeded" ? "done" : "failed", { status: done.status, error: done.error });
        } else {
          send("info", { message: "이미 시작된 생성이에요. 목록에서 진행 상태를 확인하세요" });
        }
      } catch (e) {
        send("failed", { status: "failed", error: sanitizeError(e) });
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
