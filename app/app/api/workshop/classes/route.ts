import { handle, jsonBody, need } from "@/lib/server/workshop/http";
import { noStore, teacherFrom } from "@/lib/server/workshop/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(req, async (ws) => {
    const t = need(await teacherFrom(req, ws), "교사 로그인이 필요해요");
    const classes = await ws.store.classesByTeacher(t.id);
    const out = await Promise.all(
      classes.map(async (c) => {
        const [students, requests] = await Promise.all([ws.store.studentsInClass(c.id), ws.store.requestsByClass(c.id)]);
        return { id: c.id, name: c.name, inviteActive: !!c.inviteActive, students: students.map((s) => ({ id: s.id, nickname: s.nickname })), pending: requests.filter((r) => r.status === "pending").length };
      }),
    );
    return Response.json({ classes: out }, { headers: noStore });
  });
}

/** 학급 만들기: 초대 토큰 원문은 이 응답에서 한 번만 보여 준다 */
export async function POST(req: Request) {
  return handle(req, async (ws) => {
    const t = need(await teacherFrom(req, ws), "교사 로그인이 필요해요");
    const body = await jsonBody<{ name?: string }>(req);
    const { cls, inviteToken } = await ws.createClass(t, String(body.name ?? ""));
    return Response.json({ class: { id: cls.id, name: cls.name }, invite: inviteToken }, { status: 201, headers: noStore });
  });
}
