import { handle, jsonBody, need } from "@/lib/server/workshop/http";
import { noStore, studentFrom, teacherFrom } from "@/lib/server/workshop/runtime";
import { requestView } from "@/lib/server/workshop/view";

export const dynamic = "force-dynamic";

/** 학생: 내 요청 / 교사: ?classId= 내 학급 요청 */
export async function GET(req: Request) {
  return handle(req, async (ws) => {
    const s = await studentFrom(req, ws);
    if (s) {
      const rows = await ws.store.requestsByStudent(s.id);
      for (const r of rows) if (r.status === "generating") await ws.recoverIfStale(r.id);
      const fresh = await ws.store.requestsByStudent(s.id);
      return Response.json({ requests: await Promise.all(fresh.map(async (r) => requestView(r, await ws.store.latestGeneration(r.id)))) }, { headers: noStore });
    }
    const t = need(await teacherFrom(req, ws));
    const classId = new URL(req.url).searchParams.get("classId") ?? "";
    await ws.ownClass(t, classId);
    const rows = await ws.store.requestsByClass(classId);
    for (const r of rows) if (r.status === "generating") await ws.recoverIfStale(r.id);
    const students = new Map((await ws.store.studentsInClass(classId)).map((x) => [x.id, x.nickname]));
    const fresh = await ws.store.requestsByClass(classId);
    return Response.json({ requests: await Promise.all(fresh.map(async (r) => requestView(r, await ws.store.latestGeneration(r.id), students.get(r.studentId), true))) }, { headers: noStore });
  });
}

export async function POST(req: Request) {
  return handle(req, async (ws) => {
    const s = need(await studentFrom(req, ws), "학급에 들어간 학생만 요청할 수 있어요");
    const b = await jsonBody<{ draft?: unknown }>(req);
    const r = await ws.createRequest(s, b.draft);
    return Response.json({ request: requestView(r, null) }, { status: 201, headers: noStore });
  });
}
