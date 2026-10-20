import { handle, jsonBody, need } from "@/lib/server/workshop/http";
import { noStore, studentFrom } from "@/lib/server/workshop/runtime";

export const dynamic = "force-dynamic";

/** 학생 플레이 아바타 외형 저장 (기본 제공 선택만, 무료·즉시) */
export async function PUT(req: Request) {
  return handle(req, async (ws) => {
    const s = need(await studentFrom(req, ws), "학급에 들어간 학생만 저장할 수 있어요");
    const b = await jsonBody<{ look?: unknown }>(req, 2048);
    return Response.json({ look: await ws.setAvatar(s, b.look) }, { headers: noStore });
  });
}
