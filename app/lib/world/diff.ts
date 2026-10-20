import { objectCells } from "./map.ts";
import type { MapDoc } from "./types.ts";

/** 미리보기 강조용: 추가/제거된 셀 */
export function diffCells(prev: MapDoc, next: MapDoc) {
  const added = new Set<string>();
  const removed = new Set<string>();
  const prevIds = new Map(prev.objects.map((o) => [o.id, o]));
  const nextIds = new Map(next.objects.map((o) => [o.id, o]));
  for (const o of next.objects) {
    const p = prevIds.get(o.id);
    if (!p || p.x !== o.x || p.y !== o.y || p.rot !== o.rot) for (const [x, y] of objectCells(o)) added.add(`${x},${y}`);
  }
  for (const o of prev.objects) {
    const n = nextIds.get(o.id);
    if (!n || n.x !== o.x || n.y !== o.y || n.rot !== o.rot) for (const [x, y] of objectCells(o)) removed.add(`${x},${y}`);
  }
  if (prev.width === next.width && prev.height === next.height) {
    for (let i = 0; i < next.terrain.length; i++) {
      if (prev.terrainPalette[prev.terrain[i]] !== next.terrainPalette[next.terrain[i]]) added.add(`${i % next.width},${Math.floor(i / next.width)}`);
    }
  }
  for (const k of added) removed.delete(k);
  return {
    added,
    removed,
    objectsAdded: next.objects.filter((o) => !prevIds.has(o.id)).length,
    objectsRemoved: prev.objects.filter((o) => !nextIds.has(o.id)).length,
  };
}
