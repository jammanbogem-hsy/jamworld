import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedTeacher, parseAllowlist, resolveAccess } from "../lib/server/workshop/policy.ts";
import { Workshop, type Files } from "../lib/server/workshop/service.ts";
import { MemoryStore } from "../lib/server/workshop/store.ts";

const files: Files = { async put() {}, async get() { return null; } };
const T1 = { userId: "u-1", email: "Teacher@School.kr", name: "김선생" };
const OUT = { userId: "u-9", email: "outsider@example.com", name: "외부인" };

test("allowlist 파싱: email:/siwc:/접두 없음, 대소문자 무시", () => {
  const l = parseAllowlist("email:teacher@school.kr, siwc:u-2  other@x.y");
  assert.ok(isAllowedTeacher(l, { siwcUserId: "zz", email: "TEACHER@school.kr" }));
  assert.ok(isAllowedTeacher(l, { siwcUserId: "u-2", email: null }));
  assert.ok(isAllowedTeacher(l, { siwcUserId: "q", email: "other@x.y" }));
  assert.equal(isAllowedTeacher(l, { siwcUserId: "q", email: "nobody@x.y" }), false);
});

test("fail-closed: 목록이 비면 어떤 SIWC 사용자도 교사가 아니다(교사 행도 만들지 않음)", async () => {
  const store = new MemoryStore();
  const ws = new Workshop(store, files, null);
  const a = await resolveAccess(ws, parseAllowlist(""), T1, null);
  assert.equal(a.kind, "pending-teacher");
  assert.equal(store.teachers.length, 0);
  assert.equal((await resolveAccess(ws, parseAllowlist(""), null, null)).kind, "none");
});

test("허용 교사만 교사, 외부 로그인 사용자는 등록 대기 / 교사가 목록에서 빠지면 그 학급 학생 권한도 중지", async () => {
  const store = new MemoryStore();
  const ws = new Workshop(store, files, null);
  const allow = parseAllowlist("email:teacher@school.kr");
  const a = await resolveAccess(ws, allow, T1, null);
  assert.equal(a.kind, "teacher");
  assert.equal((await resolveAccess(ws, allow, OUT, null)).kind, "pending-teacher");
  if (a.kind !== "teacher") return;
  const { inviteToken } = await ws.createClass(a.teacher, "1반");
  const { sessionToken } = await ws.joinClass(inviteToken, "별빛", "1234");
  assert.equal((await resolveAccess(ws, allow, null, sessionToken)).kind, "student");
  // 교사 제외 → 학생 세션도 비용 기능 접근 불가, 교사 신원도 대기 상태
  assert.equal((await resolveAccess(ws, parseAllowlist(""), null, sessionToken)).kind, "none");
  assert.equal((await resolveAccess(ws, parseAllowlist(""), T1, null)).kind, "pending-teacher");
});
