// 공방 보관함 에셋 ↔ 카탈로그·맵 연결
import { embeddedFor, registerUserAsset, USER_PREFIX } from "./catalog.ts";
import type { EmbeddedAsset, MapDoc } from "./types.ts";

/** 보관함 매니페스트(서버 응답) → 내장 정보 */
export interface LibraryLike {
  id: string;
  name: string;
  category: EmbeddedAsset["category"];
  tags: string[];
  appearance: { kind: "texture" } | { kind: "views" };
  behavior: { footprint: { w: number; d: number }; blocking: boolean; height: number };
  urls: { td?: string | null; iso?: string | null; texture?: string | null };
}

export function embeddedFromLibrary(m: LibraryLike): { id: string; embed: EmbeddedAsset } {
  const tile = m.appearance.kind === "texture";
  return {
    id: `${USER_PREFIX}${m.id}`,
    embed: {
      name: m.name,
      kind: tile ? "tile" : "object",
      category: m.category,
      tags: m.tags,
      footprint: m.behavior.footprint,
      blocking: m.behavior.blocking,
      height: m.behavior.height,
      views: { td: m.urls.td ?? undefined, iso: m.urls.iso ?? undefined, texture: m.urls.texture ?? undefined },
    },
  };
}

export function registerLibrary(list: LibraryLike[]) {
  return list.map((m) => {
    const { id, embed } = embeddedFromLibrary(m);
    registerUserAsset(id, embed);
    return id;
  });
}

/** 맵이 실제로 쓰는 사용자 에셋만 doc.assets 에 담는다(안 쓰면 제거). 바뀐 게 없으면 같은 객체 */
export function syncEmbeddedAssets(doc: MapDoc): MapDoc {
  const used = new Set<string>();
  for (const o of doc.objects) if (o.assetId.startsWith(USER_PREFIX)) used.add(o.assetId);
  for (const t of doc.terrainPalette) if (t.startsWith(USER_PREFIX)) used.add(t);
  const prev = doc.assets ?? {};
  const next: Record<string, EmbeddedAsset> = {};
  for (const id of used) {
    const e = embeddedFor(id) ?? prev[id];
    if (e) next[id] = e;
  }
  const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every((k) => prev[k] === next[k]);
  if (same) return doc;
  const out = { ...doc };
  if (Object.keys(next).length) out.assets = next;
  else delete out.assets;
  return out;
}
