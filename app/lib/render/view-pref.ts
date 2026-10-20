import type { ViewMode } from "./projection";

const KEY = "moa.view";

/** 사용자가 고른 시점 (기본 탑뷰). 저장소를 못 쓰면 기본값 */
export function readView(): ViewMode {
  try {
    return window.localStorage.getItem(KEY) === "iso" ? "iso" : "td";
  } catch {
    return "td";
  }
}

export function saveView(v: ViewMode) {
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    /* 저장 실패는 무시 (세션 동안만 유지) */
  }
}

export const VIEW_LABEL: Record<ViewMode, string> = { td: "탑뷰", iso: "아이소" };
