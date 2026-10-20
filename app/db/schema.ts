// 에셋 공방(B) 서버 데이터. 역할·소유권·상태는 모두 서버(D1)가 결정한다. 그림·결과 파일은 R2.
// 시각은 epoch ms 정수. JSON 컬럼은 text 로 저장하고 서비스 계층에서 검증한다.
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** 교사: Sites 로그인(SIWC) 사용자 id 로 식별 */
export const teachers = sqliteTable("teachers", {
  id: text("id").primaryKey(),
  siwcUserId: text("siwc_user_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at").notNull(),
  /** 허용 목록(email) 판정용. 매 요청 SIWC 헤더로 갱신 */
  email: text("email"),
});

/** 학급: 초대 토큰은 해시만 저장 */
export const classes = sqliteTable(
  "classes",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull(),
    name: text("name").notNull(),
    inviteHash: text("invite_hash").notNull(),
    inviteActive: integer("invite_active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("classes_teacher_idx").on(t.teacherId), uniqueIndex("classes_invite_idx").on(t.inviteHash)],
);

/** 학생: 학급 안 별명 + 개인 PIN(솔트 PBKDF2 해시) */
export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull(),
    nickname: text("nickname").notNull(),
    pinHash: text("pin_hash").notNull(),
    pinSalt: text("pin_salt").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: integer("locked_until").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    /** 플레이 아바타 외형(JSON). 없으면 기본 탐험가 */
    avatar: text("avatar"),
  },
  (t) => [uniqueIndex("students_class_nick_idx").on(t.classId, t.nickname)],
);

/** 학생 세션: 쿠키 원문은 저장하지 않고 해시만 */
export const studentSessions = sqliteTable(
  "student_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    studentId: text("student_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("sessions_student_idx").on(t.studentId)],
);

/**
 * 제작 요청. status: draft | pending | rejected | approved | generating | generated | failed | saved | discarded
 * rev 는 낙관적 잠금(CAS)용, version 은 검토 버전(제출할 때마다 증가).
 * approvedSnapshot 은 승인 순간 고정되며 이후 바뀌지 않는다.
 */
export const assetRequests = sqliteTable(
  "asset_requests",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull(),
    studentId: text("student_id").notNull(),
    status: text("status").notNull(),
    rev: integer("rev").notNull().default(0),
    version: integer("version").notNull().default(1),
    draft: text("draft").notNull(),
    uploadKey: text("upload_key"),
    submittedSnapshot: text("submitted_snapshot"),
    approvedSnapshot: text("approved_snapshot"),
    approvedVersion: integer("approved_version"),
    approvedBy: text("approved_by"),
    approvedAt: integer("approved_at"),
    rejectReason: text("reject_reason"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("requests_class_status_idx").on(t.classId, t.status), index("requests_student_idx").on(t.studentId)],
);

/** 생성 실행: 멱등 키 유일 → 같은 승인으로 중복 과금 방지 */
export const generations = sqliteTable(
  "generations",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    approvedVersion: integer("approved_version").notNull(),
    attempt: integer("attempt").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    model: text("model").notNull(),
    outputs: text("outputs"),
    error: text("error"),
    /** provider 호출별 usage(JSON 배열: 출력·토큰·소요 시간). 비용은 설정된 토큰 단가로 계산 */
    usage: text("usage"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [uniqueIndex("generations_idem_idx").on(t.idempotencyKey), uniqueIndex("generations_attempt_idx").on(t.requestId, t.attempt)],
);

/** 학생 보관함 에셋: manifest = 시점별 그림(appearance) + 동작(behavior) + 출처(provenance) */
export const libraryAssets = sqliteTable(
  "library_assets",
  {
    id: text("id").primaryKey(),
    classId: text("class_id").notNull(),
    ownerStudentId: text("owner_student_id").notNull(),
    requestId: text("request_id").notNull().unique(),
    generationId: text("generation_id").notNull(),
    manifest: text("manifest").notNull(),
    shared: integer("shared").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("library_class_idx").on(t.classId), index("library_owner_idx").on(t.ownerStudentId)],
);

/** 감사 기록 */
export const requestEvents = sqliteTable(
  "request_events",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    actor: text("actor").notNull(),
    type: text("type").notNull(),
    data: text("data"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("events_request_idx").on(t.requestId)],
);
