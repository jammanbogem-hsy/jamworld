// 플레이 모드 이동·충돌·상호작용 판정 (렌더와 분리된 순수 로직)
import { blockedGrid } from "./map.ts";
import type { Interaction, MapDoc } from "./types.ts";

export const PLAYER_RADIUS = 0.3;
export const PLAYER_SPEED = 4.2; // 셀/초

export interface PlayerState {
  x: number;
  y: number;
  dir: number; // 0 아래, 1 왼쪽, 2 위, 3 오른쪽
  moving: boolean;
}

export class PlayWorld {
  readonly doc: MapDoc;
  readonly blocked: Uint8Array;

  constructor(doc: MapDoc) {
    this.doc = doc;
    this.blocked = blockedGrid(doc);
  }

  isBlocked(cx: number, cy: number) {
    if (cx < 0 || cy < 0 || cx >= this.doc.width || cy >= this.doc.height) return true;
    return this.blocked[cy * this.doc.width + cx] === 1;
  }

  /** 원(반지름 r)이 막힌 셀과 겹치는가 */
  collides(x: number, y: number, r = PLAYER_RADIUS) {
    for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        if (!this.isBlocked(cx, cy)) continue;
        const nx = Math.max(cx, Math.min(x, cx + 1));
        const ny = Math.max(cy, Math.min(y, cy + 1));
        if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  spawnState(): PlayerState {
    return { x: this.doc.spawn.x + 0.5, y: this.doc.spawn.y + 0.5, dir: 0, moving: false };
  }

  /** 축별로 따로 움직여 벽을 따라 미끄러진다 */
  step(p: PlayerState, ix: number, iy: number, dt: number): PlayerState {
    const len = Math.hypot(ix, iy);
    if (len < 0.01) return { ...p, moving: false };
    const vx = (ix / len) * PLAYER_SPEED * dt;
    const vy = (iy / len) * PLAYER_SPEED * dt;
    let { x, y } = p;
    // 큰 dt 에서도 벽을 뚫지 않도록 잘게 나눈다
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(vx), Math.abs(vy)) / 0.2));
    for (let i = 0; i < n; i++) {
      if (!this.collides(x + vx / n, y)) x += vx / n;
      if (!this.collides(x, y + vy / n)) y += vy / n;
    }
    const dir = Math.abs(ix) > Math.abs(iy) ? (ix < 0 ? 1 : 3) : iy < 0 ? 2 : 0;
    return { x, y, dir, moving: true };
  }

  /** 가까운 안내판·퀴즈 (포털은 밟을 때 발동) */
  nearby(p: PlayerState, range = 1.35): Interaction | null {
    let best: Interaction | null = null;
    let bestD = range;
    for (const i of this.doc.interactions) {
      if (i.type === "portal") continue;
      const d = Math.hypot(i.x + 0.5 - p.x, i.y + 0.5 - p.y);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  portalAt(p: PlayerState) {
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    return this.doc.interactions.find((i) => i.type === "portal" && i.x === cx && i.y === cy) ?? null;
  }

  /** 포털 도착 지점: 대상 포털 옆의 비어 있는 칸 */
  portalExit(targetId: string): PlayerState | null {
    const t = this.doc.interactions.find((i) => i.id === targetId);
    if (!t) return null;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (!this.isBlocked(x, y) && !this.doc.interactions.some((i) => i.type === "portal" && i.x === x && i.y === y)) {
        return { x: x + 0.5, y: y + 0.5, dir: 0, moving: false };
      }
    }
    return null;
  }
}
