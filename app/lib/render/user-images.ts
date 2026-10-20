// 등록된 사용자 에셋 중 지정한 id 들의 그림을 현재 시점으로 불러온다
import { embeddedFor, USER_PREFIX } from "../world/catalog";
import { loadUserImages } from "./atlas";
import type { ViewMode } from "./projection";

export function loadImagesFor(view: ViewMode, ids: Iterable<string>) {
  const entries: Array<[string, { td?: string; iso?: string; texture?: string }]> = [];
  for (const id of ids) {
    const e = embeddedFor(id);
    if (e && id.startsWith(USER_PREFIX)) entries.push([id.slice(USER_PREFIX.length), e.views]);
  }
  return loadUserImages(view, entries);
}
