// 플레이 중에만 도는 rAF 루프. fps 상한을 지키고, 탭이 숨으면 멈춘다.

export interface PerfSample {
  fps: number;
  frameMsAvg: number;
  frameMsP95: number;
  frames: number;
}

export class FrameLoop {
  private raf = 0;
  private running = false;
  private last = 0;
  private acc = 0;
  private targetFps: number;
  private readonly tick: (dt: number, now: number) => number | void;
  private frameTimes: number[] = [];
  private shown = 0;
  private windowStart = 0;
  private fps = 0;

  constructor(targetFps: number, tick: (dt: number, now: number) => number | void) {
    this.targetFps = targetFps;
    this.tick = tick;
    this.onVisibility = this.onVisibility.bind(this);
    this.loop = this.loop.bind(this);
  }

  setFps(fps: number) {
    this.targetFps = fps;
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    if (!document.hidden) this.schedule();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  get isRunning() {
    return this.running && this.raf !== 0;
  }

  sample(): PerfSample {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const avg = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
    return {
      fps: Math.round(this.fps),
      frameMsAvg: +avg.toFixed(2),
      frameMsP95: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2),
      frames: sorted.length,
    };
  }

  private onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (this.running && !this.raf) {
      this.last = 0;
      this.schedule();
    }
  }

  private schedule() {
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop(now: number) {
    if (!this.running) return;
    this.schedule();
    if (!this.last) {
      this.last = now;
      this.windowStart = now;
      return;
    }
    const minStep = 1000 / this.targetFps;
    this.acc += now - this.last;
    this.last = now;
    // 30fps 모드에서는 60Hz 화면의 프레임 절반을 건너뛴다 (2ms 여유)
    if (this.acc + 2 < minStep) return;
    const dt = Math.min(this.acc, 100) / 1000;
    this.acc = 0;
    const cost = this.tick(dt, now);
    if (typeof cost === "number") {
      this.frameTimes.push(cost);
      if (this.frameTimes.length > 240) this.frameTimes.shift();
    }
    this.shown++;
    if (now - this.windowStart >= 1000) {
      this.fps = (this.shown * 1000) / (now - this.windowStart);
      this.shown = 0;
      this.windowStart = now;
    }
  }
}

/** 편집 화면용: 변경이 있을 때만 다음 프레임에 한 번 그린다 */
export function createRenderScheduler(draw: () => void) {
  let id = 0;
  return {
    request() {
      if (id) return;
      id = requestAnimationFrame(() => {
        id = 0;
        draw();
      });
    },
    cancel() {
      cancelAnimationFrame(id);
      id = 0;
    },
  };
}
