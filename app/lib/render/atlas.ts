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
  /** 아바타 외형 적용 시 색을 바꾼 캔버스로 교체될 수 있다 */
  image: HTMLImageElement | HTMLCanvasElement;
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

/** 외형 교체 전 원본 이미지 */
const originals = new Map<string, HTMLImageElement | HTMLCanvasElement>();

function release(name: string) {
  const a = atlases.get(name);
  if (!a) return;
  const orig = originals.get(name);
  if (orig && "src" in orig) (orig as AtlasImage).src = "";
  else if ("src" in a.image) (a.image as AtlasImage).src = ""; // 디코드된 비트맵 해제
  if (a.image instanceof Object && "width" in a.image && !("src" in a.image)) (a.image as HTMLCanvasElement).width = 0;
  originals.delete(name);
  atlases.delete(name);
}

export function originalAtlasImage(name: string) {
  const a = atlases.get(name);
  if (!a) return null;
  return originals.get(name) ?? a.image;
}

/** 아틀라스 이미지를 (색을 바꾼) 캔버스 등으로 교체. 프레임 좌표는 그대로 */
export function replaceAtlasImage(name: string, image: HTMLImageElement | HTMLCanvasElement) {
  const a = atlases.get(name);
  if (!a) return;
  if (!originals.has(name)) originals.set(name, a.image);
  const prev = a.image;
  a.image = image;
  if (prev !== image && prev !== originals.get(name) && !("src" in prev)) (prev as HTMLCanvasElement).width = 0;
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
  for (const name of [...atlases.keys()]) if (!keep.has(name) && !userAtlasForView(name, view)) release(name);
  return [...keep];
}

// ---------- 사용자(공방) 에셋 그림 ----------
// 이름: u-<에셋id>-td / -iso / -tx, 프레임 "img". 현재 시점 것만 유지(텍스처는 두 시점 공용)

const USER_MAX_PX = 256;
let userView: ViewMode = "td";

function userAtlasForView(name: string, view: ViewMode) {
  if (!name.startsWith("u-")) return false;
  return name.endsWith("-tx") || name.endsWith(view === "iso" ? "-iso" : "-td");
}

/** 투명 여백을 잘라 내고 긴 변 256px 이하로 줄인 캔버스 (바닥 텍스처는 자르지 않음) */
async function loadTrimmed(url: string, trim: boolean): Promise<HTMLCanvasElement | null> {
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    let x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (trim) {
      const probe = document.createElement("canvas");
      probe.width = w;
      probe.height = h;
      const g = probe.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      x0 = w; y0 = h; x1 = -1; y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      probe.width = probe.height = 0;
      if (x1 < 0) return null;
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const s = Math.min(1, USER_MAX_PX / Math.max(bw, bh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bw * s));
    c.height = Math.max(1, Math.round(bh * s));
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, x0, y0, bw, bh, 0, 0, c.width, c.height);
    img.src = "";
    return c;
  } catch {
    return null;
  }
}

/**
 * 사용자 에셋 그림 로드: 현재 시점(td/iso)과 바닥 텍스처만. 권한이 없거나 실패하면 도형으로 대체된다.
 * entries: [에셋 key(u: 제외), { td?, iso?, texture? } URL]
 */
export async function loadUserImages(view: ViewMode, entries: Array<[string, { td?: string; iso?: string; texture?: string }]>) {
  userView = view;
  for (const name of [...atlases.keys()]) if (name.startsWith("u-") && !userAtlasForView(name, view)) release(name);
  await Promise.all(
    entries.map(async ([key, v]) => {
      const jobs: Array<[string, string | undefined, boolean]> = [
        [`u-${key}-${view === "iso" ? "iso" : "td"}`, view === "iso" ? v.iso : v.td, true],
        [`u-${key}-tx`, v.texture, false],
      ];
      for (const [name, url, trim] of jobs) {
        if (!url || atlases.has(name)) continue;
        const c = await loadTrimmed(url, trim);
        if (!c || !userAtlasForView(name, userView)) continue;
        atlases.set(name, { name, image: c, frames: { img: { x: 0, y: 0, w: c.width, h: c.height, ax: 0.5, ay: 1 } } });
      }
    }),
  );
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
