import { handle, need } from "@/lib/server/workshop/http";
import { noStore, studentFrom } from "@/lib/server/workshop/runtime";
import { MAX_UPLOAD_BYTES, WorkshopError } from "@/lib/server/workshop/service";
import { requestView } from "@/lib/server/workshop/view";

export const dynamic = "force-dynamic";

/** 학생 그림 업로드 (본문 = 이미지 바이트, ?rev=). 형식은 서버가 파일 내용으로 판별 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async (ws) => {
    const s = need(await studentFrom(req, ws));
    const { id } = await ctx.params;
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES) throw new WorkshopError("upload", "그림 파일은 4MB 이하만 올릴 수 있어요", 413);
    const bytes = new Uint8Array(await req.arrayBuffer());
    const rev = Number(new URL(req.url).searchParams.get("rev"));
    await ws.attachUpload(s, id, rev, bytes, req.headers.get("content-type") ?? "");
    const r = await ws.ownRequest(s, id);
    return Response.json({ request: requestView(r, await ws.store.latestGeneration(id)) }, { headers: noStore });
  });
}
