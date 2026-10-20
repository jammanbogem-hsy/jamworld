// 저장소 경계: 서비스 계층은 이 인터페이스만 쓴다. D1 구현(d1-store.ts)과 테스트용 메모리 구현(아래).
// 자체 호스팅 이전 시 SQLite/Postgres 구현으로 교체할 수 있다.
import type { RequestStatus } from "./types.ts";

export interface TeacherRow {
  id: string;
  siwcUserId: string;
  displayName: string;
  createdAt: number;
  email?: string | null;
}
export interface ClassRow {
  id: string;
  teacherId: string;
  name: string;
  inviteHash: string;
  inviteActive: number;
  createdAt: number;
}
export interface StudentRow {
  id: string;
  classId: string;
  nickname: string;
  pinHash: string;
  pinSalt: string;
  failedAttempts: number;
  lockedUntil: number;
  createdAt: number;
  avatar?: string | null;
}
export interface SessionRow {
  tokenHash: string;
  studentId: string;
  expiresAt: number;
  createdAt: number;
}
export interface RequestRow {
  id: string;
  classId: string;
  studentId: string;
  status: RequestStatus;
  rev: number;
  version: number;
  draft: string;
  uploadKey: string | null;
  submittedSnapshot: string | null;
  approvedSnapshot: string | null;
  approvedVersion: number | null;
  approvedBy: string | null;
  approvedAt: number | null;
  rejectReason: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}
export interface GenerationRow {
  id: string;
  requestId: string;
  approvedVersion: number;
  attempt: number;
  idempotencyKey: string;
  /** queued: 시작 기록됨, running: 실행 claim 됨 */
  status: "queued" | "running" | "succeeded" | "failed";
  model: string;
  outputs: string | null;
  error: string | null;
  /** provider 호출별 usage JSON */
  usage?: string | null;
  startedAt: number;
  finishedAt: number | null;
}
export interface LibraryRow {
  id: string;
  classId: string;
  ownerStudentId: string;
  requestId: string;
  generationId: string;
  manifest: string;
  shared: number;
  createdAt: number;
}

export interface Store {
  teacherBySiwc(siwcUserId: string): Promise<TeacherRow | null>;
  insertTeacher(t: TeacherRow): Promise<void>;
  teacherById(id: string): Promise<TeacherRow | null>;
  setTeacherEmail(id: string, email: string): Promise<void>;

  insertClass(c: ClassRow): Promise<void>;
  getClass(id: string): Promise<ClassRow | null>;
  classByInviteHash(hash: string): Promise<ClassRow | null>;
  classesByTeacher(teacherId: string): Promise<ClassRow[]>;
  setInvite(id: string, inviteHash: string, active: number): Promise<void>;

  insertStudent(s: StudentRow): Promise<boolean>; // 별명 중복이면 false
  getStudent(id: string): Promise<StudentRow | null>;
  studentByNickname(classId: string, nickname: string): Promise<StudentRow | null>;
  studentsInClass(classId: string): Promise<StudentRow[]>;
  setStudentAuth(id: string, failedAttempts: number, lockedUntil: number): Promise<void>;
  setStudentAvatar(id: string, avatar: string | null): Promise<void>;

  insertSession(s: SessionRow): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRow | null>;
  deleteSession(tokenHash: string): Promise<void>;

  insertRequest(r: RequestRow): Promise<void>;
  getRequest(id: string): Promise<RequestRow | null>;
  requestsByStudent(studentId: string): Promise<RequestRow[]>;
  requestsByClass(classId: string): Promise<RequestRow[]>;
  /** CAS: rev 가 expectedRev 이고 status 가 expectedStatus 중 하나일 때만 갱신(rev+1). 성공 여부 */
  casRequest(id: string, expectedRev: number, expectedStatus: RequestStatus[], patch: Partial<RequestRow>): Promise<boolean>;

  /**
   * 생성 시작(원자): 요청 CAS(rev·상태) 와 생성 기록 삽입을 한 트랜잭션으로. 둘 중 하나라도 안 되면 아무것도 바뀌지 않는다.
   * duplicate: 같은 멱등 키가 이미 있음(existing 반환), conflict: CAS 실패
   */
  beginGeneration(
    requestId: string,
    expectedRev: number,
    from: RequestStatus[],
    reqPatch: Partial<RequestRow>,
    gen: GenerationRow,
  ): Promise<{ ok: true } | { ok: false; reason: "conflict" | "duplicate"; existing?: GenerationRow }>;
  generationByKey(idempotencyKey: string): Promise<GenerationRow | null>;
  getGeneration(id: string): Promise<GenerationRow | null>;
  latestGeneration(requestId: string): Promise<GenerationRow | null>;
  /** 성공한 provider 호출마다 즉시 usage 저장 (중간에 끊겨도 과금 기록 보존) */
  setGenerationUsage(id: string, usage: string): Promise<void>;
  /** 실행 claim: queued → running 을 한 번만 허용 */
  claimGeneration(id: string, at: number): Promise<boolean>;
  /** 완료(원자): 생성 기록 종료 + 요청 generating → toStatus */
  completeGeneration(id: string, patch: Pick<GenerationRow, "status" | "outputs" | "error" | "finishedAt" | "usage">, requestId: string, toStatus: RequestStatus, at: number): Promise<void>;

  /** 보관함 저장(원자): 요청 CAS generated → saved + 에셋 삽입. 실패하면 둘 다 그대로 */
  saveLibrary(requestId: string, expectedRev: number, a: LibraryRow, at: number): Promise<boolean>;
  libraryForStudent(studentId: string, classId: string): Promise<LibraryRow[]>;
  libraryForClass(classId: string): Promise<LibraryRow[]>;
  getLibrary(id: string): Promise<LibraryRow | null>;

  insertEvent(e: { id: string; requestId: string; actor: string; type: string; data: string | null; createdAt: number }): Promise<void>;
}

/** 테스트·로컬 시험용 메모리 저장소 (D1 과 같은 제약: 유일 인덱스, CAS) */
export class MemoryStore implements Store {
  teachers: TeacherRow[] = [];
  classes: ClassRow[] = [];
  students: StudentRow[] = [];
  sessions: SessionRow[] = [];
  requests: RequestRow[] = [];
  generations: GenerationRow[] = [];
  library: LibraryRow[] = [];
  events: Array<{ id: string; requestId: string; actor: string; type: string; data: string | null; createdAt: number }> = [];

  async teacherBySiwc(u: string) {
    return this.teachers.find((t) => t.siwcUserId === u) ?? null;
  }
  async insertTeacher(t: TeacherRow) {
    if (this.teachers.some((q) => q.siwcUserId === t.siwcUserId)) throw new Error("UNIQUE teachers.siwc_user_id");
    this.teachers.push({ ...t });
  }
  async teacherById(id: string) {
    return this.teachers.find((t) => t.id === id) ?? null;
  }
  async setTeacherEmail(id: string, email: string) {
    const t = this.teachers.find((q) => q.id === id);
    if (t) t.email = email;
  }
  async insertClass(c: ClassRow) {
    this.classes.push({ ...c });
  }
  async getClass(id: string) {
    return this.classes.find((c) => c.id === id) ?? null;
  }
  async classByInviteHash(h: string) {
    return this.classes.find((c) => c.inviteHash === h) ?? null;
  }
  async classesByTeacher(t: string) {
    return this.classes.filter((c) => c.teacherId === t);
  }
  async setInvite(id: string, inviteHash: string, active: number) {
    const c = this.classes.find((q) => q.id === id);
    if (c) Object.assign(c, { inviteHash, inviteActive: active });
  }
  async insertStudent(s: StudentRow) {
    if (this.students.some((q) => q.classId === s.classId && q.nickname === s.nickname)) return false;
    this.students.push({ ...s });
    return true;
  }
  async getStudent(id: string) {
    return this.students.find((s) => s.id === id) ?? null;
  }
  async studentByNickname(classId: string, nickname: string) {
    return this.students.find((s) => s.classId === classId && s.nickname === nickname) ?? null;
  }
  async studentsInClass(classId: string) {
    return this.students.filter((s) => s.classId === classId);
  }
  async setStudentAuth(id: string, failedAttempts: number, lockedUntil: number) {
    const s = this.students.find((q) => q.id === id);
    if (s) Object.assign(s, { failedAttempts, lockedUntil });
  }
  async setStudentAvatar(id: string, avatar: string | null) {
    const s = this.students.find((q) => q.id === id);
    if (s) s.avatar = avatar;
  }
  async insertSession(s: SessionRow) {
    this.sessions.push({ ...s });
  }
  async getSession(h: string) {
    return this.sessions.find((s) => s.tokenHash === h) ?? null;
  }
  async deleteSession(h: string) {
    this.sessions = this.sessions.filter((s) => s.tokenHash !== h);
  }
  async insertRequest(r: RequestRow) {
    this.requests.push({ ...r });
  }
  async getRequest(id: string) {
    const r = this.requests.find((q) => q.id === id);
    return r ? { ...r } : null;
  }
  async requestsByStudent(studentId: string) {
    return this.requests.filter((r) => r.studentId === studentId).map((r) => ({ ...r }));
  }
  async requestsByClass(classId: string) {
    return this.requests.filter((r) => r.classId === classId).map((r) => ({ ...r }));
  }
  async casRequest(id: string, expectedRev: number, expectedStatus: RequestStatus[], patch: Partial<RequestRow>) {
    const r = this.requests.find((q) => q.id === id);
    if (!r || r.rev !== expectedRev || !expectedStatus.includes(r.status)) return false;
    Object.assign(r, patch, { rev: r.rev + 1 });
    return true;
  }
  async beginGeneration(requestId: string, expectedRev: number, from: RequestStatus[], reqPatch: Partial<RequestRow>, gen: GenerationRow) {
    const existing = this.generations.find((q) => q.idempotencyKey === gen.idempotencyKey);
    if (existing) return { ok: false as const, reason: "duplicate" as const, existing: { ...existing } };
    const r = this.requests.find((q) => q.id === requestId);
    if (!r || r.rev !== expectedRev || !from.includes(r.status)) return { ok: false as const, reason: "conflict" as const };
    if (this.generations.some((q) => q.requestId === gen.requestId && q.attempt === gen.attempt)) return { ok: false as const, reason: "conflict" as const };
    Object.assign(r, reqPatch, { rev: r.rev + 1 });
    this.generations.push({ ...gen });
    return { ok: true as const };
  }
  async generationByKey(k: string) {
    const g = this.generations.find((q) => q.idempotencyKey === k);
    return g ? { ...g } : null;
  }
  async getGeneration(id: string) {
    const g = this.generations.find((q) => q.id === id);
    return g ? { ...g } : null;
  }
  async latestGeneration(requestId: string) {
    const list = this.generations.filter((g) => g.requestId === requestId).sort((a, b) => b.attempt - a.attempt);
    return list[0] ? { ...list[0] } : null;
  }
  async setGenerationUsage(id: string, usage: string) {
    const g = this.generations.find((q) => q.id === id);
    if (g) g.usage = usage;
  }
  async claimGeneration(id: string) {
    const g = this.generations.find((q) => q.id === id);
    if (!g || g.status !== "queued") return false;
    g.status = "running";
    return true;
  }
  async completeGeneration(id: string, patch: Pick<GenerationRow, "status" | "outputs" | "error" | "finishedAt" | "usage">, requestId: string, toStatus: RequestStatus, at: number) {
    const g = this.generations.find((q) => q.id === id);
    if (g) Object.assign(g, patch);
    const r = this.requests.find((q) => q.id === requestId);
    if (r && r.status === "generating") Object.assign(r, { status: toStatus, rev: r.rev + 1, updatedAt: at });
  }
  async saveLibrary(requestId: string, expectedRev: number, a: LibraryRow, at: number) {
    const r = this.requests.find((q) => q.id === requestId);
    if (!r || r.rev !== expectedRev || r.status !== "generated" || this.library.some((q) => q.requestId === requestId)) return false;
    Object.assign(r, { status: "saved", rev: r.rev + 1, updatedAt: at });
    this.library.push({ ...a });
    return true;
  }
  async libraryForStudent(studentId: string, classId: string) {
    return this.library.filter((a) => a.ownerStudentId === studentId || (a.classId === classId && a.shared === 1));
  }
  async libraryForClass(classId: string) {
    return this.library.filter((a) => a.classId === classId);
  }
  async getLibrary(id: string) {
    return this.library.find((a) => a.id === id) ?? null;
  }
  async insertEvent(e: { id: string; requestId: string; actor: string; type: string; data: string | null; createdAt: number }) {
    this.events.push(e);
  }
}
