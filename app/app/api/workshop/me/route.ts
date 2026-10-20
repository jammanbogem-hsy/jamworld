import { accessFrom, workshopStatus, noStore } from "@/lib/server/workshop/runtime";
import { handle } from "@/lib/server/workshop/http";

export const dynamic = "force-dynamic";

// 현재 사용자 역할은 서버가 판정 (교사 = Sites 로그인, 학생 = 학급 세션 쿠키)
export async function GET(req: Request) {
  return handle(req, async (ws) => {
    const a = await accessFrom(req, ws);
    if (a.kind === "student") {
      const s = a.student;
      const c = await ws.store.getClass(s.classId);
      return Response.json(
        { role: "student", student: { id: s.id, nickname: s.nickname, classId: s.classId, className: c?.name ?? "", avatar: s.avatar ? JSON.parse(s.avatar) : null }, status: workshopStatus() },
        { headers: noStore },
      );
    }
    if (a.kind === "teacher") return Response.json({ role: "teacher", teacher: { id: a.teacher.id, name: a.teacher.displayName }, status: workshopStatus() }, { headers: noStore });
    // Sites 로그인은 했지만 허용 교사 목록에 없음: 교사 기능 없음
    if (a.kind === "pending-teacher") return Response.json({ role: "pending-teacher", identity: { name: a.identity.name }, status: workshopStatus() }, { headers: noStore });
    return Response.json({ role: null, status: workshopStatus() }, { headers: noStore });
  });
}
