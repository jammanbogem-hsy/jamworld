import { handle, jsonBody, need } from "@/lib/server/workshop/http";
import { noStore, studentFrom } from "@/lib/server/workshop/runtime";
import { requestView } from "@/lib/server/workshop/view";

export const dynamic = "force-dynamic";

/** 초안 수정(학생 본인, 초안·반려 상태만) */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(req, async (ws) => {
    const s = need(await studentFrom(req, ws));
    const { id } = await ctx.params;
    const b = await jsonBody<{ rev?: number; draft?: unknown }>(req);
    await ws.updateDraft(s, id, Number(b.rev), b.draft);
    const r = await ws.ownRequest(s, id);
    return Response.json({ request: requestView(r, await ws.store.latestGeneration(id)) }, { headers: noStore });
  });
}
