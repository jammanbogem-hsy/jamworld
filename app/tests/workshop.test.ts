import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { D1Store } from "../lib/server/workshop/d1-store.ts";
import { MemoryStore, type Store } from "../lib/server/workshop/store.ts";
import { Workshop, WorkshopError, type Files, type ImageProvider } from "../lib/server/workshop/service.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);

/** 실제 D1(Miniflare/workerd) 에 마이그레이션 SQL 을 적용한 저장소 */
async function d1Store(): Promise<{ store: Store; close: () => Promise<void> }> {
  const { Miniflare } = await import("miniflare");
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('') } }", d1Databases: ["DB"] });
  const db = await mf.getD1Database("DB");
  for (const f of readdirSync("drizzle").filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await db.prepare(stmt).run();
  }
  return { store: new D1Store(db as never), close: () => mf.dispose() };
}

const closers: Array<() => Promise<void>> = [];

async function setup(kind: "memory" | "d1", opts: { failTimes?: number; noProvider?: boolean; failIso?: boolean } = {}) {
  let store: Store;
  if (kind === "d1") {
    const d = await d1Store();
    closers.push(d.close);
    store = d.store;
  } else store = new MemoryStore();
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const files: Files = {
    async put(k, bytes, contentType) {
      blobs.set(k, { bytes, contentType });
    },
    async get(k) {
      return blobs.get(k) ?? null;
    },
  };
  const calls: Array<{ prompt: string; background: string; refs: number }> = [];
  let fails = opts.failTimes ?? 0;
  const provider: ImageProvider = {
    model: "fake-image",
    async create(o) {
      calls.push({ prompt: o.prompt, background: o.background, refs: o.references?.length ?? 0 });
      if (opts.failIso && o.references?.length && o.prompt.includes("isometric")) throw Object.assign(new Error("boom"), { status: 500 });
      if (fails > 0) {
        fails--;
        throw new Error("upstream 500 sk-abcdefghijklmnop");
      }
      return { bytes: WEBP, contentType: "image/webp", usage: { input_tokens: 120, output_tokens: 439, input_tokens_details: { text_tokens: 100, image_tokens: 20 }, output_tokens_details: { image_tokens: 439 } } };
    },
  };
  let t = 1_000_000;
  const ws = new Workshop(store, files, opts.noProvider ? null : provider, () => t);
  return { ws, store, blobs, calls, tick: (ms: number) => (t += ms) };
}

const draft = { name: "무지개 의자", description: "무지개색 등받이", category: "furniture", tags: ["의자", "무지개"], footprint: { w: 1, d: 1 }, passable: false, height: 1 };

async function classWithStudent(ws: Workshop) {
  const teacher = await ws.ensureTeacher("siwc-teacher-1", "김선생");
  const { cls, inviteToken } = await ws.createClass(teacher, "3학년 2반");
  const { student, sessionToken } = await ws.joinClass(inviteToken, "별빛", "4821");
  return { teacher, cls, inviteToken, student, sessionToken };
}

function suite(kind: "memory" | "d1") {
  test.after(async () => {
    for (const c of closers.splice(0)) await c();
  });
test(`${kind}: 학생 접속: 초대 토큰+별명+PIN, PIN 해시 저장, 세션, 오답 5회 잠금`, async () => {
  const { ws, store, tick } = await setup(kind);
  const { inviteToken, student, sessionToken } = await classWithStudent(ws);
  const row = (await store.studentByNickname(student.classId, "별빛"))!;
  assert.notEqual(row.pinHash, "4821");
  assert.ok(row.pinSalt.length > 10);
  assert.equal((await ws.studentFromSession(sessionToken))?.id, student.id);
  assert.equal(await store.getSession(sessionToken), null, "세션 원문 저장 금지(해시로만 조회)");
  await assert.rejects(ws.joinClass(inviteToken, "별빛", "1111"), (e: WorkshopError) => e.code === "nickname_taken");
  await assert.rejects(ws.joinClass("wrong-token", "달빛", "1111"), (e: WorkshopError) => e.code === "invite");
  for (let i = 0; i < 5; i++) await assert.rejects(ws.loginStudent(inviteToken, "별빛", "0000"), (e: WorkshopError) => e.code === "login");
  await assert.rejects(ws.loginStudent(inviteToken, "별빛", "4821"), (e: WorkshopError) => e.code === "locked");
  tick(6 * 60 * 1000);
  assert.ok((await ws.loginStudent(inviteToken, "별빛", "4821")).sessionToken);
  tick(15 * 24 * 3600 * 1000);
  assert.equal(await ws.studentFromSession(sessionToken), null, "만료 세션");
});

test(`${kind}: 권한: 다른 학급 교사·다른 학생은 요청을 보거나 바꿀 수 없다`, async () => {
  const { ws } = await setup(kind);
  const a = await classWithStudent(ws);
  const otherTeacher = await ws.ensureTeacher("siwc-teacher-2", "박선생");
  const other = await ws.joinClass(a.inviteToken, "달빛", "9999");
  const req = await ws.createRequest(a.student, draft);
  await assert.rejects(ws.ownRequest(other.student, req.id), (e: WorkshopError) => e.status === 404);
  await ws.submit(a.student, req.id, 0);
  await assert.rejects(ws.approve(otherTeacher, req.id, 1), (e: WorkshopError) => e.status === 403);
});

test(`${kind}: 흐름: 초안→제출→승인(스냅샷 고정)→생성(td+iso, 아이소는 탑뷰 참조)→저장`, async () => {
  const { ws, store, calls } = await setup(kind);
  const { teacher, student } = await classWithStudent(ws);
  let r = await ws.createRequest(student, draft);
  const key = await ws.attachUpload(student, r.id, 0, PNG, "image/png");
  await ws.submit(student, r.id, 1);
  r = (await store.getRequest(r.id))!;
  assert.equal(r.status, "pending");
  // 승인 대기 중에는 생성 불가
  await assert.rejects(ws.startGeneration(teacher, r.id, "key-aaaaaaaa"), (e: WorkshopError) => e.code === "state");
  await ws.approve(teacher, r.id, r.rev);
  r = (await store.getRequest(r.id))!;
  const snap = JSON.parse(r.approvedSnapshot!);
  assert.equal(snap.uploadKey, key);
  assert.deepEqual(snap.outputs, ["td", "iso"]);
  // 승인 후 학생이 초안을 바꿀 수 없다
  await assert.rejects(ws.updateDraft(student, r.id, r.rev, { ...draft, name: "바꾼 이름" }), (e: WorkshopError) => e.code === "state");
  await assert.rejects(ws.attachUpload(student, r.id, r.rev, PNG, "image/png"), (e: WorkshopError) => e.code === "state");
  const { generation, started } = await ws.startGeneration(teacher, r.id, "key-aaaaaaaa");
  assert.ok(started);
  const done = await ws.runGeneration(generation.id);
  assert.equal(done.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].refs, 1, "탑뷰: 학생 그림 edit");
  assert.equal(calls[1].refs, 1, "아이소: 탑뷰 결과 참조 edit");
  assert.ok(calls.every((c) => c.background === "transparent"));
  r = (await store.getRequest(r.id))!;
  assert.equal(r.status, "generated");
  const m = await ws.save(student, r.id, r.rev);
  assert.equal(m.appearance.kind, "views");
  assert.equal(m.behavior.blocking, true);
  assert.deepEqual(m.behavior.actions, []);
  assert.equal((await ws.library(student)).length, 1);
  r = (await store.getRequest(r.id))!;
  await assert.rejects(ws.save(student, r.id, r.rev), (e: WorkshopError) => e.code === "state", "중복 저장 금지");
});

test(`${kind}: 멱등·동시성: 같은 키 재요청·동시 클릭은 한 번만 실행(중복 과금 없음)`, async () => {
  const { ws, store, calls } = await setup(kind);
  const { teacher, student } = await classWithStudent(ws);
  const r0 = await ws.createRequest(student, draft);
  await ws.submit(student, r0.id, 0);
  await ws.approve(teacher, r0.id, 1);
  const [a, b] = await Promise.allSettled([ws.startGeneration(teacher, r0.id, "key-11111111"), ws.startGeneration(teacher, r0.id, "key-22222222")]);
  const okCount = [a, b].filter((x) => x.status === "fulfilled" && x.value.started).length;
  assert.equal(okCount, 1, "동시에 둘 다 시작되면 안 됨");
  const g1 = (await store.latestGeneration(r0.id))!;
  assert.equal(g1.attempt, 1);
  const again = await ws.startGeneration(teacher, r0.id, "key-11111111");
  assert.equal(again.started, false);
  assert.equal((await store.latestGeneration(r0.id))!.id, g1.id, "생성 기록 1개");
  await ws.runGeneration(g1.id);
  assert.equal(calls.length, 2);
});

test(`${kind}: 생성 실패: 키 문자열 가림, 실패 상태, 새 키로 재시도(최대 3회)`, async () => {
  const { ws, store } = await setup(kind, { failTimes: 1 });
  const { teacher, student } = await classWithStudent(ws);
  const r0 = await ws.createRequest(student, { ...draft, category: "terrain", name: "용암 바닥", passable: false });
  await ws.submit(student, r0.id, 0);
  await ws.approve(teacher, r0.id, 1);
  const g1 = await ws.startGeneration(teacher, r0.id, "key-aaaaaaaa");
  const f = await ws.runGeneration(g1.generation.id);
  assert.equal(f.status, "failed");
  assert.ok(!f.error!.includes("sk-abcdefghijklmnop"));
  assert.match(f.error!, /^\[IMG-/, "서비스 코드 + 친절 메시지");
  assert.equal((await store.getRequest(r0.id))!.status, "failed");
  const g2 = await ws.startGeneration(teacher, r0.id, "key-bbbbbbbb");
  const ok = await ws.runGeneration(g2.generation.id);
  assert.equal(ok.status, "succeeded");
  assert.deepEqual(Object.keys(JSON.parse(ok.outputs!)), ["texture"], "바닥은 텍스처 1장");
  const r = (await store.getRequest(r0.id))!;
  const m = await ws.save(student, r0.id, r.rev);
  assert.equal(m.appearance.kind, "texture");
  assert.equal(m.behavior.blocking, true, "통과 불가 바닥");
});

test(`${kind}: 키 없음: 생성 시작을 명확한 사유로 거부(가짜 성공 없음)`, async () => {
  const { ws } = await setup(kind, { noProvider: true });
  const { teacher, student } = await classWithStudent(ws);
  const r0 = await ws.createRequest(student, draft);
  await ws.submit(student, r0.id, 0);
  await ws.approve(teacher, r0.id, 1);
  await assert.rejects(ws.startGeneration(teacher, r0.id, "key-aaaaaaaa"), (e: WorkshopError) => e.code === "provider" && e.status === 503);
});

test(`${kind}: 반려 → 수정하면 새 버전 초안 → 재제출, 업로드는 버전마다 새 키`, async () => {
  const { ws, store } = await setup(kind);
  const { teacher, student } = await classWithStudent(ws);
  const r0 = await ws.createRequest(student, draft);
  const k1 = await ws.attachUpload(student, r0.id, 0, PNG, "image/png");
  await ws.submit(student, r0.id, 1);
  await assert.rejects(ws.reject(teacher, r0.id, 2, "  "), (e: WorkshopError) => e.code === "reason");
  await ws.reject(teacher, r0.id, 2, "색을 더 밝게");
  let r = (await store.getRequest(r0.id))!;
  assert.equal(r.status, "rejected");
  const k2 = await ws.attachUpload(student, r0.id, r.rev, PNG, "image/png");
  r = (await store.getRequest(r0.id))!;
  assert.equal(r.version, 2);
  assert.notEqual(k1, k2);
  assert.equal(r.rejectReason, null);
  await assert.rejects(ws.attachUpload(student, r0.id, r.rev, new Uint8Array([1, 2, 3, 4]), "image/png"), (e: WorkshopError) => e.status === 415);
});

test(`${kind}: 파일 권한: 교사(자기 학급)·작성 학생만, 다른 학급·다른 학생 불가`, async () => {
  const { ws } = await setup(kind);
  const a = await classWithStudent(ws);
  const r0 = await ws.createRequest(a.student, draft);
  const key = await ws.attachUpload(a.student, r0.id, 0, PNG, "image/png");
  const peer = await ws.joinClass(a.inviteToken, "달빛", "9999");
  const otherT = await ws.ensureTeacher("siwc-t3", "최선생");
  assert.equal(await ws.canReadFile({ kind: "teacher", teacher: a.teacher }, key), true);
  assert.equal(await ws.canReadFile({ kind: "student", student: a.student }, key), true);
  assert.equal(await ws.canReadFile({ kind: "student", student: peer.student }, key), false);
  assert.equal(await ws.canReadFile({ kind: "teacher", teacher: otherT }, key), false);
  assert.equal(await ws.canReadFile({ kind: "teacher", teacher: a.teacher }, "../etc/passwd"), false);
});

  test(`${kind}: 실행 claim — 같은 생성을 두 번 동시에 실행해도 provider 는 한 번만 호출`, async () => {
    const { ws, store, calls } = await setup(kind);
    const { teacher, student } = await classWithStudent(ws);
    const r0 = await ws.createRequest(student, draft);
    await ws.submit(student, r0.id, 0);
    await ws.approve(teacher, r0.id, 1);
    const { generation } = await ws.startGeneration(teacher, r0.id, "key-cccccccc");
    const res = await Promise.allSettled([ws.runGeneration(generation.id), ws.runGeneration(generation.id)]);
    assert.equal(res.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(calls.length, 2, "td+iso 각 1회만");
    assert.equal((await store.getRequest(r0.id))!.status, "generated");
  });

  test(`${kind}: 연결이 끊겨 멈춘 생성은 일정 시간 뒤 실패로 복구되고 재시도 가능`, async () => {
    const { ws, store, tick } = await setup(kind);
    const { teacher, student } = await classWithStudent(ws);
    const r0 = await ws.createRequest(student, draft);
    await ws.submit(student, r0.id, 0);
    await ws.approve(teacher, r0.id, 1);
    await ws.startGeneration(teacher, r0.id, "key-dddddddd"); // 실행하지 않고 연결이 끊긴 상황
    const again = await ws.startGeneration(teacher, r0.id, "key-eeeeeeee");
    assert.equal(again.started, false, "아직 진행 중으로 본다");
    tick(9 * 60 * 1000);
    const retry = await ws.startGeneration(teacher, r0.id, "key-ffffffff");
    assert.equal(retry.started, true);
    assert.equal(retry.generation.attempt, 2);
    const first = await store.latestGeneration(r0.id);
    assert.equal(first!.attempt, 2);
  });

  test(`${kind}: 보관함 저장은 원자적 — 두 번 동시에 눌러도 에셋 1개`, async () => {
    const { ws, store } = await setup(kind);
    const { teacher, student } = await classWithStudent(ws);
    const r0 = await ws.createRequest(student, draft);
    await ws.submit(student, r0.id, 0);
    await ws.approve(teacher, r0.id, 1);
    const { generation } = await ws.startGeneration(teacher, r0.id, "key-gggggggg");
    await ws.runGeneration(generation.id);
    const r = (await store.getRequest(r0.id))!;
    const res = await Promise.allSettled([ws.save(student, r0.id, r.rev), ws.save(student, r0.id, r.rev)]);
    assert.equal(res.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await ws.library(student)).length, 1);
  });

  test(`${kind}: usage 는 호출마다 즉시 저장 — 아이소 실패해도 탑뷰 과금 기록이 남고 비용은 토큰 단가로 계산`, async () => {
    const { summarizeCost, parsePricing, readStoredUsage } = await import("../lib/server/workshop/pricing.ts");
    const { ws, store } = await setup(kind, { failIso: true });
    const { teacher, student } = await classWithStudent(ws);
    const r0 = await ws.createRequest(student, draft);
    await ws.submit(student, r0.id, 0);
    await ws.approve(teacher, r0.id, 1);
    const { generation } = await ws.startGeneration(teacher, r0.id, "key-hhhhhhhh");
    const done = await ws.runGeneration(generation.id);
    assert.equal(done.status, "failed");
    const stored = readStoredUsage((await store.getGeneration(generation.id))!.usage);
    assert.equal(stored.entries.length, 2, "탑뷰 성공 + 아이소 실패 시도 모두 기록");
    assert.equal(stored.entries[0].output, "td");
    assert.equal(stored.entries[0].status, "ok");
    assert.equal(stored.entries[1].status, "failed");
    assert.equal(stored.cost!.images, 1);
    assert.equal(stored.cost!.calls, 2);
    assert.ok(stored.cost!.unknown.some((u) => u.includes("과금 여부 미확인")));
    // fake-image 모델은 단가 없음 → 미확인(0 아님), 적용 요금표 버전 고정
    assert.equal(stored.cost!.complete, false);
    assert.ok(stored.cost!.unknown.some((u) => u.includes("단가 없음")));
    assert.equal(stored.cost!.pricingVersion, "openai-2026-10-20");
    const pricing = parsePricing(null);
    // flare: 분해 있음 → 완전 계산
    const c = summarizeCost([{ ...stored.entries[0], model: "gpt-image-2.5-flare" }], pricing);
    // 첫 호출부터 타임아웃: 기록 0건 → '확정 $0' 이 되면 안 됨
    const onlyFail = summarizeCost([{ output: "td", model: "gpt-image-2.5-flare", usage: null, ms: 1, attempt: 1, status: "failed" }], pricing);
    assert.equal(onlyFail.complete, false);
    assert.equal(onlyFail.images, 0);
    // 응답 전 중단(pending 으로 남음)도 미확인
    assert.equal(summarizeCost([{ output: "iso", model: "gpt-image-2.5-flare", usage: null, ms: 0, attempt: 1, status: "pending" }], pricing).complete, false);
    assert.equal(c.complete, true);
    assert.equal(c.usdKnown, (439 * 30 + 100 * 5 + 20 * 8) / 1e6);
    // usage 없음 → 미확인
    assert.equal(summarizeCost([{ output: "td", model: "gpt-image-2.5-flare", usage: null, ms: 1, attempt: 1 }], pricing).complete, false);
    // 참조 이미지 있는데 입력 분해 없음 → 입력은 미확인(과소 추정 금지), 출력만 확인
    const partial = summarizeCost([{ output: "iso", model: "gpt-image-2.5-flare", usage: { input_tokens: 900, output_tokens: 439 }, ms: 1, attempt: 1, hadReferences: true }], pricing);
    assert.equal(partial.complete, false);
    assert.equal(partial.unsplitInputTokens, 900);
    assert.equal(partial.usdKnown, (439 * 30) / 1e6);
    // 입력 text 토큰이 있는데 text 단가가 없으면 0 이 아니라 미확인
    const noRate = summarizeCost([{ output: "td", model: "m", usage: { input_tokens_details: { text_tokens: 10, image_tokens: 0 }, output_tokens_details: { image_tokens: 5 } }, ms: 1, attempt: 1 }], { table: { m: { output_image: 30 } }, version: "t" });
    assert.equal(noRate.complete, false);
  });
}

suite("memory");
suite("d1");
