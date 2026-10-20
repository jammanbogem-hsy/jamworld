import { actorFrom, errorResponse, getWorkshop } from "@/lib/server/workshop/runtime";
import { WorkshopError } from "@/lib/server/workshop/service";

export const dynamic = "force-dynamic";

/** 학생 그림·생성 결과: 공개 버킷이 아니라 권한 확인 후 서버가 전달 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  try {
    const ws = getWorkshop();
    const { key } = await ctx.params;
    const k = key.map((p) => decodeURIComponent(p)).join("/");
    if (k.includes("..")) throw new WorkshopError("path", "잘못된 경로", 400);
    const actor = await actorFrom(req, ws);
    if (!actor || !(await ws.canReadFile(actor, k))) throw new WorkshopError("forbidden", "볼 수 없는 파일이에요", 403);
    const f = await ws.files.get(k);
    if (!f) throw new WorkshopError("not_found", "파일이 없어요", 404);
    return new Response(f.bytes as unknown as BodyInit, { headers: { "content-type": f.contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return errorResponse(e);
  }
}
