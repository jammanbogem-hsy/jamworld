// D1 저장소. 여러 행을 함께 바꾸는 연산은 batch(트랜잭션)로 묶는다.
// CAS 는 조건부 UPDATE + 같은 batch 의 INSERT … SELECT … WHERE EXISTS(갱신된 상태) 로 원자화한다.
import type { ClassRow, GenerationRow, LibraryRow, RequestRow, SessionRow, Store, StudentRow, TeacherRow } from "./store.ts";
import type { RequestStatus } from "./types.ts";

/** D1Database 중 쓰는 부분만 (workers-types 와 Miniflare 모두 호환) */
export interface D1Like {
  prepare(sql: string): D1StmtLike;
  batch(stmts: D1StmtLike[]): Promise<Array<{ meta: { changes?: number } }>>;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}

const REQ_COLS: Record<keyof RequestRow, string> = {
  id: "id", classId: "class_id", studentId: "student_id", status: "status", rev: "rev", version: "version", draft: "draft",
  uploadKey: "upload_key", submittedSnapshot: "submitted_snapshot", approvedSnapshot: "approved_snapshot", approvedVersion: "approved_version",
  approvedBy: "approved_by", approvedAt: "approved_at", rejectReason: "reject_reason", attempts: "attempts", createdAt: "created_at", updatedAt: "updated_at",
};
const GEN_COLS: Record<keyof GenerationRow, string> = {
  id: "id", requestId: "request_id", approvedVersion: "approved_version", attempt: "attempt", idempotencyKey: "idempotency_key", status: "status",
  model: "model", outputs: "outputs", error: "error", usage: "usage", startedAt: "started_at", finishedAt: "finished_at",
};

function rowTo<T>(cols: Record<string, string>, raw: Record<string, unknown> | null): T | null {
  if (!raw) return null;
  const o: Record<string, unknown> = {};
  for (const [k, c] of Object.entries(cols)) o[k] = raw[c] ?? null;
  return o as T;
}

const TEACHER_COLS = { id: "id", siwcUserId: "siwc_user_id", displayName: "display_name", createdAt: "created_at", email: "email" };
const CLASS_COLS = { id: "id", teacherId: "teacher_id", name: "name", inviteHash: "invite_hash", inviteActive: "invite_active", createdAt: "created_at" };
const STUDENT_COLS = { id: "id", classId: "class_id", nickname: "nickname", pinHash: "pin_hash", pinSalt: "pin_salt", failedAttempts: "failed_attempts", lockedUntil: "locked_until", createdAt: "created_at", avatar: "avatar" };
const SESSION_COLS = { tokenHash: "token_hash", studentId: "student_id", expiresAt: "expires_at", createdAt: "created_at" };
const LIB_COLS = { id: "id", classId: "class_id", ownerStudentId: "owner_student_id", requestId: "request_id", generationId: "generation_id", manifest: "manifest", shared: "shared", createdAt: "created_at" };

function isUnique(e: unknown) {
  return /UNIQUE|constraint/i.test(e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e));
}

function setClause(patch: Partial<RequestRow>) {
  const keys = (Object.keys(patch) as Array<keyof RequestRow>).filter((k) => k !== "rev" && k !== "id");
  return { sql: keys.map((k) => `${REQ_COLS[k]} = ?`).join(", "), values: keys.map((k) => patch[k] ?? null) };
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export class D1Store implements Store {
  private readonly db: D1Like;
  constructor(db: D1Like) {
    this.db = db;
  }

  private one<T>(cols: Record<string, string>, sql: string, ...v: unknown[]) {
    return this.db.prepare(sql).bind(...v).first<Record<string, unknown>>().then((r) => rowTo<T>(cols, r));
  }
  private many<T>(cols: Record<string, string>, sql: string, ...v: unknown[]) {
    return this.db.prepare(sql).bind(...v).all<Record<string, unknown>>().then((r) => r.results.map((x) => rowTo<T>(cols, x)!));
  }

  teacherBySiwc(u: string) {
    return this.one<TeacherRow>(TEACHER_COLS, "SELECT * FROM teachers WHERE siwc_user_id = ?", u);
  }
  async insertTeacher(t: TeacherRow) {
    await this.db.prepare("INSERT INTO teachers (id, siwc_user_id, display_name, created_at, email) VALUES (?, ?, ?, ?, ?)").bind(t.id, t.siwcUserId, t.displayName, t.createdAt, t.email ?? null).run();
  }
  teacherById(id: string) {
    return this.one<TeacherRow>(TEACHER_COLS, "SELECT * FROM teachers WHERE id = ?", id);
  }
  async setTeacherEmail(id: string, email: string) {
    await this.db.prepare("UPDATE teachers SET email = ? WHERE id = ?").bind(email, id).run();
  }
  async insertClass(c: ClassRow) {
    await this.db.prepare("INSERT INTO classes (id, teacher_id, name, invite_hash, invite_active, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(c.id, c.teacherId, c.name, c.inviteHash, c.inviteActive, c.createdAt).run();
  }
  getClass(id: string) {
    return this.one<ClassRow>(CLASS_COLS, "SELECT * FROM classes WHERE id = ?", id);
  }
  classByInviteHash(h: string) {
    return this.one<ClassRow>(CLASS_COLS, "SELECT * FROM classes WHERE invite_hash = ?", h);
  }
  classesByTeacher(t: string) {
    return this.many<ClassRow>(CLASS_COLS, "SELECT * FROM classes WHERE teacher_id = ? ORDER BY created_at DESC", t);
  }
  async setInvite(id: string, inviteHash: string, active: number) {
    await this.db.prepare("UPDATE classes SET invite_hash = ?, invite_active = ? WHERE id = ?").bind(inviteHash, active, id).run();
  }
  async insertStudent(s: StudentRow) {
    try {
      await this.db
        .prepare("INSERT INTO students (id, class_id, nickname, pin_hash, pin_salt, failed_attempts, locked_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(s.id, s.classId, s.nickname, s.pinHash, s.pinSalt, s.failedAttempts, s.lockedUntil, s.createdAt)
        .run();
      return true;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }
  getStudent(id: string) {
    return this.one<StudentRow>(STUDENT_COLS, "SELECT * FROM students WHERE id = ?", id);
  }
  studentByNickname(classId: string, nickname: string) {
    return this.one<StudentRow>(STUDENT_COLS, "SELECT * FROM students WHERE class_id = ? AND nickname = ?", classId, nickname);
  }
  studentsInClass(classId: string) {
    return this.many<StudentRow>(STUDENT_COLS, "SELECT * FROM students WHERE class_id = ? ORDER BY created_at", classId);
  }
  async setStudentAuth(id: string, failedAttempts: number, lockedUntil: number) {
    await this.db.prepare("UPDATE students SET failed_attempts = ?, locked_until = ? WHERE id = ?").bind(failedAttempts, lockedUntil, id).run();
  }
  async setStudentAvatar(id: string, avatar: string | null) {
    await this.db.prepare("UPDATE students SET avatar = ? WHERE id = ?").bind(avatar, id).run();
  }
  async insertSession(s: SessionRow) {
    await this.db.prepare("INSERT INTO student_sessions (token_hash, student_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(s.tokenHash, s.studentId, s.expiresAt, s.createdAt).run();
  }
  getSession(h: string) {
    return this.one<SessionRow>(SESSION_COLS, "SELECT * FROM student_sessions WHERE token_hash = ?", h);
  }
  async deleteSession(h: string) {
    await this.db.prepare("DELETE FROM student_sessions WHERE token_hash = ?").bind(h).run();
  }
  async insertRequest(r: RequestRow) {
    const keys = Object.keys(REQ_COLS) as Array<keyof RequestRow>;
    await this.db
      .prepare(`INSERT INTO asset_requests (${keys.map((k) => REQ_COLS[k]).join(", ")}) VALUES (${placeholders(keys.length)})`)
      .bind(...keys.map((k) => r[k] ?? null))
      .run();
  }
  getRequest(id: string) {
    return this.one<RequestRow>(REQ_COLS, "SELECT * FROM asset_requests WHERE id = ?", id);
  }
  requestsByStudent(s: string) {
    return this.many<RequestRow>(REQ_COLS, "SELECT * FROM asset_requests WHERE student_id = ? ORDER BY updated_at DESC", s);
  }
  requestsByClass(c: string) {
    return this.many<RequestRow>(REQ_COLS, "SELECT * FROM asset_requests WHERE class_id = ? ORDER BY updated_at DESC", c);
  }
  private casStmt(id: string, expectedRev: number, from: RequestStatus[], patch: Partial<RequestRow>) {
    const set = setClause(patch);
    return this.db
      .prepare(`UPDATE asset_requests SET ${set.sql ? `${set.sql}, ` : ""}rev = rev + 1 WHERE id = ? AND rev = ? AND status IN (${placeholders(from.length)})`)
      .bind(...set.values, id, expectedRev, ...from);
  }
  async casRequest(id: string, expectedRev: number, from: RequestStatus[], patch: Partial<RequestRow>) {
    const r = await this.casStmt(id, expectedRev, from, patch).run();
    return (r.meta.changes ?? 0) === 1;
  }
  async beginGeneration(requestId: string, expectedRev: number, from: RequestStatus[], reqPatch: Partial<RequestRow>, g: GenerationRow) {
    const keys = Object.keys(GEN_COLS) as Array<keyof GenerationRow>;
    const insert = this.db
      .prepare(
        `INSERT INTO generations (${keys.map((k) => GEN_COLS[k]).join(", ")}) SELECT ${placeholders(keys.length)} WHERE EXISTS (SELECT 1 FROM asset_requests WHERE id = ? AND rev = ? AND status = ?)`,
      )
      .bind(...keys.map((k) => g[k] ?? null), requestId, expectedRev + 1, reqPatch.status ?? "generating");
    try {
      const [u, i] = await this.db.batch([this.casStmt(requestId, expectedRev, from, reqPatch), insert]);
      if ((u.meta.changes ?? 0) === 1 && (i.meta.changes ?? 0) === 1) return { ok: true as const };
      return { ok: false as const, reason: "conflict" as const };
    } catch (e) {
      if (!isUnique(e)) throw e;
      const existing = await this.generationByKey(g.idempotencyKey);
      return existing ? { ok: false as const, reason: "duplicate" as const, existing } : { ok: false as const, reason: "conflict" as const };
    }
  }
  generationByKey(k: string) {
    return this.one<GenerationRow>(GEN_COLS, "SELECT * FROM generations WHERE idempotency_key = ?", k);
  }
  getGeneration(id: string) {
    return this.one<GenerationRow>(GEN_COLS, "SELECT * FROM generations WHERE id = ?", id);
  }
  latestGeneration(requestId: string) {
    return this.one<GenerationRow>(GEN_COLS, "SELECT * FROM generations WHERE request_id = ? ORDER BY attempt DESC LIMIT 1", requestId);
  }
  async setGenerationUsage(id: string, usage: string) {
    await this.db.prepare("UPDATE generations SET usage = ? WHERE id = ?").bind(usage, id).run();
  }
  async claimGeneration(id: string) {
    const r = await this.db.prepare("UPDATE generations SET status = 'running' WHERE id = ? AND status = 'queued'").bind(id).run();
    return (r.meta.changes ?? 0) === 1;
  }
  async completeGeneration(id: string, p: Pick<GenerationRow, "status" | "outputs" | "error" | "finishedAt" | "usage">, requestId: string, toStatus: RequestStatus, at: number) {
    await this.db.batch([
      this.db.prepare("UPDATE generations SET status = ?, outputs = ?, error = ?, usage = COALESCE(?, usage), finished_at = ? WHERE id = ?").bind(p.status, p.outputs, p.error, p.usage ?? null, p.finishedAt, id),
      this.db.prepare("UPDATE asset_requests SET status = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND status = 'generating'").bind(toStatus, at, requestId),
    ]);
  }
  async saveLibrary(requestId: string, expectedRev: number, a: LibraryRow, at: number) {
    const keys = Object.keys(LIB_COLS) as Array<keyof LibraryRow>;
    try {
      const [u, i] = await this.db.batch([
        this.db.prepare("UPDATE asset_requests SET status = 'saved', rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ? AND status = 'generated'").bind(at, requestId, expectedRev),
        this.db
          .prepare(
            `INSERT INTO library_assets (${keys.map((k) => LIB_COLS[k]).join(", ")}) SELECT ${placeholders(keys.length)} WHERE EXISTS (SELECT 1 FROM asset_requests WHERE id = ? AND rev = ? AND status = 'saved')`,
          )
          .bind(...keys.map((k) => a[k]), requestId, expectedRev + 1),
      ]);
      return (u.meta.changes ?? 0) === 1 && (i.meta.changes ?? 0) === 1;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }
  libraryForStudent(studentId: string, classId: string) {
    return this.many<LibraryRow>(LIB_COLS, "SELECT * FROM library_assets WHERE owner_student_id = ? OR (class_id = ? AND shared = 1) ORDER BY created_at DESC", studentId, classId);
  }
  libraryForClass(classId: string) {
    return this.many<LibraryRow>(LIB_COLS, "SELECT * FROM library_assets WHERE class_id = ? ORDER BY created_at DESC", classId);
  }
  getLibrary(id: string) {
    return this.one<LibraryRow>(LIB_COLS, "SELECT * FROM library_assets WHERE id = ?", id);
  }
  async insertEvent(e: { id: string; requestId: string; actor: string; type: string; data: string | null; createdAt: number }) {
    await this.db.prepare("INSERT INTO request_events (id, request_id, actor, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(e.id, e.requestId, e.actor, e.type, e.data, e.createdAt).run();
  }
}
