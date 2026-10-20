import type { MapDoc } from "./types.ts";

export interface HistoryEntry<T = MapDoc> {
  doc: T;
  label: string;
  bytes: number;
  /** 변경이 일어난 페이지(되돌릴 때 그 페이지를 보여 주기 위함) */
  focus?: string;
}

/** 스냅샷 메모리 추정치 (terrain 숫자 배열 + 오브젝트·상호작용 객체) */
export function estimateDocBytes(doc: MapDoc) {
  return doc.terrain.length * 8 + doc.objects.length * 96 + doc.zones.length * 96 + doc.interactions.length * 160 + 512;
}

/**
 * 스냅샷 기반 undo/redo. 개수 상한과 byte 예산 둘 다 지킨다 (큰 맵이면 단계 수가 줄어듦).
 * T 는 맵 하나(MapDoc) 또는 프로젝트 상태. sizeOf(a, neighbor) 로 그 스냅샷만의 추가 메모리를 추정한다.
 */
export class History<T = MapDoc> {
  past: HistoryEntry<T>[] = [];
  future: HistoryEntry<T>[] = [];
  readonly limit: number;
  readonly byteBudget: number;
  private readonly sizeOf: (a: T, neighbor: T) => number;
  private bytes = 0;

  constructor(limit = 80, byteBudget = 12 * 1024 * 1024, sizeOf?: (a: T, neighbor: T) => number) {
    this.limit = limit;
    this.byteBudget = byteBudget;
    this.sizeOf = sizeOf ?? ((a: T) => estimateDocBytes(a as unknown as MapDoc));
  }

  get totalBytes() {
    return this.bytes;
  }

  private push(stack: HistoryEntry<T>[], doc: T, neighbor: T, label: string, focus?: string) {
    const e = { doc, label, focus, bytes: this.sizeOf(doc, neighbor) };
    stack.push(e);
    this.bytes += e.bytes;
  }

  private trim() {
    // 가장 오래된 undo 단계부터 버린다 (최소 1단계는 유지)
    while (this.past.length > 1 && (this.past.length > this.limit || this.bytes > this.byteBudget)) {
      this.bytes -= this.past.shift()!.bytes;
    }
  }

  /** 변경 직전 상태를 기록한다. next 는 변경 후 상태(크기 추정용, 생략 시 prev 전체 크기) */
  record(prev: T, label: string, next?: T, focus?: string) {
    for (const f of this.future) this.bytes -= f.bytes;
    this.future = [];
    this.push(this.past, prev, next ?? prev, label, focus);
    this.trim();
  }

  undo(current: T): HistoryEntry<T> | null {
    const e = this.past.pop();
    if (!e) return null;
    this.bytes -= e.bytes;
    this.push(this.future, current, e.doc, e.label, e.focus);
    this.trim();
    return e;
  }

  redo(current: T): HistoryEntry<T> | null {
    const e = this.future.pop();
    if (!e) return null;
    this.bytes -= e.bytes;
    this.push(this.past, current, e.doc, e.label, e.focus);
    this.trim();
    return e;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
