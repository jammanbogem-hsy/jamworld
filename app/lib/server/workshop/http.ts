// 라우트 공통: 오류 변환, JSON 본문 크기 제한, 같은 출처 검사
import { WorkshopError } from "./service";
import { assertSameOrigin, errorResponse, getWorkshop } from "./runtime";
import type { Workshop } from "./service";

export async function handle(req: Request, fn: (ws: Workshop) => Promise<Response>): Promise<Response> {
  try {
    assertSameOrigin(req);
    return await fn(getWorkshop());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function jsonBody<T = Record<string, unknown>>(req: Request, max = 64 * 1024): Promise<T> {
  const text = await req.text();
  if (text.length > max) throw new WorkshopError("size", "요청이 너무 큽니다", 413);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new WorkshopError("json", "요청 형식이 올바르지 않습니다");
  }
}

export function need<T>(v: T | null | undefined, msg = "로그인이 필요해요", status = 401): T {
  if (!v) throw new WorkshopError("auth", msg, status);
  return v;
}
