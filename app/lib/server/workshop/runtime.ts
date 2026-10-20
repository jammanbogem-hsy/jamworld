// 서버 런타임 구성: D1(DB), R2(BUCKET), OpenAI 이미지 provider. 키는 Worker 환경에서만 읽고 출력하지 않는다.
import { env as workerEnv } from "cloudflare:workers";
import OpenAI, { toFile } from "openai";
import { D1Store, type D1Like } from "./d1-store";
import { IMAGE_MODEL } from "./prompts";
import { parsePricing, type ImageUsage } from "./pricing";
import { parseAllowlist, resolveAccess, type Access, type SiwcIdentity } from "./policy";
import { Workshop, WorkshopError, type Actor, type Files, type ImageProvider } from "./service";

interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
}

function bindings() {
  const e = workerEnv as unknown as { DB?: D1Like; BUCKET?: R2Like; OPENAI_API_KEY?: string; OPENAI_IMAGE_MODEL?: string; OPENAI_IMAGE_PRICING?: string };
  const key = e.OPENAI_API_KEY ?? (typeof process !== "undefined" ? process.env?.OPENAI_API_KEY : undefined);
  return { db: e.DB, bucket: e.BUCKET, openaiKey: key?.trim() || null, imageModel: e.OPENAI_IMAGE_MODEL || IMAGE_MODEL, pricing: parsePricing(e.OPENAI_IMAGE_PRICING) };
}

class R2Files implements Files {
  private readonly b: R2Like;
  constructor(b: R2Like) {
    this.b = b;
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.b.put(key, bytes, { httpMetadata: { contentType } });
  }
  async get(key: string) {
    const o = await this.b.get(key);
    if (!o) return null;
    return { bytes: new Uint8Array(await o.arrayBuffer()), contentType: o.httpMetadata?.contentType ?? "application/octet-stream" };
  }
}

/** OpenAI Images API: 참조 이미지가 있으면 edit, 없으면 generate. 1024 정사각, medium, webp, n=1 */
class OpenAIImages implements ImageProvider {
  readonly model: string;
  private readonly client: OpenAI;
  constructor(apiKey: string, model: string) {
    this.model = model;
    // 자동 재시도 끔: 재시도 시 과금 여부가 불명확해지므로 실패는 교사가 명시적으로 '다시 시도'(시도 횟수·usage 기록) 한다
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 180_000 });
  }
  async create(o: { prompt: string; background: "transparent" | "opaque"; references?: Array<{ bytes: Uint8Array; contentType: string }> }) {
    const common = { model: this.model, prompt: o.prompt, size: "1024x1024" as const, quality: "medium" as const, output_format: "webp" as const, background: o.background, n: 1 };
    const res = o.references?.length
      ? await this.client.images.edit({
          ...common,
          image: await Promise.all(o.references.map((r, i) => toFile(r.bytes, `ref-${i}.${r.contentType.split("/")[1] ?? "png"}`, { type: r.contentType }))),
        })
      : await this.client.images.generate(common);
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("이미지 응답이 비어 있습니다");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // 응답 usage(토큰)는 비용 계산용으로 그대로 보관 (가격 추정은 설정된 단가로만)
    return { bytes, contentType: "image/webp", usage: (res as { usage?: ImageUsage }).usage ?? null };
  }
}

export function workshopStatus() {
  const b = bindings();
  return { db: !!b.db, files: !!b.bucket, imageGeneration: !!b.openaiKey, imageModel: b.imageModel };
}

export function getWorkshop(): Workshop {
  const b = bindings();
  if (!b.db || !b.bucket) throw new WorkshopError("binding", "서버 저장소(D1/R2)가 연결되지 않았습니다", 503);
  return new Workshop(new D1Store(b.db), new R2Files(b.bucket), b.openaiKey ? new OpenAIImages(b.openaiKey, b.imageModel) : null, Date.now, b.pricing);
}

// ---------- 인증 ----------

export const SESSION_COOKIE = "moa_sid";

function cookie(req: Request, name: string) {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSec: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function siwcIdentity(req: Request): SiwcIdentity | null {
  // dev 에서는 Sites 플러그인이 바깥에서 넣은 신원 헤더를 지우고 모의 로그인 헤더만 넣는다. 호스팅은 dispatch 가 주입한다
  const userId = req.headers.get("oai-authenticated-user-id");
  const email = req.headers.get("oai-authenticated-user-email");
  if (!userId || !email) return null;
  const enc = req.headers.get("oai-authenticated-user-full-name");
  let name = email;
  if (enc && req.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try {
      name = decodeURIComponent(enc);
    } catch {
      /* 이름 디코딩 실패 시 이메일 */
    }
  }
  return { userId, email, name };
}

function allowlist() {
  const e = workerEnv as unknown as { TEACHER_ALLOWLIST?: string };
  return parseAllowlist(e.TEACHER_ALLOWLIST ?? (typeof process !== "undefined" ? process.env?.TEACHER_ALLOWLIST : undefined));
}

/** 공통 판정: 허용 교사 / 허용 교사 학급의 학생 / 등록 대기 / 없음 */
export async function accessFrom(req: Request, ws: Workshop): Promise<Access> {
  return resolveAccess(ws, allowlist(), siwcIdentity(req), cookie(req, SESSION_COOKIE));
}

export async function teacherFrom(req: Request, ws: Workshop) {
  const a = await accessFrom(req, ws);
  return a.kind === "teacher" ? a.teacher : null;
}

export async function studentFrom(req: Request, ws: Workshop) {
  const a = await accessFrom(req, ws);
  return a.kind === "student" ? a.student : null;
}

export function sessionToken(req: Request) {
  return cookie(req, SESSION_COOKIE);
}

export async function actorFrom(req: Request, ws: Workshop): Promise<Actor | null> {
  const a = await accessFrom(req, ws);
  return a.kind === "teacher" ? { kind: "teacher", teacher: a.teacher } : a.kind === "student" ? { kind: "student", student: a.student } : null;
}

/** 상태 변경 요청은 같은 출처만 (SameSite 쿠키에 더한 CSRF 방어) */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // 일부 같은 출처 fetch 는 Origin 이 없을 수 있음 (SameSite=Lax 로 보호)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new WorkshopError("origin", "다른 사이트에서 온 요청은 받을 수 없어요", 403);
  } catch (e) {
    if (e instanceof WorkshopError) throw e;
    throw new WorkshopError("origin", "요청 출처를 확인할 수 없어요", 403);
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof WorkshopError) return Response.json({ error: e.message, code: e.code }, { status: e.status, headers: { "cache-control": "no-store" } });
  return Response.json({ error: "서버 오류가 발생했어요" }, { status: 500, headers: { "cache-control": "no-store" } });
}

export const noStore = { "cache-control": "no-store" };
