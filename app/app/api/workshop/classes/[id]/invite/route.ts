import { handle, jsonBody, need } from "@/lib/server/workshop/http";
import { noStore, teacherFrom } from "@/lib/server/workshop/runtime";

export const dynamic = "force-dynamic";

/** 초대 링크 재발급(이전 링크 무효) 또는 중지 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async (ws) => {
    const t = need(await teacherFrom(req, ws), "교사 로그인이 필요해요");
    const { id } = await ctx.params;
    const body = await jsonBody<{ active?: boolean }>(req);
    const invite = await ws.rotateInvite(t, id, body.active !== false);
    return Response.json({ invite }, { headers: noStore });
  });
}
