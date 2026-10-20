// 런타임 아틀라스 로더. JSON 프레임 정보 + 이미지 1장. 실패하면 도형 fallback 을 쓴다.
// 시점마다 필요한 아틀라스만 디코드해 두고, 다른 시점 이미지는 해제한다(청크·스프라이트 캐시 외 메모리 절약).
import type { ViewMode } from "./projection";

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** 디코드된 이미지. 해제는 src 를 비워서 한다 */
export interface AtlasImage {
  src: string;
}

export interface LoadedAtlas {
  name: string;
  image: HTMLImageElement;
  frames: Record<string, AtlasFrame>;
}

export const ATLAS_BASE = "/assets/atlas";

type Fetcher = (name: string) => Promise<{ image: AtlasImage; frames: Record<string, AtlasFrame> } | null>;

const browserFetcher: Fetcher = async (name) => {
  const res = await fetch(`${ATLAS_BASE}/${name}.json`);
  if (!res.ok) return null;
  const meta = (await res.json()) as { image: string; frames: Record<string, AtlasFrame> };
  const image = new Image();
  image.decoding = "async";
  image.src = `${ATLAS_BASE}/${meta.image}`;
  await image.decode();
  return { image, frames: meta.frames };
};

let fetcher: Fetcher = browserFetcher;
const atlases = new Map<string, LoadedAtlas>();
const pending = new Map<string, Promise<LoadedAtlas | null>>();
/** 현재 선택된 시점이 허용하는 아틀라스 이름. null 이면 제한 없음(시점 미지정 단독 로드) */
let allowed: Set<string> | null = null;
let generation = 0;

/** 테스트용: 로더 교체와 상태 초기화 */
export function __setAtlasFetcher(f: Fetcher | null) {
  fetcher = f ?? browserFetcher;
  for (const a of atlases.values()) (a.image as AtlasImage).src = "";
  atlases.clear();
  pending.clear();
  allowed = null;
  generation = 0;
}

export function loadAtlas(name: string): Promise<LoadedAtlas | null> {
  const done = atlases.get(name);
  if (done) return Promise.resolve(done);
  const p = pending.get(name);
  if (p) return p;
  const promise = (async () => {
    try {
      const r = await fetcher(name);
      if (!r) return null;
      // 늦게 끝난 이전 시점 로드: 지금 시점이 쓰지 않는 이미지면 저장하지 않고 바로 해제
      if (allowed && !allowed.has(name)) {
        r.image.src = "";
        return null;
      }
      const atlas = { name, image: r.image as HTMLImageElement, frames: r.frames };
      atlases.set(name, atlas);
      return atlas;
    } catch {
      return null;
    } finally {
      pending.delete(name);
    }
  })();
  pending.set(name, promise);
  return promise;
}

function release(name: string) {
  const a = atlases.get(name);
  if (!a) return;
  (a.image as AtlasImage).src = ""; // 디코드된 비트맵 해제
  atlases.delete(name);
}

const V2_SHEETS = ["nature", "furniture", "building"];

export function atlasNamesFor(view: ViewMode) {
  const prefix = view === "iso" ? "iso-" : "td-";
  return [...V2_SHEETS.map((s) => `${prefix}${s}`), `${prefix}avatar`];
}

/**
 * 시점에 필요한 아틀라스만 불러오고 나머지는 해제한다.
 * 탑뷰는 v2(td-*) 우선, v2 시트가 하나라도 없으면 그때만 v1(props/avatar)을 대체로 불러온다.
 * 아이소는 iso-* 만 쓴다(없으면 아이소 도형으로 그림, 탑뷰 그림 재사용 금지).
 * 빠른 전환 시: 허용 목록을 요청 시작 시점에 바꿔, 늦게 끝난 이전 시점 로드는 커밋되지 않는다.
 */
export async function loadViewAtlases(view: ViewMode): Promise<string[]> {
  const my = ++generation;
  const wanted = atlasNamesFor(view);
  allowed = new Set(view === "td" ? [...wanted, "props", "avatar"] : wanted);
  // 이미 들고 있는 다른 시점 이미지는 바로 해제
  for (const name of [...atlases.keys()]) if (!allowed.has(name)) release(name);
  const results = await Promise.all(wanted.map((n) => loadAtlas(n)));
  const keep = new Set(wanted.filter((_, i) => results[i]));
  // 그 사이 다른 시점이 요청됐으면 대체(v1) 로드·해제 없이 끝낸다
  if (my !== generation) return [...keep].filter((n) => atlases.has(n));
  if (view === "td") {
    if (results.slice(0, 3).some((r) => !r) && (await loadAtlas("props"))) keep.add("props");
    if (!results[3] && (await loadAtlas("avatar"))) keep.add("avatar");
  }
  if (my !== generation) return [...keep].filter((n) => atlases.has(n));
  for (const name of [...atlases.keys()]) if (!keep.has(name)) release(name);
  return [...keep];
}

export function loadedAtlasNames() {
  return [...atlases.keys()];
}

/** "props:tree" → 프레임 */
export function resolveSprite(ref: string | undefined): { atlas: LoadedAtlas; frame: AtlasFrame } | null {
  if (!ref) return null;
  const i = ref.indexOf(":");
  const atlas = atlases.get(ref.slice(0, i));
  const frame = atlas?.frames[ref.slice(i + 1)];
  return atlas && frame ? { atlas, frame } : null;
}
