// 서버 전용 암호 유틸 (WebCrypto — Workers·Node 22 공통). 비밀 값은 로그에 남기지 않는다.

const enc = new TextEncoder();

export function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64url(a);
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomToken(12)}`;
}

export function base64url(a: Uint8Array): string {
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return base64url(new Uint8Array(d));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return base64url(new Uint8Array(d));
}

export const PIN_ITERATIONS = 100_000;

/** PIN → PBKDF2-SHA256(솔트) */
export async function hashPin(pin: string, salt: string, iterations = PIN_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations }, key, 256);
  return base64url(new Uint8Array(bits));
}

/** 시간 일정 비교 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
