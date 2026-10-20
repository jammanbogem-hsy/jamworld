// 접근 정책 (fail-closed): 교사 = SIWC 신원이 서버 허용 목록에 있을 때만, 학생 = 허용 교사의 학급 세션만.
// 요청 본문의 역할 정보는 쓰지 않는다. 목록이 비어 있으면 교사 0명.
import type { Workshop } from "./service.ts";
import type { StudentRow, TeacherRow } from "./store.ts";

export interface Allowlist {
  emails: Set<string>;
  ids: Set<string>;
}

/** "email:a@b.c, siwc:user-123, x@y.z" (접두 없는 값은 email) */
export function parseAllowlist(raw: string | null | undefined): Allowlist {
  const emails = new Set<string>();
  const ids = new Set<string>();
  for (const part of String(raw ?? "").split(/[,\s]+/)) {
    const v = part.trim();
    if (!v) continue;
    if (v.startsWith("siwc:")) ids.add(v.slice(5));
    else emails.add((v.startsWith("email:") ? v.slice(6) : v).toLowerCase());
  }
  return { emails, ids };
}

export function isAllowedTeacher(list: Allowlist, who: { siwcUserId: string; email?: string | null }) {
  return list.ids.has(who.siwcUserId) || (!!who.email && list.emails.has(who.email.toLowerCase()));
}

export interface SiwcIdentity {
  userId: string;
  email: string;
  name: string;
}

export type Access =
  | { kind: "teacher"; teacher: TeacherRow }
  | { kind: "student"; student: StudentRow }
  | { kind: "pending-teacher"; identity: SiwcIdentity }
  | { kind: "none" };

/** 요청 신원 판정. 학생 세션을 먼저 본다(같은 브라우저에서 교사 로그인과 겹칠 때 학생 화면 우선) */
export async function resolveAccess(ws: Workshop, list: Allowlist, siwc: SiwcIdentity | null, sessionToken: string | null): Promise<Access> {
  const s = await ws.studentFromSession(sessionToken);
  if (s) {
    const cls = await ws.store.getClass(s.classId);
    const t = cls ? await ws.store.teacherById(cls.teacherId) : null;
    // 학급 교사가 지금도 허용 목록에 있어야 학생 권한 유지
    if (t && isAllowedTeacher(list, t)) return { kind: "student", student: s };
  }
  if (siwc) {
    if (!isAllowedTeacher(list, { siwcUserId: siwc.userId, email: siwc.email })) return { kind: "pending-teacher", identity: siwc };
    return { kind: "teacher", teacher: await ws.ensureTeacher(siwc.userId, siwc.name, siwc.email) };
  }
  return { kind: "none" };
}
