// 아이소 플레이 이동: 화면 기준 입력 → 화면 속도가 일정한 격자 속도, 실제 이동량 기준 8방향·걷기 위상.
// 탑뷰는 기존 PlayWorld.step(격자 정규화)을 그대로 쓴다.
import { isometric } from "../render/projection.ts";
import type { PlayerState, PlayWorld } from "./play.ts";

/** 아이소 화면 이동 속도(px/s, 줌 1). 탑뷰 수평 속도(4.2셀×64px)와 같게 맞춘다 */
export const ISO_SCREEN_SPEED = 4.2 * 64;
/** 걷기 프레임 한 칸당 화면 이동 거리(px) */
export const WALK_STRIDE_PX = 22;

/** 8방향(화면 기준): 0 남, 1 남서, 2 서, 3 북서, 4 북, 5 북동, 6 동, 7 남동 */
export const DIR8 = ["s", "sw", "w", "nw", "n", "ne", "e", "se"] as const;

export function screenDir8(dx: number, dy: number): number {
  // atan2: 동=0°, 남=90°(화면 아래), 서=180°, 북=−90°
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const byAngle = [6, 7, 0, 1, 2, 3, 4, 5]; // 동부터 45°씩: 동, 남동, 남, 남서, 서, 북서, 북, 북동
  return byAngle[((Math.round(deg / 45) % 8) + 8) % 8];
}

/** 8방향 → 격자 4방향(탑뷰/기존 dir 필드 호환): 0 남, 1 서, 2 북, 3 동 */
export function dir8ToGridDir(d8: number): number {
  // 화면 남(아래)=격자 (+,+) → 화면 기준 가까운 격자 축으로 근사
  return [0, 0, 1, 1, 2, 2, 3, 3][d8] ?? 0;
}

export function moveIso(world: PlayWorld, p: PlayerState, ix: number, iy: number, dt: number): PlayerState {
  const len = Math.hypot(ix, iy);
  if (len < 0.01) return { ...p, moving: false };
  // 화면 속도 벡터 → 격자 속도(toGround 는 선형)
  const g = isometric.toGround((ix / len) * ISO_SCREEN_SPEED, (iy / len) * ISO_SCREEN_SPEED);
  const moved = world.stepVelocity(p, g.x, g.y, dt);
  const a = isometric.toScreen(p.x, p.y);
  const b = isometric.toScreen(moved.x, moved.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const intended = screenDir8(ix, iy);
  if (dist < ISO_SCREEN_SPEED * dt * 0.05) {
    // 벽에 막혀 거의 못 움직이면 대기 자세로 입력 방향을 바라본다
    return { ...p, face8: intended, dir: dir8ToGridDir(intended), moving: false };
  }
  // 벽을 따라 미끄러질 때는 실제로 움직인 방향을 바라본다
  const face8 = screenDir8(dx, dy);
  return { ...moved, face8, dir: dir8ToGridDir(face8), moving: true, walk: (p.walk ?? 0) + dist };
}

/** 걷기 프레임: 실제 이동 거리 기준 1-2-3-2 순환, 멈추면 0 */
export function walkFrame(p: PlayerState): number {
  if (!p.moving) return 0;
  return [1, 2, 3, 2][Math.floor((p.walk ?? 0) / WALK_STRIDE_PX) % 4];
}
