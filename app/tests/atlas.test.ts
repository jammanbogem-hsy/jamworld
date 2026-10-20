import { test } from "node:test";
import assert from "node:assert/strict";
import { __setAtlasFetcher, atlasNamesFor, loadedAtlasNames, loadViewAtlases } from "../lib/render/atlas.ts";

/** 이름별로 완료 시점을 직접 정하는 가짜 로더 */
function deferredFetcher() {
  const gates = new Map<string, () => void>();
  const images: Array<{ name: string; image: { src: string } }> = [];
  const fetcher = (name: string) =>
    new Promise<{ image: { src: string }; frames: Record<string, never> }>((resolve) => {
      const image = { src: `blob:${name}` };
      images.push({ name, image });
      gates.set(name, () => resolve({ image, frames: {} }));
    });
  const finish = async (names: string[]) => {
    for (const n of names) gates.get(n)?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { fetcher, finish, images };
}

test("빠른 전환: iso 콜드 로드 → td 캐시 완료 → iso 늦게 완료여도 현재 시점(td) 이미지만 남는다", async () => {
  const f = deferredFetcher();
  __setAtlasFetcher(f.fetcher);
  // 1) td 를 먼저 완전히 로드(캐시 상태)
  const td1 = loadViewAtlases("td");
  await f.finish(atlasNamesFor("td"));
  await td1;
  assert.deepEqual(loadedAtlasNames().sort(), atlasNamesFor("td").sort());

  // 2) iso 로 전환(콜드 fetch 진행 중) → 3) 곧바로 td 로 복귀
  const iso = loadViewAtlases("iso");
  const td2 = loadViewAtlases("td");
  // iso 전환 순간 td 이미지는 해제됐다가 td 복귀 요청이 다시 받는다
  await f.finish(atlasNamesFor("td"));
  await td2;
  // 4) iso 가 늦게 완료
  await f.finish(atlasNamesFor("iso"));
  await iso;

  assert.deepEqual(loadedAtlasNames().sort(), atlasNamesFor("td").sort(), "현재 시점 외 아틀라스가 남으면 안 됨");
  // 늦게 끝난 iso 이미지는 커밋되지 않고 해제(src 비움)
  for (const { name, image } of f.images) if (name.startsWith("iso-")) assert.equal(image.src, "", name);
  __setAtlasFetcher(null);
});

test("반대 순서: td 콜드 → iso 완료 → td 늦게 완료여도 iso 만 남는다", async () => {
  const f = deferredFetcher();
  __setAtlasFetcher(f.fetcher);
  const td = loadViewAtlases("td");
  const iso = loadViewAtlases("iso");
  await f.finish(atlasNamesFor("iso"));
  await iso;
  await f.finish(atlasNamesFor("td"));
  await td;
  assert.deepEqual(loadedAtlasNames().sort(), atlasNamesFor("iso").sort());
  for (const { name, image } of f.images) if (name.startsWith("td-")) assert.equal(image.src, "", name);
  __setAtlasFetcher(null);
});
