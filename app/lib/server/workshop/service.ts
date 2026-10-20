// 에셋 공방 서비스: 역할·소유권·상태 전이는 모두 여기서 서버가 판정한다(요청 payload 의 역할/소유 정보는 믿지 않음).
// 상태 변경은 CAS(rev) 로, 생성 시작은 CAS + 멱등 키로 중복 실행·중복 과금을 막는다.
import { hashPin, randomId, randomToken, safeEqual, sha256, sha256Bytes } from "./crypto.ts";
import { IMAGE_MODEL, isoPrompt, texturePrompt, topDownPrompt } from "./prompts.ts";
import { freezeCost, parsePricing, type ImageUsage, type PricingConfig, type UsageEntry } from "./pricing.ts";
import type { ClassRow, GenerationRow, RequestRow, StudentRow, Store, TeacherRow } from "./store.ts";
import { AVATAR_COLORS, AVATAR_HAIR, type AvatarLook } from "./avatar.ts";
import {
  ASSET_CATEGORIES,
  type ApprovedSnapshot,
  type GenerationOutputs,
  type LibraryManifest,
  type RequestDraft,
  type RequestStatus,
} from "./types.ts";

export class WorkshopError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface Files {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export interface ImageProvider {
  readonly model: string;
  /** references 가 있으면 edit(참조 이미지), 없으면 generate */
  create(opts: { prompt: string; background: "transparent" | "opaque"; references?: Array<{ bytes: Uint8Array; contentType: string }> }): Promise<{ bytes: Uint8Array; contentType: string; usage?: ImageUsage | null }>;
}

export type Actor = { kind: "teacher"; teacher: TeacherRow } | { kind: "student"; student: StudentRow };

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
export const MAX_PIN_FAILS = 5;
export const LOCK_MS = 5 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_ATTEMPTS = 3;
/** 이 시간 넘게 queued/running 이면 연결이 끊겨 중단된 것으로 보고 실패 처리(재시도 가능) */
export const STALE_GENERATION_MS = 8 * 60 * 1000;

const NICK_RE = /^[\p{L}\p{N}_ -]{1,16}$/u;
const PIN_RE = /^\d{4,6}$/;

export class Workshop {
  readonly store: Store;
  readonly files: Files;
  readonly provider: ImageProvider | null;
  readonly now: () => number;
  readonly pricing: PricingConfig;

  constructor(store: Store, files: Files, provider: ImageProvider | null, now: () => number = Date.now, pricing: PricingConfig = parsePricing(null)) {
    this.store = store;
    this.files = files;
    this.provider = provider;
    this.now = now;
    this.pricing = pricing;
  }

  // ---------- 교사 ----------

  /** Sites 로그인(SIWC) 사용자 → 교사 (최초 방문 시 생성) */
  /** 허용 목록 판정은 호출자(policy.resolveAccess)가 먼저 한다. 여기서는 행 생성·email 갱신만 */
  async ensureTeacher(siwcUserId: string, displayName: string, email: string | null = null): Promise<TeacherRow> {
    const t = await this.store.teacherBySiwc(siwcUserId);
    if (t) {
      if (email && t.email !== email) {
        await this.store.setTeacherEmail(t.id, email);
        t.email = email;
      }
      return t;
    }
    const row = { id: randomId("tch"), siwcUserId, displayName: displayName.slice(0, 60) || "선생님", createdAt: this.now(), email };
    try {
      await this.store.insertTeacher(row);
      return row;
    } catch {
      const again = await this.store.teacherBySiwc(siwcUserId);
      if (again) return again;
      throw new WorkshopError("teacher", "교사 계정을 만들 수 없습니다", 500);
    }
  }

  async createClass(t: TeacherRow, name: string): Promise<{ cls: ClassRow; inviteToken: string }> {
    const n = name.trim().slice(0, 40);
    if (!n) throw new WorkshopError("name", "학급 이름을 입력하세요");
    const inviteToken = randomToken(18);
    const cls = { id: randomId("cls"), teacherId: t.id, name: n, inviteHash: await sha256(inviteToken), inviteActive: 1, createdAt: this.now() };
    await this.store.insertClass(cls);
    return { cls, inviteToken };
  }

  /** 초대 링크 재발급(이전 링크 무효) 또는 중지 */
  async rotateInvite(t: TeacherRow, classId: string, active = true): Promise<string | null> {
    await this.ownClass(t, classId);
    const token = randomToken(18);
    await this.store.setInvite(classId, await sha256(token), active ? 1 : 0);
    return active ? token : null;
  }

  async ownClass(t: TeacherRow, classId: string): Promise<ClassRow> {
    const c = await this.store.getClass(classId);
    if (!c || c.teacherId !== t.id) throw new WorkshopError("forbidden", "이 학급의 교사가 아닙니다", 403);
    return c;
  }

  // ---------- 학생 접속 (초대 링크 + 별명 + 개인 PIN) ----------

  private async classFromInvite(inviteToken: string): Promise<ClassRow> {
    const c = await this.store.classByInviteHash(await sha256(String(inviteToken ?? "")));
    if (!c || !c.inviteActive) throw new WorkshopError("invite", "초대 링크가 올바르지 않거나 만료되었습니다", 404);
    return c;
  }

  private async newSession(studentId: string): Promise<string> {
    const token = randomToken(32);
    await this.store.insertSession({ tokenHash: await sha256(token), studentId, expiresAt: this.now() + SESSION_TTL_MS, createdAt: this.now() });
    return token;
  }

  async joinClass(inviteToken: string, nickname: string, pin: string): Promise<{ student: StudentRow; sessionToken: string }> {
    const c = await this.classFromInvite(inviteToken);
    const nick = String(nickname ?? "").trim();
    if (!NICK_RE.test(nick)) throw new WorkshopError("nickname", "별명은 1~16자(글자·숫자·_·-·공백)로 정해 주세요");
    if (!PIN_RE.test(String(pin ?? ""))) throw new WorkshopError("pin", "PIN 은 숫자 4~6자리예요");
    const salt = randomToken(16);
    const student = { id: randomId("stu"), classId: c.id, nickname: nick, pinHash: await hashPin(pin, salt), pinSalt: salt, failedAttempts: 0, lockedUntil: 0, createdAt: this.now() };
    if (!(await this.store.insertStudent(student))) throw new WorkshopError("nickname_taken", "이미 있는 별명이에요. 내 별명이면 '다시 들어가기'로 PIN 을 입력하세요", 409);
    return { student, sessionToken: await this.newSession(student.id) };
  }

  async loginStudent(inviteToken: string, nickname: string, pin: string): Promise<{ student: StudentRow; sessionToken: string }> {
    const c = await this.classFromInvite(inviteToken);
    const s = await this.store.studentByNickname(c.id, String(nickname ?? "").trim());
    const fail = new WorkshopError("login", "별명이나 PIN 이 맞지 않아요", 401);
    if (!s) throw fail;
    if (s.lockedUntil > this.now()) throw new WorkshopError("locked", "PIN 을 여러 번 틀려 잠시 잠겼어요. 몇 분 뒤 다시 시도하거나 선생님께 말씀하세요", 429);
    const ok = safeEqual(await hashPin(String(pin ?? ""), s.pinSalt), s.pinHash);
    if (!ok) {
      const fails = s.failedAttempts + 1;
      await this.store.setStudentAuth(s.id, fails >= MAX_PIN_FAILS ? 0 : fails, fails >= MAX_PIN_FAILS ? this.now() + LOCK_MS : 0);
      throw fail;
    }
    if (s.failedAttempts) await this.store.setStudentAuth(s.id, 0, 0);
    return { student: s, sessionToken: await this.newSession(s.id) };
  }

  async studentFromSession(token: string | null | undefined): Promise<StudentRow | null> {
    if (!token) return null;
    const sess = await this.store.getSession(await sha256(token));
    if (!sess || sess.expiresAt < this.now()) return null;
    return this.store.getStudent(sess.studentId);
  }

  async logout(token: string) {
    await this.store.deleteSession(await sha256(token));
  }

  // ---------- 플레이 아바타 (학생 프로필) ----------

  /** 기본 제공 외형 선택: 무료·즉시. 값은 서버가 허용 목록으로 검증 */
  async setAvatar(s: StudentRow, input: unknown) {
    const a = validateAvatar(input);
    await this.store.setStudentAvatar(s.id, JSON.stringify(a));
    return a;
  }

  // ---------- 제작 요청 (학생) ----------

  validateDraft(input: unknown): RequestDraft {
    const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const name = String(o.name ?? "").trim().slice(0, 30);
    if (!name) throw new WorkshopError("draft", "에셋 이름을 입력하세요");
    const category = String(o.category ?? "") as RequestDraft["category"];
    if (!ASSET_CATEGORIES.includes(category)) throw new WorkshopError("draft", "분류를 골라 주세요");
    const tags = (Array.isArray(o.tags) ? o.tags : String(o.tags ?? "").split(/[,\s]+/))
      .map((t) => String(t).trim().slice(0, 12))
      .filter(Boolean);
    const uniq = [...new Set(tags)].slice(0, 8);
    if (!uniq.length) throw new WorkshopError("draft", "검색 태그를 1개 이상 넣어 주세요");
    const fp = (o.footprint ?? {}) as Record<string, unknown>;
    const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
    };
    const terrain = category === "terrain";
    return {
      name,
      description: String(o.description ?? "").trim().slice(0, 300),
      category,
      tags: uniq,
      footprint: terrain ? { w: 1, d: 1 } : { w: clampInt(fp.w, 1, 3, 1), d: clampInt(fp.d, 1, 3, 1) },
      passable: Boolean(o.passable ?? terrain),
      height: terrain ? 0 : Math.max(0.2, Math.min(3, Number(o.height) || 1)),
    };
  }

  async createRequest(s: StudentRow, draftInput: unknown): Promise<RequestRow> {
    const draft = this.validateDraft(draftInput);
    const t = this.now();
    const row: RequestRow = {
      id: randomId("req"), classId: s.classId, studentId: s.id, status: "draft", rev: 0, version: 1, draft: JSON.stringify(draft),
      uploadKey: null, submittedSnapshot: null, approvedSnapshot: null, approvedVersion: null, approvedBy: null, approvedAt: null,
      rejectReason: null, attempts: 0, createdAt: t, updatedAt: t,
    };
    await this.store.insertRequest(row);
    await this.event(row.id, `student:${s.id}`, "create");
    return row;
  }

  /** 학생 본인 요청만 */
  async ownRequest(s: StudentRow, id: string): Promise<RequestRow> {
    const r = await this.store.getRequest(id);
    if (!r || r.studentId !== s.id) throw new WorkshopError("not_found", "요청을 찾을 수 없어요", 404);
    return r;
  }

  private async cas(r: RequestRow, rev: number, from: RequestStatus[], patch: Partial<RequestRow>, conflictMsg = "다른 곳에서 먼저 바뀌었어요. 새로고침 후 다시 시도하세요") {
    if (!from.includes(r.status)) throw new WorkshopError("state", `지금 상태(${r.status})에서는 할 수 없어요`, 409);
    const ok = await this.store.casRequest(r.id, rev, from, { ...patch, updatedAt: this.now() });
    if (!ok) throw new WorkshopError("conflict", conflictMsg, 409);
  }

  /** 초안·반려 상태에서만 수정. 반려된 요청을 고치면 새 버전 초안이 된다 */
  async updateDraft(s: StudentRow, id: string, rev: number, draftInput: unknown) {
    const r = await this.ownRequest(s, id);
    const draft = this.validateDraft(draftInput);
    await this.cas(r, rev, ["draft", "rejected"], {
      draft: JSON.stringify(draft),
      status: "draft",
      ...(r.status === "rejected" ? { version: r.version + 1, rejectReason: null } : {}),
    });
  }

  async attachUpload(s: StudentRow, id: string, rev: number, bytes: Uint8Array, contentType: string) {
    const r = await this.ownRequest(s, id);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new WorkshopError("upload", "그림 파일은 4MB 이하만 올릴 수 있어요", 413);
    const kind = sniffImage(bytes);
    if (!kind) throw new WorkshopError("upload", "PNG·JPEG·WEBP 그림만 올릴 수 있어요", 415);
    // 버전마다 새 키 → 승인된 스냅샷이 가리키는 파일은 이후 바뀌지 않는다
    const key = `cls/${r.classId}/req/${r.id}/upload-v${r.status === "rejected" ? r.version + 1 : r.version}-${randomToken(6)}.${kind.ext}`;
    await this.files.put(key, bytes, kind.type);
    await this.cas(r, rev, ["draft", "rejected"], {
      uploadKey: key,
      status: "draft",
      ...(r.status === "rejected" ? { version: r.version + 1, rejectReason: null } : {}),
    });
    void contentType;
    return key;
  }

  async submit(s: StudentRow, id: string, rev: number) {
    const r = await this.ownRequest(s, id);
    const draft = this.validateDraft(JSON.parse(r.draft));
    let uploadSha256: string | null = null;
    if (r.uploadKey) {
      const f = await this.files.get(r.uploadKey);
      if (!f) throw new WorkshopError("upload", "첨부한 그림을 찾을 수 없어요. 다시 올려 주세요", 409);
      uploadSha256 = await sha256Bytes(f.bytes);
    }
    const snap: ApprovedSnapshot = {
      version: r.version,
      draft,
      uploadKey: r.uploadKey,
      uploadSha256,
      outputs: draft.category === "terrain" ? ["texture"] : ["td", "iso"],
    };
    await this.cas(r, rev, ["draft"], { status: "pending", submittedSnapshot: JSON.stringify(snap) });
    await this.event(r.id, `student:${s.id}`, "submit", { version: r.version });
  }

  /** 승인 대기 중 회수: 새 버전 초안으로 돌아간다 */
  async withdraw(s: StudentRow, id: string, rev: number) {
    const r = await this.ownRequest(s, id);
    await this.cas(r, rev, ["pending"], { status: "draft", version: r.version + 1, submittedSnapshot: null });
  }

  // ---------- 교사 검토 ----------

  async requestForTeacher(t: TeacherRow, id: string): Promise<RequestRow> {
    const r = await this.store.getRequest(id);
    if (!r) throw new WorkshopError("not_found", "요청을 찾을 수 없어요", 404);
    await this.ownClass(t, r.classId);
    return r;
  }

  /** 제출된 스냅샷을 그대로 승인 스냅샷으로 고정 */
  async approve(t: TeacherRow, id: string, rev: number) {
    const r = await this.requestForTeacher(t, id);
    if (!r.submittedSnapshot) throw new WorkshopError("state", "제출된 내용이 없어요", 409);
    await this.cas(r, rev, ["pending"], {
      status: "approved",
      approvedSnapshot: r.submittedSnapshot,
      approvedVersion: r.version,
      approvedBy: t.id,
      approvedAt: this.now(),
    });
    await this.event(r.id, `teacher:${t.id}`, "approve", { version: r.version });
  }

  async reject(t: TeacherRow, id: string, rev: number, reason: string) {
    const r = await this.requestForTeacher(t, id);
    const why = String(reason ?? "").trim().slice(0, 200);
    if (!why) throw new WorkshopError("reason", "반려 사유를 적어 주세요");
    await this.cas(r, rev, ["pending"], { status: "rejected", rejectReason: why });
    await this.event(r.id, `teacher:${t.id}`, "reject", { reason: why });
  }

  /**
   * 생성 시작(교사). 같은 멱등 키 재요청·동시 클릭은 기존 실행을 돌려준다(중복 과금 없음).
   * 실패 후 재시도는 새 키로 최대 MAX_ATTEMPTS 회.
   */
  async startGeneration(t: TeacherRow, id: string, idempotencyKey: string): Promise<{ generation: GenerationRow; started: boolean }> {
    const key = String(idempotencyKey ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new WorkshopError("idempotency", "Idempotency-Key 가 필요합니다");
    await this.requestForTeacher(t, id);
    await this.recoverIfStale(id);
    const r = await this.requestForTeacher(t, id);
    const fullKey = `${r.id}:${key}`;
    const same = await this.store.generationByKey(fullKey);
    if (same) return { generation: same, started: false };
    if (r.status === "generating") {
      const cur = await this.store.latestGeneration(r.id);
      if (cur) return { generation: cur, started: false };
    }
    if (!["approved", "failed"].includes(r.status)) throw new WorkshopError("state", `지금 상태(${r.status})에서는 생성할 수 없어요`, 409);
    if (!this.provider) throw new WorkshopError("provider", "서버에 이미지 생성 키(OPENAI_API_KEY)가 설정되지 않아 생성할 수 없어요", 503);
    if (r.attempts >= MAX_ATTEMPTS) throw new WorkshopError("attempts", `생성은 최대 ${MAX_ATTEMPTS}번까지 시도할 수 있어요`, 409);
    const gen: GenerationRow = {
      id: randomId("gen"), requestId: r.id, approvedVersion: r.approvedVersion ?? r.version, attempt: r.attempts + 1,
      idempotencyKey: fullKey, status: "queued", model: this.provider.model, outputs: null, error: null, startedAt: this.now(), finishedAt: null,
    };
    // 요청 CAS + 생성 기록을 한 트랜잭션으로: 중간 실패로 'generating 인데 기록 없음' 상태가 생기지 않는다
    const res = await this.store.beginGeneration(r.id, r.rev, ["approved", "failed"], { status: "generating", attempts: r.attempts + 1, updatedAt: this.now() }, gen);
    if (!res.ok) {
      if (res.reason === "duplicate" && res.existing) return { generation: res.existing, started: false };
      const cur = await this.store.latestGeneration(r.id);
      if (cur && (cur.status === "queued" || cur.status === "running")) return { generation: cur, started: false };
      throw new WorkshopError("conflict", "이미 생성이 시작됐거나 상태가 바뀌었어요. 새로고침하세요", 409);
    }
    await this.event(r.id, `teacher:${t.id}`, "generate", { attempt: gen.attempt });
    return { generation: gen, started: true };
  }

  /** 연결이 끊겨 오래 멈춘 생성은 실패로 바꿔 재시도할 수 있게 한다 */
  async recoverIfStale(requestId: string): Promise<boolean> {
    const r = await this.store.getRequest(requestId);
    if (!r || r.status !== "generating") return false;
    const g = await this.store.latestGeneration(requestId);
    const stale = !g || ((g.status === "queued" || g.status === "running") && this.now() - g.startedAt > STALE_GENERATION_MS);
    if (!stale) return false;
    if (g) await this.store.completeGeneration(g.id, { status: "failed", outputs: g.outputs, error: "연결이 끊겨 생성이 중단됐어요. 다시 시도할 수 있어요", finishedAt: this.now() }, requestId, "failed", this.now());
    else await this.store.casRequest(r.id, r.rev, ["generating"], { status: "failed", updatedAt: this.now() });
    return true;
  }

  /**
   * 실제 생성 실행. 연결을 유지한 요청 안에서 await 한다(응답 후 waitUntil 은 30초 제한이라 쓰지 않음).
   * queued → running claim 을 통과한 한 번만 provider 를 호출한다. 승인 스냅샷만 사용.
   */
  async runGeneration(generationId: string): Promise<GenerationRow> {
    const gen0 = await this.store.getGeneration(generationId);
    if (!gen0) throw new WorkshopError("not_found", "생성 기록이 없습니다", 404);
    if (!(await this.store.claimGeneration(generationId, this.now()))) throw new WorkshopError("claimed", "이미 실행 중이거나 끝난 생성입니다", 409);
    const gen = { ...gen0, status: "running" as const };
    const r = await this.store.getRequest(gen.requestId);
    if (!r?.approvedSnapshot || r.status !== "generating") throw new WorkshopError("state", "생성할 승인 내용이 없습니다", 409);
    const snap = JSON.parse(r.approvedSnapshot) as ApprovedSnapshot;
    const provider = this.provider;
    const out: GenerationOutputs = {};
    const usage: UsageEntry[] = [];
    // provider 호출 1회 = 이미지 1장. 응답 usage(토큰)와 소요 시간을 기록해 비용 계산에 쓴다
    // 호출 직전에 pending 으로 기록 → 응답 후 ok/failed 로 갱신. 중간에 끊겨도 '시도했으나 미확인' 이 남는다
    const call = async (output: UsageEntry["output"], o: Parameters<ImageProvider["create"]>[0]) => {
      const t0 = Date.now();
      const entry: UsageEntry = { output, model: provider!.model, usage: null, ms: 0, attempt: gen.attempt, hadReferences: !!o.references?.length, status: "pending" };
      usage.push(entry);
      await this.store.setGenerationUsage(gen.id, JSON.stringify({ entries: usage }));
      try {
        const img = await provider!.create(o);
        Object.assign(entry, { usage: img.usage ?? null, ms: Date.now() - t0, status: "ok" });
        return img;
      } catch (e) {
        Object.assign(entry, { ms: Date.now() - t0, status: "failed" });
        throw e;
      } finally {
        await this.store.setGenerationUsage(gen.id, JSON.stringify({ entries: usage }));
      }
    };
    try {
      if (!provider) throw new Error("이미지 생성 키가 설정되지 않았습니다");
      const base = `cls/${r.classId}/gen/${gen.id}`;
      if (snap.outputs.includes("texture")) {
        const drawing = await this.approvedDrawing(snap);
        const img = await call("texture", { prompt: texturePrompt(snap, !!drawing), background: "opaque", references: drawing ? [drawing] : undefined });
        out.texture = `${base}/texture.webp`;
        await this.files.put(out.texture, img.bytes, img.contentType);
      } else {
        const drawing = await this.approvedDrawing(snap);
        const td = await call("td", { prompt: topDownPrompt(snap, !!drawing), background: "transparent", references: drawing ? [drawing] : undefined });
        out.td = `${base}/td.webp`;
        await this.files.put(out.td, td.bytes, td.contentType);
        // 탑뷰 결과를 참조로 아이소를 만들어 두 시점의 일관성을 맞춘다
        const iso = await call("iso", { prompt: isoPrompt(snap), background: "transparent", references: [td] });
        out.iso = `${base}/iso.webp`;
        await this.files.put(out.iso, iso.bytes, iso.contentType);
      }
      await this.store.completeGeneration(gen.id, { status: "succeeded", outputs: JSON.stringify(out), error: null, usage: JSON.stringify(freezeCost(usage, this.pricing, this.now())), finishedAt: this.now() }, r.id, "generated", this.now());
      return { ...gen, status: "succeeded", outputs: JSON.stringify(out) };
    } catch (e) {
      const msg = sanitizeError(e);
      await this.store.completeGeneration(gen.id, { status: "failed", outputs: Object.keys(out).length ? JSON.stringify(out) : null, error: msg, usage: JSON.stringify(freezeCost(usage, this.pricing, this.now())), finishedAt: this.now() }, r.id, "failed", this.now());
      return { ...gen, status: "failed", error: msg };
    }
  }

  /** 승인 스냅샷이 가리키는 학생 그림 (내용 해시가 승인 때와 같아야 함) */
  private async approvedDrawing(snap: ApprovedSnapshot): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    if (!snap.uploadKey) return null;
    const f = await this.files.get(snap.uploadKey);
    if (!f || (snap.uploadSha256 && (await sha256Bytes(f.bytes)) !== snap.uploadSha256)) throw new Error("승인된 그림 파일이 바뀌었거나 없습니다");
    return f;
  }

  // ---------- 결과 저장 (학생) ----------

  async save(s: StudentRow, id: string, rev: number): Promise<LibraryManifest> {
    const r = await this.ownRequest(s, id);
    const gen = await this.store.latestGeneration(r.id);
    if (!gen || gen.status !== "succeeded" || !gen.outputs || !r.approvedSnapshot) throw new WorkshopError("state", "저장할 생성 결과가 없어요", 409);
    const snap = JSON.parse(r.approvedSnapshot) as ApprovedSnapshot;
    const outs = JSON.parse(gen.outputs) as GenerationOutputs;
    const assetId = randomId("ast");
    const d = snap.draft;
    const manifest: LibraryManifest = {
      schema: 1,
      id: assetId,
      name: d.name,
      category: d.category,
      tags: d.tags,
      appearance: d.category === "terrain" ? { kind: "texture", texture: outs.texture! } : { kind: "views", td: outs.td!, iso: outs.iso! },
      behavior: {
        footprint: d.footprint,
        // 바닥: 통과 불가 = 물 같은 타일, 그 외: 막는 오브젝트
        blocking: !d.passable,
        height: d.height,
        ...(d.category === "character" ? { character: "static" as const } : {}),
        actions: [],
      },
      provenance: { requestId: r.id, approvedVersion: snap.version, generationId: gen.id, model: gen.model, createdBy: s.id },
    };
    if (r.status !== "generated") throw new WorkshopError("state", `지금 상태(${r.status})에서는 저장할 수 없어요`, 409);
    // 상태 CAS + 보관함 삽입을 한 트랜잭션으로 (결과 소실·중복 저장 방지)
    const ok = await this.store.saveLibrary(r.id, rev, { id: assetId, classId: r.classId, ownerStudentId: s.id, requestId: r.id, generationId: gen.id, manifest: JSON.stringify(manifest), shared: 0, createdAt: this.now() }, this.now());
    if (!ok) throw new WorkshopError("conflict", "이미 저장했거나 상태가 바뀌었어요. 새로고침하세요", 409);
    await this.event(r.id, `student:${s.id}`, "save", { assetId });
    return manifest;
  }

  async discard(s: StudentRow, id: string, rev: number) {
    const r = await this.ownRequest(s, id);
    await this.cas(r, rev, ["generated"], { status: "discarded" });
  }

  async library(s: StudentRow): Promise<LibraryManifest[]> {
    return (await this.store.libraryForStudent(s.id, s.classId)).map((a) => JSON.parse(a.manifest) as LibraryManifest);
  }

  // ---------- 파일 접근 권한 ----------

  /** cls/{classId}/req/{requestId}/... 또는 cls/{classId}/gen/{generationId}/... */
  async canReadFile(actor: Actor, key: string): Promise<boolean> {
    const m = /^cls\/([^/]+)\/(req|gen)\/([^/]+)\//.exec(key);
    if (!m) return false;
    const [, classId, kind, id] = m;
    if (actor.kind === "teacher") {
      const c = await this.store.getClass(classId);
      return !!c && c.teacherId === actor.teacher.id;
    }
    const s = actor.student;
    if (s.classId !== classId) return false;
    if (kind === "req") {
      const r = await this.store.getRequest(id);
      return !!r && r.studentId === s.id;
    }
    const g = await this.store.getGeneration(id);
    if (!g) return false;
    const r = await this.store.getRequest(g.requestId);
    if (r?.studentId === s.id) return true;
    // 같은 학급에 공유된 보관함 에셋이면 조회 가능
    return (await this.store.libraryForClass(classId)).some((a) => a.generationId === id && a.shared === 1);
  }

  private async event(requestId: string, actor: string, type: string, data?: unknown) {
    await this.store.insertEvent({ id: randomId("evt"), requestId, actor, type, data: data === undefined ? null : JSON.stringify(data), createdAt: this.now() });
  }
}

export function validateAvatar(input: unknown): AvatarLook {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  return {
    base: "explorer",
    top: pick(o.top, AVATAR_COLORS, "teal"),
    shoes: pick(o.shoes, AVATAR_COLORS, "coral"),
    pack: pick(o.pack, AVATAR_COLORS, "gold"),
    hair: pick(o.hair, AVATAR_HAIR, "brown"),
  };
}

export function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}

/**
 * provider 오류 → 서비스 코드 + 사용자용 메시지 (원문은 클라이언트에 보내지 않음).
 * 반환 형식 "[코드] 메시지" — 저장·표시 모두 이 값만 쓴다.
 */
export function sanitizeError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const raw = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && /승인된 그림/.test(raw)) return `[IMG-INPUT] ${raw.slice(0, 120)}`;
  if (status === 400) return "[IMG-400] 그림 요청이 거부됐어요(내용 정책 또는 형식). 설명이나 그림을 바꿔 다시 요청해 주세요";
  if (status === 401 || status === 403) return "[IMG-AUTH] 서버의 이미지 생성 권한에 문제가 있어요. 선생님께 알려 주세요";
  if (status === 429) return "[IMG-LIMIT] 지금 요청이 많아요. 잠시 뒤 다시 시도해 주세요";
  if (typeof status === "number" && status >= 500) return "[IMG-SERVER] 이미지 서버 오류예요. 잠시 뒤 다시 시도해 주세요";
  if (/timeout|timed out|abort/i.test(raw)) return "[IMG-TIMEOUT] 생성 시간이 너무 오래 걸렸어요. 다시 시도해 주세요";
  if (/fetch|network|ECONN|ENOTFOUND/i.test(raw)) return "[IMG-NET] 이미지 서버에 연결하지 못했어요";
  return "[IMG-UNKNOWN] 그림을 만들지 못했어요. 다시 시도해 주세요";
}

export { IMAGE_MODEL };
