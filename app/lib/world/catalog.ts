import type { AssetDef, EmbeddedAsset, Rot, ViewRender } from "./types.ts";

type Def = Omit<AssetDef, "render" | "source" | "orients">;

function tile(id: string, name: string, top: string, side: string, tags: string[], walkable = true): Def {
  return {
    id,
    name,
    kind: "tile",
    category: "terrain",
    tags,
    footprint: { w: 1, d: 1 },
    height: 0,
    blocking: !walkable,
    walkable,
    shape: "flat",
    colors: { top, side },
  };
}

function obj(
  id: string,
  name: string,
  category: AssetDef["category"],
  shape: AssetDef["shape"],
  footprint: [number, number],
  height: number,
  blocking: boolean,
  colors: AssetDef["colors"],
  tags: string[],
  interaction?: AssetDef["interaction"],
): Def {
  return {
    id,
    name,
    kind: "object",
    category,
    tags,
    footprint: { w: footprint[0], d: footprint[1] },
    height,
    blocking,
    shape,
    colors,
    interaction,
  };
}

const DEFS: Def[] = [
  tile("tile.grass", "잔디", "#6fd54a", "#3fa63a", ["잔디", "풀밭", "숲", "야외", "grass"]),
  tile("tile.grass_dark", "짙은 잔디", "#45b84a", "#2e8f3c", ["잔디", "숲", "야외"]),
  tile("tile.dirt", "흙길", "#eea55a", "#c27a38", ["흙", "길", "산책로", "path"]),
  tile("tile.sand", "모래", "#ffd96e", "#e0b245", ["모래", "해변", "놀이터"]),
  tile("tile.stone", "돌바닥", "#a9b8d6", "#7d8db3", ["돌", "광장", "복도", "바닥"]),
  tile("tile.wood", "나무 바닥", "#f0a94e", "#b8732c", ["나무", "교실", "실내", "바닥"]),
  tile("tile.carpet", "청록 카펫", "#1fcfbf", "#109a8e", ["카펫", "실내", "무대", "퀴즈"]),
  tile("tile.coral", "코랄 타일", "#ff7a68", "#d9533f", ["코랄", "실내", "강조"]),
  tile("tile.water", "물", "#3ab0ff", "#1f7fd6", ["물", "연못", "호수", "강", "water"], false),

  obj("wall.stone", "돌벽", "building", "box", [1, 1], 1.2, true, { top: "#d7dde6", side: "#8e9aae" }, ["벽", "돌", "담"]),
  obj("wall.wood", "나무벽", "building", "box", [1, 1], 1.2, true, { top: "#e2ad74", side: "#a96d3a" }, ["벽", "나무", "교실"]),
  obj("wall.brick", "밤색 벽돌벽", "building", "box", [1, 1], 1.2, true, { top: "#b5655a", side: "#7a3a33" }, ["벽", "벽돌", "학교"]),
  obj("fence.wood", "울타리", "building", "fence", [1, 1], 0.6, true, { top: "#f0c48a", side: "#b88350" }, ["울타리", "담장"]),
  obj("house.small", "작은 집", "building", "house", [3, 2], 2.2, true, { top: "#ff7a6b", side: "#f4ead8", accent: "#2b3a67" }, ["집", "건물", "마을"]),
  obj("deco.crate", "나무 상자", "decor", "box", [1, 1], 0.8, true, { top: "#e8b878", side: "#b37a3e", accent: "#8a5a2b" }, ["상자", "장애물"]),
  obj("deco.barrel", "통", "decor", "cyl", [1, 1], 0.9, true, { top: "#d08850", side: "#9c5d2c", accent: "#5a3b26" }, ["통", "장애물"]),
  obj("deco.flag", "깃발", "decor", "flag", [1, 1], 1.8, false, { top: "#ff6f61", side: "#ffffff", accent: "#19c2b5" }, ["깃발", "목표", "입구"]),
  obj("deco.lamp", "가로등", "decor", "lamp", [1, 1], 2, true, { top: "#ffe08a", side: "#2b3a67" }, ["가로등", "조명", "길"]),
  obj("nature.tree", "둥근 나무", "nature", "tree", [1, 1], 2, true, { top: "#4fbf5a", side: "#2f8f3f", accent: "#8a5a2b" }, ["나무", "숲", "공원"]),
  obj("nature.pine", "소나무", "nature", "pine", [1, 1], 2.3, true, { top: "#2fa86a", side: "#1f7a4c", accent: "#7a4d2b" }, ["나무", "숲", "소나무"]),
  obj("nature.bush", "덤불", "nature", "bush", [1, 1], 0.7, false, { top: "#5fd06a", side: "#3a9d48" }, ["덤불", "숲", "수풀", "숨기"]),
  obj("nature.rock", "바위", "nature", "rock", [1, 1], 0.6, true, { top: "#c8ced8", side: "#8b95a5" }, ["바위", "돌", "장애물"]),
  obj("nature.flower", "꽃밭", "nature", "flower", [1, 1], 0.2, false, { top: "#ff8fb1", side: "#ffd166", accent: "#5fd06a" }, ["꽃", "정원", "장식"]),
  obj("furn.desk", "책상", "furniture", "desk", [1, 1], 0.6, true, { top: "#f2c48d", side: "#b9834c" }, ["책상", "교실", "학교"]),
  obj("furn.chair", "의자", "furniture", "chair", [1, 1], 0.5, false, { top: "#3fc9bb", side: "#2a8f86" }, ["의자", "교실"]),
  obj("furn.blackboard", "칠판", "furniture", "board", [2, 1], 1.5, true, { top: "#2e5e4e", side: "#7a4d2b", accent: "#ffffff" }, ["칠판", "교실", "학교"]),
  obj("furn.bookshelf", "책장", "furniture", "shelf", [1, 1], 1.6, true, { top: "#a8723f", side: "#7a4d2b", accent: "#ff6f61" }, ["책장", "도서관", "교실"]),
  obj("furn.table", "원탁", "furniture", "cyl", [2, 2], 0.6, true, { top: "#ffd9a0", side: "#c79a5c" }, ["탁자", "모둠", "회의"]),
  obj("furn.bench", "벤치", "furniture", "bench", [2, 1], 0.45, true, { top: "#f0a868", side: "#a86a3a" }, ["벤치", "공원", "휴식"]),
  obj("act.sign", "안내판", "interactive", "sign", [1, 1], 1.1, true, { top: "#ffe7b8", side: "#8a5a2b", accent: "#2b3a67" }, ["안내판", "표지판", "설명"], "sign"),
  obj("act.quiz", "퀴즈판", "interactive", "board", [1, 1], 1.3, true, { top: "#19c2b5", side: "#2b3a67", accent: "#ffffff" }, ["퀴즈", "문제", "학습"], "quiz"),
  obj("deco.fountain", "분수", "decor", "cyl", [2, 2], 1.4, true, { top: "#7fd3ff", side: "#b9c2cc" }, ["분수", "광장", "공원", "중앙"]),
  obj("deco.flowerpot", "화분", "decor", "cyl", [1, 1], 0.8, true, { top: "#ff8fb1", side: "#c9693f" }, ["화분", "꽃", "장식", "실내"]),
  obj("nature.mushroom", "버섯", "nature", "flower", [1, 1], 0.9, false, { top: "#ff6f61", side: "#fff3e0" }, ["버섯", "숲", "장식"]),
  obj("wall.stone_seg", "돌담", "building", "box", [2, 1], 0.9, true, { top: "#d7dde6", side: "#8e9aae" }, ["담", "돌담", "벽", "정원"]),
  obj("act.portal", "포털", "interactive", "portal", [1, 1], 0.15, false, { top: "#19c2b5", side: "#7ef0e6", accent: "#ff6f61" }, ["포털", "순간이동", "이동"], "portal"),
];

/** v1 아틀라스(props, 탑뷰 전용). spriteW = 그릴 폭(셀). v2 탑뷰 시트가 있으면 v2 가 우선 */
const LEGACY_TD: Record<string, [string, number]> = {
  "nature.tree": ["props:tree", 1.5],
  "nature.bush": ["props:bush", 1.25],
  "nature.rock": ["props:rocks", 1.2],
  "furn.bench": ["props:bench", 2],
  "act.sign": ["props:sign", 1.2],
  "act.portal": ["props:portal", 1.2],
  "furn.desk": ["props:desk", 1.1],
  "furn.chair": ["props:chair", 0.85],
  "furn.bookshelf": ["props:bookshelf", 1.05],
  "deco.lamp": ["props:lamp", 1.05],
  "deco.fountain": ["props:fountain", 2.1],
  "deco.flowerpot": ["props:flowerpot", 0.95],
  "wall.stone_seg": ["props:wall", 2.05],
  "deco.crate": ["props:crate", 1.05],
  "nature.mushroom": ["props:mushrooms", 1.05],
  "deco.flag": ["props:flag", 1.1],
};

/** v2 시트(Codex 제작, td-·iso- 접두 동일 순서): assetId → [시트, 프레임, 방향수, 크기배율] */
export const V2_FRAMES: Record<string, [string, string, 1 | 2, number]> = {
  "nature.tree": ["nature", "tree", 1, 1.35],
  "nature.pine": ["nature", "pine", 1, 1.2],
  "nature.bush": ["nature", "bush", 1, 1.15],
  "nature.rock": ["nature", "rock", 1, 1.1],
  "nature.flower": ["nature", "flower", 1, 1],
  "nature.mushroom": ["nature", "mushroom", 1, 1],
  "deco.crate": ["nature", "crate", 1, 1],
  "deco.barrel": ["nature", "barrel", 1, 0.9],
  "deco.flag": ["nature", "flag", 1, 1],
  "deco.lamp": ["nature", "lamp", 1, 1],
  "deco.fountain": ["nature", "fountain", 1, 1.05],
  "deco.flowerpot": ["nature", "flowerpot", 1, 0.9],
  "furn.desk": ["furniture", "desk", 1, 1.05],
  "furn.chair": ["furniture", "chair", 2, 0.85],
  "furn.blackboard": ["furniture", "blackboard", 2, 1],
  "furn.bookshelf": ["furniture", "bookshelf", 2, 1],
  "furn.table": ["furniture", "table", 1, 1],
  "furn.bench": ["furniture", "bench", 2, 1],
  "act.sign": ["furniture", "sign", 2, 1.05],
  "wall.stone": ["building", "stone", 1, 1],
  "wall.wood": ["building", "wood", 1, 1],
  "wall.brick": ["building", "brick", 1, 1],
  "wall.stone_seg": ["building", "stone_seg", 2, 1],
  "fence.wood": ["building", "fence", 2, 1],
  "house.small": ["building", "house", 2, 1],
  "act.quiz": ["building", "quiz", 2, 1],
  "act.portal": ["building", "portal", 1, 1.05],
};

/** 아이소 전용 크기 보정: 폭 기준 배율이라 세로로 긴 소품이 캐릭터보다 과대해지는 것을 줄인다 (그림 비율·기준점은 유지) */
const ISO_SCALE_ADJ: Record<string, number> = {
  "act.sign": 0.72,
  "act.quiz": 0.8,
  "deco.lamp": 0.75,
};

export const CATALOG: AssetDef[] = DEFS.map((d) => {
  const v2 = V2_FRAMES[d.id];
  const legacy = LEGACY_TD[d.id];
  const td: ViewRender["sprites"] = [];
  const iso: ViewRender["sprites"] = [];
  if (v2) {
    td.push({ ref: `td-${v2[0]}:${v2[1]}`, scale: v2[3] });
    iso.push({ ref: `iso-${v2[0]}:${v2[1]}`, scale: v2[3] * (ISO_SCALE_ADJ[d.id] ?? 1) });
  }
  if (legacy) td.push({ ref: legacy[0], scale: legacy[1] / d.footprint.w });
  return {
    ...d,
    orients: v2?.[2] ?? 1,
    render: {
      td: { sprites: td },
      iso: { sprites: iso },
    },
    source: legacy || v2 ? "codex" : "builtin-shape",
  };
});

const BY_ID = new Map(CATALOG.map((a) => [a.id, a]));

/**
 * 사용자(공방) 에셋 id 는 "u:<에셋 id>". 조회 순서: 내장 카탈로그 → 요청 범위(맵·보관함 정의, withAssetScope) → 전역 레지스트리.
 * 전역 레지스트리는 브라우저에서만 켠다(편집기 캐시). 서버는 요청마다 범위를 넘겨 다른 요청과 정의가 섞이지 않게 한다.
 */
const USER = new Map<string, { def: AssetDef; embed: EmbeddedAsset }>();
const USER_LIMIT = 500;
let userRegistryEnabled = typeof window !== "undefined";

export const USER_PREFIX = "u:";

/** 테스트·특수 환경용: 전역 레지스트리 켜기/끄기 (끄면 비움) */
export function enableUserRegistry(on = true) {
  userRegistryEnabled = on;
  if (!on) USER.clear();
}

type ScopeEntry = { def: AssetDef; embed: EmbeddedAsset };
let scope: Map<string, ScopeEntry> | null = null;
const scopeCache = new WeakMap<object, Map<string, ScopeEntry>>();

/**
 * fn 을 실행하는 동안만 assets 정의를 보이게 한다. fn 은 동기 함수여야 한다(await 를 넘어 유지되지 않음).
 * 겹쳐 쓰면 안쪽 정의가 우선한다.
 */
export function withAssetScope<T>(assets: Record<string, EmbeddedAsset> | undefined | null, fn: () => T): T {
  if (!assets || Object.keys(assets).length === 0) return fn();
  let m = scopeCache.get(assets);
  if (!m) {
    m = new Map(Object.entries(assets).filter(([id]) => id.startsWith(USER_PREFIX)).map(([id, e]) => [id, { def: defFromEmbedded(id, e), embed: e }]));
    scopeCache.set(assets, m);
  }
  const prev = scope;
  scope = prev ? new Map([...prev, ...m]) : m;
  try {
    return fn();
  } finally {
    scope = prev;
  }
}

export function getAsset(id: string): AssetDef | undefined {
  return BY_ID.get(id) ?? scope?.get(id)?.def ?? (userRegistryEnabled ? USER.get(id)?.def : undefined);
}

/** 매니페스트·맵 내장 정보 → 카탈로그 항목 (그림 프레임은 `u-<id>-td:img` 등으로 따로 로드) */
export function defFromEmbedded(id: string, e: EmbeddedAsset): AssetDef {
  const key = id.slice(USER_PREFIX.length);
  const tile = e.kind === "tile";
  return {
    id,
    name: e.name,
    kind: e.kind,
    category: e.category,
    tags: e.tags,
    footprint: tile ? { w: 1, d: 1 } : e.footprint,
    height: tile ? 0 : e.height,
    blocking: e.blocking,
    walkable: tile ? !e.blocking : undefined,
    shape: tile ? "flat" : "box",
    colors: tile ? { top: "#b7c4d8", side: "#8b99b3" } : { top: "#e6ecf5", side: "#a9b6cc" },
    orients: 1,
    render: {
      td: { sprites: e.views.td ? [{ ref: `u-${key}-td:img`, scale: 1.05 }] : [] },
      iso: { sprites: e.views.iso ? [{ ref: `u-${key}-iso:img`, scale: 1.05 }] : [] },
      ...(e.views.texture ? { texture: `u-${key}-tx:img` } : {}),
    },
    source: "user",
  };
}

export function registerUserAsset(id: string, e: EmbeddedAsset) {
  if (!userRegistryEnabled || !id.startsWith(USER_PREFIX)) return;
  USER.delete(id);
  USER.set(id, { def: defFromEmbedded(id, e), embed: e });
  // 오래된 항목부터 정리(메모리 상한)
  while (USER.size > USER_LIMIT) USER.delete(USER.keys().next().value!);
}

export function userAssets(): AssetDef[] {
  return userRegistryEnabled ? [...USER.values()].map((u) => u.def) : [];
}

/** 현재 범위의 사용자 에셋 정의 (프롬프트 카탈로그용) */
export function scopedUserAssets(): AssetDef[] {
  return scope ? [...scope.values()].map((u) => u.def) : [];
}

export function embeddedFor(id: string): EmbeddedAsset | undefined {
  return scope?.get(id)?.embed ?? (userRegistryEnabled ? USER.get(id)?.embed : undefined);
}

export function isTile(id: string) {
  return BY_ID.get(id)?.kind === "tile";
}

export const SCALE_MIN = 0.5;
export const SCALE_MAX = 3;

export function isValidScale(s: unknown): s is number {
  return typeof s === "number" && Number.isFinite(s) && s >= SCALE_MIN && s <= SCALE_MAX;
}

/**
 * 점유 칸(충돌과 동일). 회전 후 기본 칸 × 배율을 올림(보수적), 최소 1칸.
 * 그림 폭(기본 × 배율)은 항상 점유 칸 안에 들어가 이웃 칸 오브젝트와 그림이 겹치지 않는다.
 */
export function footprintOf(asset: AssetDef, rot: Rot, scale = 1) {
  const w = rot === 90 || rot === 270 ? asset.footprint.d : asset.footprint.w;
  const d = rot === 90 || rot === 270 ? asset.footprint.w : asset.footprint.d;
  if (scale === 1) return { w, d };
  return { w: Math.max(1, Math.ceil(w * scale - 1e-9)), d: Math.max(1, Math.ceil(d * scale - 1e-9)) };
}

export const CATEGORY_LABEL: Record<AssetDef["category"], string> = {
  terrain: "바닥",
  nature: "자연",
  building: "건물·벽",
  furniture: "가구",
  interactive: "상호작용",
  decor: "장식",
  character: "인물",
};
