import type { MapDoc } from "./types.ts";

export interface HistoryEntry {
  doc: MapDoc;
  label: string;
  bytes: number;
}

/** 스냅샷 메모리 추정치 (terrain 숫자 배열 + 오브젝트·상호작용 객체) */
export function estimateDocBytes(doc: MapDoc) {
  return doc.terrain.length * 8 + doc.objects.length * 96 + doc.zones.length * 96 + doc.interactions.length * 160 + 512;
}

/** 스냅샷 기반 undo/redo. 개수 상한과 byte 예산 둘 다 지킨다 (큰 맵이면 단계 수가 줄어듦) */
export class History {
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  readonly limit: number;
  readonly byteBudget: number;
  private bytes = 0;

  constructor(limit = 80, byteBudget = 12 * 1024 * 1024) {
    this.limit = limit;
    this.byteBudget = byteBudget;
  }

  get totalBytes() {
    return this.bytes;
  }

  private push(stack: HistoryEntry[], doc: MapDoc, label: string) {
    const e = { doc, label, bytes: estimateDocBytes(doc) };
    stack.push(e);
    this.bytes += e.bytes;
  }

  private trim() {
    // 가장 오래된 undo 단계부터 버린다 (최소 1단계는 유지)
    while (this.past.length > 1 && (this.past.length > this.limit || this.bytes > this.byteBudget)) {
      this.bytes -= this.past.shift()!.bytes;
    }
  }

  /** 변경 직전 문서를 기록한다 */
  record(prev: MapDoc, label: string) {
    for (const f of this.future) this.bytes -= f.bytes;
    this.future = [];
    this.push(this.past, prev, label);
    this.trim();
  }

  undo(current: MapDoc): HistoryEntry | null {
    const e = this.past.pop();
    if (!e) return null;
    this.bytes -= e.bytes;
    this.push(this.future, current, e.label);
    this.trim();
    return e;
  }

  redo(current: MapDoc): HistoryEntry | null {
    const e = this.future.pop();
    if (!e) return null;
    this.bytes -= e.bytes;
    this.push(this.past, current, e.label);
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
