import { handle, jsonBody } from "@/lib/server/workshop/http";
import { noStore, sessionCookie } from "@/lib/server/workshop/runtime";
import { SESSION_TTL_MS } from "@/lib/server/workshop/service";

export const dynamic = "force-dynamic";

/** 학생 다시 들어가기: 초대 토큰 + 별명 + 개인 PIN → HttpOnly 세션 쿠키 */
export async function POST(req: Request) {
  return handle(req, async (ws) => {
    const b = await jsonBody<{ invite?: string; nickname?: string; pin?: string }>(req, 4096);
    const { student, sessionToken } = await ws.loginStudent(String(b.invite ?? ""), String(b.nickname ?? ""), String(b.pin ?? ""));
    return Response.json(
      { student: { id: student.id, nickname: student.nickname } },
      { status: 200, headers: { ...noStore, "set-cookie": sessionCookie(sessionToken, Math.floor(SESSION_TTL_MS / 1000)) } },
    );
  });
}
