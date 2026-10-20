import { test } from "node:test";
import assert from "node:assert/strict";
import { planDemo } from "../lib/agent/demo.ts";
import { mapContext, parseToolInput, userMessage } from "../lib/agent/prompt.ts";
import { createMap } from "../lib/world/map.ts";
import { applyOps } from "../lib/world/ops.ts";
import { sampleSchool } from "../lib/world/samples.ts";

test("데모: 숲속 학교 교실 3개 + 퀴즈 구역 → strict 검증 통과", () => {
  const doc = createMap("m", "t", 40, 30);
  const plan = planDemo(doc, "숲속 학교에 교실 세 개와 퀴즈 구역을 만들어 줘");
  assert.match(plan.summary, /^\[데모\]/);
  const r = applyOps(doc, plan.ops, { strict: true });
  assert.ok(r.ok, JSON.stringify(r.errors));
  const names = r.doc.zones.map((z) => z.name);
  assert.deepEqual(names.filter((n) => n.startsWith("교실")).sort(), ["교실 1", "교실 2", "교실 3"]);
  assert.ok(names.includes("퀴즈 구역"));
  assert.equal(r.doc.interactions.filter((i) => i.type === "quiz").length, 3);

  // 후속 수정: 오른쪽 교실 넓히고 입구 아래로
  const right = [...r.doc.zones].filter((z) => z.name.startsWith("교실")).sort((a, b) => b.x - a.x)[0];
  const plan2 = planDemo(r.doc, "오른쪽 교실을 넓히고 입구를 아래로 옮겨 줘");
  const r2 = applyOps(r.doc, plan2.ops, { strict: true });
  assert.ok(r2.ok, JSON.stringify(r2.errors));
  const after = r2.doc.zones.find((z) => z.name === right.name)!;
  assert.ok(after.w > right.w, `${after.w} > ${right.w}`);
  assert.equal(r2.doc.zones.length, r.doc.zones.length);
});

test("데모: 모르는 요청은 작업 없이 안내만 한다", () => {
  const plan = planDemo(createMap("m", "t", 20, 20), "우주선을 만들어 줘");
  assert.equal(plan.ops.length, 0);
});

test("프롬프트 컨텍스트에 격자·구역·카탈로그가 포함된다", () => {
  const doc = sampleSchool();
  const ctx = mapContext(doc);
  assert.match(ctx, /교실 1/);
  assert.ok(ctx.split("\n").some((l) => l.includes("S")));
  const msg = userMessage(doc, "교실 넓혀 줘");
  assert.match(msg, /furn\.desk/);
  assert.match(msg, /\[사용자 요청\]\n교실 넓혀 줘/);
});

test("도구 입력 파싱: 객체/문자열/잘못된 값", () => {
  assert.deepEqual(parseToolInput({ summary: "a", ops: [] }), { summary: "a", ops: [] });
  assert.deepEqual(parseToolInput('{"summary":"b","ops":[{"op":"remove","id":"o1"}]}')?.ops.length, 1);
  assert.equal(parseToolInput({ summary: "x" }), null);
  assert.equal(parseToolInput("not json"), null);
  assert.equal(parseToolInput(null), null);
});
