// Canvas2D 2.5D 렌더러 (탑뷰 / 아이소메트릭). 논리 격자는 하나이고 Projection 만 바뀐다.
// 바닥은 청크 캐시, 오브젝트는 (시점,에셋,회전,배율)별 스프라이트 캐시. 둘 다 픽셀 byte 예산 + LRU.
// 카메라는 셀 좌표로 저장해 시점을 바꿔도 같은 지점을 본다.
import { footprintOf, getAsset } from "../world/catalog";
import { tileAt } from "../world/map";
import type { AssetDef, MapDoc, PlacedObject, Rot, Zone } from "../world/types";
import { resolveSprite } from "./atlas";
import { QUALITY, type Quality } from "./constants";
import { HU, projectionFor, visibleCells, type Projection, type ViewMode } from "./projection";
import { drawAssetShape, drawAssetShapeIso, drawAvatar, drawTileUnit, type AvatarStyle } from "./shapes";

/** 바닥 청크 한 변(셀). 아이소는 마름모를 감싼 상자라 투명 영역이 커서 작게 나눈다 */
const CHUNK_OF = { td: 8, iso: 4 } as const;
/** 아바타 스프라이트 표시 높이(px, 줌 1) */
const AVATAR_H = 96;
const OUTLINE_MAP = "#1b1f3a";

export interface Camera {
  /** 화면 중앙이 바라보는 셀 좌표 */
  cx: number;
  cy: number;
  zoom: number;
}

export interface PlayerView {
  x: number; // 셀 단위 실수 좌표 (발 위치)
  y: number;
  dir: number; // 격자 기준 0 남, 1 서, 2 북, 3 동
  moving: boolean;
  /** 아이소 화면 8방향 0 남 … 7 남동 (없으면 dir 로 계산) */
  face8?: number;
  /** 걷기 프레임 0~3 (없으면 시간 기준 10fps) */
  walkFrame?: number;
  style: AvatarStyle;
  name: string;
}

export interface Ghost {
  assetId: string;
  x: number;
  y: number;
  rot: Rot;
  valid: boolean;
  scale?: number;
}

export interface SceneState {
  mode: "edit" | "play";
  time: number;
  showGrid?: boolean;
  showZones?: boolean;
  selectedId?: string | null;
  hoverCell?: { x: number; y: number; w?: number; h?: number } | null;
  ghost?: Ghost | null;
  player?: PlayerView | null;
  highlight?: { added: Set<string>; removed: Set<string> } | null;
  nearInteraction?: { x: number; y: number } | null;
  xray?: boolean;
  /** 포털 두 단계 설치: 1단계에서 찍은 시작 포털(이 페이지에 있을 때) */
  pendingPortal?: { x: number; y: number; label: string } | null;
  /** 시작 포털 → 커서 연결선 (같은 페이지) */
  portalLink?: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  /** 편집 화면 포털 도착 라벨 */
  portalTags?: Array<{ x: number; y: number; text: string }>;
}

export interface RenderStats {
  /** render() 한 번의 CPU 시간 */
  frameMs: number;
  chunkCacheBytes: number;
  spriteCacheBytes: number;
  objectsDrawn: number;
  chunksDrawn: number;
  chunkBuilds: number;
  spriteBuilds: number;
}

interface SpriteEntry {
  canvas: HTMLCanvasElement;
  ox: number; // 캔버스 안에서 footprint 원점(셀 (0,0) 모서리)의 위치, 줌1 px
  oy: number;
  w: number;
  h: number;
  bytes: number;
}

interface SortedObject {
  o: PlacedObject;
  a: AssetDef;
  fw: number;
  fd: number;
  key: number;
}

export class WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  camera: Camera = { cx: 0, cy: 0, zoom: 1 };
  quality: Quality;
  private proj: Projection;
  private doc: MapDoc | null = null;
  private sorted: SortedObject[] = [];
  private chunks = new Map<string, { canvas: HTMLCanvasElement; scale: number; bytes: number; ox: number; oy: number }>();
  private sprites = new Map<string, SpriteEntry>();
  private chunkBytes = 0;
  private spriteBytes = 0;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  private stats: RenderStats = { frameMs: 0, chunkCacheBytes: 0, spriteCacheBytes: 0, objectsDrawn: 0, chunksDrawn: 0, chunkBuilds: 0, spriteBuilds: 0 };

  constructor(canvas: HTMLCanvasElement, quality: Quality = "standard", view: ViewMode = "td") {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D 를 사용할 수 없습니다");
    this.ctx = ctx;
    this.quality = quality;
    this.proj = projectionFor(view);
  }

  get view(): ViewMode {
    return this.proj.id;
  }

  get projection(): Projection {
    return this.proj;
  }

  /** 시점 전환: 카메라 셀 중심 유지, 이전 시점 비트맵 캐시는 버린다 */
  setView(view: ViewMode) {
    if (view === this.proj.id) return;
    this.proj = projectionFor(view);
    this.clearCaches();
    if (this.doc) this.sortObjects(this.doc);
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.clearCaches();
    this.resize();
  }

  /** CSS 크기 변화·DPR 반영 */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].dprCap);
    this.viewW = Math.max(1, rect.width);
    this.viewH = Math.max(1, rect.height);
    const bw = Math.round(this.viewW * this.dpr);
    const bh = Math.round(this.viewH * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  get viewport() {
    return { w: this.viewW, h: this.viewH };
  }

  /** 맵이 바뀌면 바뀐 바닥 청크만 무효화하고 정렬 목록을 다시 만든다 */
  setDoc(doc: MapDoc) {
    const prev = this.doc;
    if (prev && (prev.width !== doc.width || prev.height !== doc.height)) this.clearChunks();
    else if (prev && prev.terrain !== doc.terrain) {
      for (const [key, c] of [...this.chunks]) {
        const [cx, cy] = key.split(",").map(Number);
        if (chunkChanged(prev, doc, cx, cy, CHUNK_OF[this.proj.id])) {
          this.chunks.delete(key);
          this.chunkBytes -= c.bytes;
          c.canvas.width = c.canvas.height = 0;
        }
      }
    }
    this.doc = doc;
    this.sortObjects(doc);
  }

  private sortObjects(doc: MapDoc) {
    const list: SortedObject[] = [];
    for (const o of doc.objects) {
      const a = getAsset(o.assetId);
      if (!a) continue;
      const fp = footprintOf(a, o.rot, o.scale ?? 1);
      list.push({ o, a, fw: fp.w, fd: fp.d, key: this.proj.depthKey(o.x, o.y, fp.w, fp.d) });
    }
    list.sort((p, q) => p.key - q.key);
    this.sorted = list;
  }

  invalidateSprites() {
    for (const s of this.sprites.values()) s.canvas.width = s.canvas.height = 0;
    this.sprites.clear();
    this.spriteBytes = 0;
  }

  clearCaches() {
    this.clearChunks();
    this.invalidateSprites();
  }

  private clearChunks() {
    for (const c of this.chunks.values()) c.canvas.width = c.canvas.height = 0;
    this.chunks.clear();
    this.chunkBytes = 0;
  }

  get cacheBytes() {
    return { chunks: this.chunkBytes, sprites: this.spriteBytes };
  }

  // ---------- 좌표 ----------

  private camPx() {
    return this.proj.toScreen(this.camera.cx, this.camera.cy);
  }

  /** 셀 좌표 → 화면 px */
  worldToScreen(cx: number, cy: number, z = 0) {
    const p = this.proj.toScreen(cx, cy, z);
    const c = this.camPx();
    const { zoom } = this.camera;
    return { x: (p.x - c.x) * zoom + this.viewW / 2, y: (p.y - c.y) * zoom + this.viewH / 2 };
  }

  /** 화면 px → 바닥 셀 좌표(실수) */
  screenToWorld(sx: number, sy: number) {
    const c = this.camPx();
    const { zoom } = this.camera;
    return this.proj.toGround((sx - this.viewW / 2) / zoom + c.x, (sy - this.viewH / 2) / zoom + c.y);
  }

  screenToCell(sx: number, sy: number) {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }

  /** 화면 px 만큼 카메라를 끈다 (드래그 시작 시점 카메라 기준) */
  panFrom(start: { cx: number; cy: number }, dxScreen: number, dyScreen: number) {
    const p = this.proj.toScreen(start.cx, start.cy);
    const g = this.proj.toGround(p.x - dxScreen / this.camera.zoom, p.y - dyScreen / this.camera.zoom);
    this.camera.cx = g.x;
    this.camera.cy = g.y;
    this.clampCamera();
  }

  /** 화면 점을 고정한 채 확대/축소 */
  zoomAt(sx: number, sy: number, factor: number, min = 0.2, max = 2.2) {
    const before = this.screenToWorld(sx, sy);
    this.camera.zoom = Math.max(min, Math.min(max, this.camera.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.camera.cx += before.x - after.x;
    this.camera.cy += before.y - after.y;
    this.clampCamera();
  }

  centerOn(cx: number, cy: number) {
    this.camera.cx = cx;
    this.camera.cy = cy;
  }

  clampCamera() {
    if (!this.doc) return;
    this.camera.cx = Math.max(0, Math.min(this.doc.width, this.camera.cx));
    this.camera.cy = Math.max(0, Math.min(this.doc.height, this.camera.cy));
  }

  /** 맵 전체가 화면에 들어오도록 */
  fitToMap(padding = 24) {
    if (!this.doc) return;
    const b = this.proj.mapBox(this.doc.width, this.doc.height);
    const z = Math.min((this.viewW - padding * 2) / (b.x1 - b.x0), (this.viewH - padding * 2) / (b.y1 - b.y0));
    this.camera.zoom = Math.max(0.05, Math.min(1.5, z));
    const g = this.proj.toGround((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    this.camera.cx = g.x;
    this.camera.cy = g.y;
  }

  /** 화면이 맵 바깥(빈 배경)을 덜 보도록 카메라 목표 셀을 제한. 맵이 화면보다 작으면 가운데 */
  clampToView(x: number, y: number) {
    if (!this.doc) return { x, y };
    const b = this.proj.mapBox(this.doc.width, this.doc.height);
    const halfW = this.viewW / 2 / this.camera.zoom;
    const halfH = this.viewH / 2 / this.camera.zoom;
    const p = this.proj.toScreen(x, y);
    const px = b.x1 - b.x0 <= halfW * 2 ? (b.x0 + b.x1) / 2 : Math.max(b.x0 + halfW, Math.min(b.x1 - halfW, p.x));
    const py = b.y1 - b.y0 <= halfH * 2 ? (b.y0 + b.y1) / 2 : Math.max(b.y0 + halfH, Math.min(b.y1 - halfH, p.y));
    return this.proj.toGround(px, py);
  }

  /** 화면 좌표에서 가장 앞에 그려진 오브젝트 (스프라이트를 만들지 않고 footprint+높이 상자로 판정) */
  pickObject(sx: number, sy: number): PlacedObject | null {
    const { zoom } = this.camera;
    const ground = this.screenToWorld(sx, sy);
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const { o, a, fw, fd } = this.sorted[i];
      const b = this.proj.footprintBox(fw, fd, a.height * (o.scale ?? 1) + 0.25);
      const p = this.worldToScreen(o.x, o.y);
      if (sx < p.x + b.x0 * zoom - 6 || sx > p.x + b.x1 * zoom + 6 || sy < p.y + b.y0 * zoom || sy > p.y + b.y1 * zoom) continue;
      if (this.proj.id === "iso") {
        // 아이소: 상자 귀퉁이의 빈 곳은 제외. 바닥 위이거나, 높이 부분(바닥에서 위로 올린 지점)이 footprint 근처일 때만
        const onFoot = ground.x >= o.x && ground.x <= o.x + fw && ground.y >= o.y && ground.y <= o.y + fd;
        const lifted = this.screenToWorld(sx, sy + a.height * (o.scale ?? 1) * HU * zoom * 0.6);
        const near = lifted.x >= o.x - 0.5 && lifted.x <= o.x + fw + 0.5 && lifted.y >= o.y - 0.5 && lifted.y <= o.y + fd + 0.5;
        if (!onFoot && !near) continue;
      }
      return o;
    }
    return null;
  }

  // ---------- 그리기 ----------

  render(scene: SceneState): RenderStats {
    const t0 = performance.now();
    const ctx = this.ctx;
    const doc = this.doc;
    this.stats.objectsDrawn = 0;
    this.stats.chunksDrawn = 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = scene.mode === "play" ? "#22284a" : "#dfe9f2";
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    if (!doc) return this.stats;
    const { zoom } = this.camera;
    const proj = this.proj;

    // 보이는 셀 범위 (높은 오브젝트·스프라이트 여유)
    const c = this.camPx();
    const halfW = this.viewW / 2 / zoom;
    const halfH = this.viewH / 2 / zoom;
    const vis = visibleCells(proj, c.x - halfW - 96, c.y - halfH - 96, c.x + halfW + 96, c.y + halfH + 3 * HU + 160);
    const x0 = Math.max(0, vis.minX);
    const x1 = Math.min(doc.width - 1, vis.maxX);
    const y0 = Math.max(0, vis.minY);
    const y1 = Math.min(doc.height - 1, vis.maxY);

    this.drawMapBase(scene.mode);

    // 바닥 청크
    const scale = Math.min(QUALITY[this.quality].chunkScaleCap, Math.max(0.5, Math.round(zoom * this.dpr * 2) / 2));
    const CHUNK = CHUNK_OF[proj.id];
    if (x0 <= x1 && y0 <= y1) {
      const origin = this.worldToScreen(0, 0);
      const vx0 = c.x - halfW - 4;
      const vx1 = c.x + halfW + 4;
      const vy0 = c.y - halfH - 4;
      const vy1 = c.y + halfH + 4;
      for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
        for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
          // 청크 화면 상자가 뷰포트 밖이면 만들지도 그리지도 않는다
          const b = this.chunkBox(cx, cy, CHUNK);
          if (b.x1 < vx0 || b.x0 > vx1 || b.y1 < vy0 || b.y0 > vy1) continue;
          const ch = this.chunk(cx, cy, scale, b);
          const sx = Math.floor(origin.x + ch.ox * zoom);
          const sy = Math.floor(origin.y + ch.oy * zoom);
          ctx.drawImage(ch.canvas, sx, sy, Math.ceil((ch.canvas.width / ch.scale) * zoom) + 1, Math.ceil((ch.canvas.height / ch.scale) * zoom) + 1);
          this.stats.chunksDrawn++;
        }
      }
    }
    this.drawMapOutline();

    if (scene.showGrid) this.drawGrid(x0, x1, y0, y1);
    if (scene.highlight) this.drawHighlights(scene.highlight);
    if (scene.showZones || scene.mode === "edit") for (const z of doc.zones) this.drawZone(z, scene.mode);
    if (scene.mode === "edit") this.drawSpawn();

    // 오브젝트 + 플레이어 (깊이 순)
    const player = scene.player;
    const pKey = player ? proj.playerDepth(player.x, player.y) : Infinity;
    let playerDrawn = false;
    const vw = this.viewW;
    const vh = this.viewH;
    for (const s of this.sorted) {
      const { o, a, fw, fd } = s;
      // 배율·높이를 반영한 화면 상자로 컬링 (높은 집·나무 윗부분만 보여도 그린다)
      const k = o.scale ?? 1;
      const fb = proj.footprintBox(fw, fd, a.height * k + 0.6);
      const over = (fb.x1 - fb.x0) * 0.35 + 8; // 스프라이트가 footprint 보다 넓은 만큼 여유
      const op = this.worldToScreen(o.x, o.y);
      if (op.x + (fb.x1 + over) * zoom < 0 || op.x + (fb.x0 - over) * zoom > vw || op.y + fb.y1 * zoom + 8 < 0 || op.y + (fb.y0 - 24) * zoom > vh) continue;
      if (player && !playerDrawn && s.key > pKey) {
        this.drawPlayer(player, scene.time);
        playerDrawn = true;
      }
      let alpha = scene.xray ? 0.45 : 1;
      if (player && s.key > pKey && a.height * (o.scale ?? 1) >= 0.9 && this.occludes(o, a, fw, fd, player)) alpha = 0.42;
      this.drawObject(o, alpha, scene.selectedId === o.id);
    }
    if (player && !playerDrawn) this.drawPlayer(player, scene.time);

    if (scene.portalTags) for (const t of scene.portalTags) this.drawTag(t.x, t.y, t.text, "#2b3a67");
    if (scene.pendingPortal) this.drawPending(scene.pendingPortal, scene.time);
    if (scene.portalLink) this.drawLink(scene.portalLink.from, scene.portalLink.to);
    if (scene.ghost) this.drawGhost(scene.ghost);
    if (scene.hoverCell && !scene.ghost) this.drawCellOutline(scene.hoverCell, "rgba(25,194,181,0.95)");
    if (scene.nearInteraction) this.drawBubble(scene.nearInteraction, scene.time);
    if (scene.mode === "edit" || scene.showZones) for (const z of doc.zones) this.drawZoneLabel(z);

    this.stats.frameMs = performance.now() - t0;
    this.stats.chunkCacheBytes = this.chunkBytes;
    this.stats.spriteCacheBytes = this.spriteBytes;
    return { ...this.stats };
  }

  /** 플레이어 화면 상자와 겹치는 앞쪽 높은 오브젝트인가 */
  private occludes(o: PlacedObject, a: AssetDef, fw: number, fd: number, p: PlayerView) {
    const z = this.camera.zoom;
    const ob = this.proj.footprintBox(fw, fd, a.height * (o.scale ?? 1));
    const op = this.worldToScreen(o.x, o.y);
    const pp = this.worldToScreen(p.x, p.y);
    const px0 = pp.x - 18 * z;
    const px1 = pp.x + 18 * z;
    const py0 = pp.y - AVATAR_H * z;
    const py1 = pp.y;
    return op.x + ob.x0 * z < px1 && op.x + ob.x1 * z > px0 && op.y + ob.y0 * z < py1 && op.y + ob.y1 * z > py0;
  }

  /** 지도 바깥 절벽(화면 아래쪽 가장자리) */
  private drawMapBase(mode: SceneState["mode"]) {
    const doc = this.doc!;
    const ctx = this.ctx;
    const depth = 22 * this.camera.zoom;
    ctx.fillStyle = mode === "play" ? "#3a2a2e" : "#b98a66";
    const sw = this.worldToScreen(0, doc.height);
    const se = this.worldToScreen(doc.width, doc.height);
    ctx.beginPath();
    if (this.proj.id === "td") {
      ctx.rect(sw.x, sw.y - 1, se.x - sw.x, depth + 1);
    } else {
      const ne = this.worldToScreen(doc.width, 0);
      ctx.moveTo(sw.x, sw.y);
      ctx.lineTo(se.x, se.y);
      ctx.lineTo(ne.x, ne.y);
      ctx.lineTo(ne.x, ne.y + depth);
      ctx.lineTo(se.x, se.y + depth);
      ctx.lineTo(sw.x, sw.y + depth);
      ctx.closePath();
    }
    ctx.fill();
  }

  /** 지도 바깥 경계 굵은 외곽선 (바닥 칸마다 선은 긋지 않는다) */
  private drawMapOutline() {
    const doc = this.doc!;
    const ctx = this.ctx;
    const pts = [this.worldToScreen(0, 0), this.worldToScreen(doc.width, 0), this.worldToScreen(doc.width, doc.height), this.worldToScreen(0, doc.height)];
    ctx.strokeStyle = OUTLINE_MAP;
    ctx.lineWidth = Math.max(2, 4 * this.camera.zoom);
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }

  /** 청크의 월드 px 상자 (줌 1) */
  private chunkBox(cx: number, cy: number, size: number) {
    const doc = this.doc!;
    const proj = this.proj;
    const xs = cx * size;
    const ys = cy * size;
    const xe = Math.min(doc.width, xs + size);
    const ye = Math.min(doc.height, ys + size);
    const corners = [proj.toScreen(xs, ys), proj.toScreen(xe, ys), proj.toScreen(xs, ye), proj.toScreen(xe, ye)];
    const pad = 2;
    return {
      xs, ys, xe, ye,
      x0: Math.min(...corners.map((p) => p.x)) - pad,
      y0: Math.min(...corners.map((p) => p.y)) - pad,
      x1: Math.max(...corners.map((p) => p.x)) + pad,
      y1: Math.max(...corners.map((p) => p.y)) + pad,
    };
  }

  private chunk(cx: number, cy: number, scale: number, box: ReturnType<WorldRenderer["chunkBox"]>) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (c && c.scale === scale) {
      this.chunks.delete(key);
      this.chunks.set(key, c);
      return c;
    }
    if (c) {
      this.chunks.delete(key);
      this.chunkBytes -= c.bytes;
    }
    const doc = this.doc!;
    const proj = this.proj;
    const { xs, ys, xe, ye, x0: bx0, y0: by0, x1: bx1, y1: by1 } = box;
    const canvas = c?.canvas ?? document.createElement("canvas");
    canvas.width = Math.ceil((bx1 - bx0) * scale);
    canvas.height = Math.ceil((by1 - by0) * scale);
    const g = canvas.getContext("2d")!;
    const [ma, mb, mc, md] = proj.groundMatrix;
    for (let y = ys; y < ye; y++) {
      for (let x = xs; x < xe; x++) {
        const id = tileAt(doc, x, y);
        const north = y > 0 ? tileAt(doc, x, y - 1) : id;
        const west = x > 0 ? tileAt(doc, x - 1, y) : id;
        const o = proj.toScreen(x, y);
        g.setTransform(scale * ma, scale * mb, scale * mc, scale * md, (o.x - bx0) * scale, (o.y - by0) * scale);
        const ta = getAsset(id);
        const tex = ta?.render.texture ? resolveSprite(ta.render.texture) : null;
        drawTileUnit(g, ta, x, y, { n: north !== id, w: west !== id }, proj.id, tex ? { image: tex.atlas.image, ...tex.frame } : null);
      }
    }
    c = { canvas, scale, bytes: canvas.width * canvas.height * 4, ox: bx0, oy: by0 };
    this.chunks.set(key, c);
    this.chunkBytes += c.bytes;
    this.stats.chunkBuilds++;
    const budget = QUALITY[this.quality].chunkBudget;
    for (const [k, v] of this.chunks) {
      if (this.chunkBytes <= budget || k === key) break;
      this.chunks.delete(k);
      this.chunkBytes -= v.bytes;
      v.canvas.width = v.canvas.height = 0;
    }
    return c;
  }

  private spriteScale() {
    const z = this.camera.zoom * this.dpr;
    return z <= 0.75 ? 0.75 : z <= 1.1 ? 1 : z <= 1.6 ? 1.5 : 2;
  }

  /** 방향 2 에셋: 0/180° = a, 90/270° = b. 반전은 하지 않는다(앞뒤가 바뀌므로) */
  private resolveFrame(a: AssetDef, rot: Rot) {
    const view = this.proj.id === "iso" ? a.render.iso : a.render.td;
    const orient = a.orients === 2 ? (rot === 90 || rot === 270 ? "b" : "a") : null;
    for (const cand of view.sprites) {
      const hit = (orient && resolveSprite(`${cand.ref}@${orient}`)) || resolveSprite(cand.ref);
      if (hit) return { ...hit, scale: cand.scale };
    }
    return null;
  }

  /** (시점, 에셋, 회전, 배율)별로 한 번만 그려 두는 스프라이트 */
  private sprite(assetId: string, rot: Rot): SpriteEntry | null {
    const scale = this.spriteScale();
    const key = `${this.proj.id}|${assetId}|${rot}|${scale}`;
    const hit = this.sprites.get(key);
    if (hit) {
      this.sprites.delete(key);
      this.sprites.set(key, hit);
      return hit;
    }
    const a = getAsset(assetId);
    if (!a) return null;
    const fp = footprintOf(a, rot);
    const fb = this.proj.footprintBox(fp.w, fp.d, 0);
    const bw = fb.x1 - fb.x0;
    const frame = this.resolveFrame(a, rot);
    let minX: number, minY: number, maxX: number, maxY: number;
    let dw = 0;
    let dh = 0;
    let bottom = 0;
    const centerX = (fb.x0 + fb.x1) / 2;
    if (frame) {
      dw = bw * frame.scale;
      dh = (dw * frame.frame.h) / frame.frame.w;
      // 바닥 접점: 탑뷰 = footprint 앞 가장자리 조금 안쪽, 아이소 = 남쪽 꼭짓점 조금 위
      bottom = this.proj.id === "td" ? fb.y1 * 0.92 : fb.y1 - 4;
      minX = Math.min(fb.x0, centerX - dw / 2) - 6;
      maxX = Math.max(fb.x1, centerX + dw / 2) + 6;
      minY = Math.min(0, bottom - dh) - 6;
      maxY = Math.max(bottom, fb.y1) + 6;
    } else {
      const extra = a.shape === "house" ? 16 : a.shape === "flag" ? 40 : 14;
      minX = fb.x0 - extra;
      maxX = fb.x1 + extra;
      minY = -(a.height * HU + 34);
      maxY = fb.y1 + 8;
    }
    const w = Math.ceil(maxX - minX);
    const h = Math.ceil(maxY - minY);
    const ox = -minX;
    const oy = -minY;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const g = canvas.getContext("2d")!;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.translate(ox, oy);
    if (frame) {
      // 바닥 그림자는 렌더러가 통일해서 그린다
      const gx = this.proj.id === "td" ? fb.y1 * 0.6 : fb.y1 / 2;
      g.fillStyle = "rgba(24,28,58,0.22)";
      g.beginPath();
      g.ellipse(centerX, gx, bw * 0.42, fb.y1 * (this.proj.id === "td" ? 0.34 : 0.4), 0, 0, Math.PI * 2);
      g.fill();
      g.imageSmoothingQuality = "high";
      const f = frame.frame;
      g.drawImage(frame.atlas.image, f.x, f.y, f.w, f.h, centerX - dw / 2, bottom - dh, dw, dh);
    } else if (this.proj.id === "iso") {
      drawAssetShapeIso(g, a, fp.w, fp.d);
    } else {
      drawAssetShape(g, a, fp.w, fp.d);
    }
    const entry = { canvas, ox, oy, w, h, bytes: canvas.width * canvas.height * 4 };
    this.sprites.set(key, entry);
    this.spriteBytes += entry.bytes;
    this.stats.spriteBuilds++;
    const budget = QUALITY[this.quality].spriteBudget;
    for (const [k, v] of this.sprites) {
      if (this.spriteBytes <= budget || k === key) break;
      this.sprites.delete(k);
      this.spriteBytes -= v.bytes;
      v.canvas.width = v.canvas.height = 0;
    }
    return entry;
  }

  private drawObject(o: PlacedObject, alpha: number, selected: boolean) {
    const s = this.sprite(o.assetId, o.rot);
    if (!s) return;
    const ctx = this.ctx;
    const { zoom } = this.camera;
    const k = o.scale ?? 1;
    const p = this.worldToScreen(o.x, o.y);
    if (selected) {
      const a = getAsset(o.assetId)!;
      const fp = footprintOf(a, o.rot, k);
      this.cellPolygon(o.x, o.y, fp.w, fp.d);
      ctx.fillStyle = "rgba(255,111,97,0.28)";
      ctx.fill();
      ctx.strokeStyle = "#ff6f61";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (k === 1) {
      ctx.drawImage(s.canvas, p.x - s.ox * zoom, p.y - s.oy * zoom, s.w * zoom, s.h * zoom);
    } else {
      // 배율: 기본 크기 스프라이트를 바닥 중심 기준으로 확대/축소해 점유 칸 중심에 맞춘다 (캐시는 기본 크기 하나만)
      const a = getAsset(o.assetId)!;
      const base = footprintOf(a, o.rot);
      const fp = footprintOf(a, o.rot, k);
      const anchor = this.proj.toScreen(base.w / 2, base.d / 2);
      const target = this.worldToScreen(o.x + fp.w / 2, o.y + fp.d / 2);
      ctx.drawImage(s.canvas, target.x - (s.ox + anchor.x) * k * zoom, target.y - (s.oy + anchor.y) * k * zoom, s.w * k * zoom, s.h * k * zoom);
    }
    if (alpha < 1) ctx.globalAlpha = 1;
    this.stats.objectsDrawn++;
  }

  /** 1단계에서 찍은 시작 포털: 실제 포털 그림 + 맥동 테두리 + "시작" 라벨 */
  private drawPending(pp: { x: number; y: number; label: string }, t: number) {
    const ctx = this.ctx;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 3));
    this.cellPolygon(pp.x - 0.15, pp.y - 0.15, 1.3, 1.3);
    ctx.fillStyle = `rgba(255,111,97,${0.18 + 0.12 * pulse})`;
    ctx.fill();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#ff6f61";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawObject({ id: "__pending", assetId: "act.portal", x: pp.x, y: pp.y, rot: 0 }, 0.9, false);
    this.stats.objectsDrawn--;
    this.drawTag(pp.x, pp.y, pp.label, "#ff6f61", 1.6);
  }

  private drawLink(a: { x: number; y: number }, b: { x: number; y: number }) {
    const ctx = this.ctx;
    const p = this.worldToScreen(a.x + 0.5, a.y + 0.5);
    const q = this.worldToScreen(b.x + 0.5, b.y + 0.5);
    ctx.save();
    ctx.setLineDash([10, 7]);
    ctx.strokeStyle = "rgba(255,111,97,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    ctx.restore();
  }

  /** 셀 위에 띄우는 작은 라벨 */
  private drawTag(x: number, y: number, text: string, color: string, z = 1.2) {
    const ctx = this.ctx;
    const p = this.worldToScreen(x + 0.5, y + 0.5, z);
    ctx.font = "bold 12px system-ui, sans-serif";
    const tw = ctx.measureText(text).width + 14;
    ctx.fillStyle = color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(p.x - tw / 2, p.y - 22, tw, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, p.x, p.y - 12);
  }

  private drawPlayer(p: PlayerView, t: number) {
    const ctx = this.ctx;
    const s = this.worldToScreen(p.x, p.y);
    const { zoom } = this.camera;
    const inBush = this.doc?.objects.some((o) => o.assetId === "nature.bush" && o.x === Math.floor(p.x) && o.y === Math.floor(p.y));
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(zoom, zoom);
    if (inBush) ctx.globalAlpha = 0.55;
    // 시점별 아바타: 탑뷰 행 s/w/n/e, 아이소 행 se/sw/nw/ne. 0=대기, 1~3=걷기 (10fps, 1-2-3-2)
    // 격자 방향 → 아이소 화면 방향: 남(+y)=남서, 서=북서, 북=북동, 동=남동
    const walk = [1, 2, 3, 2][Math.floor(t * 10) % 4];
    const frameNo = p.walkFrame ?? (p.moving ? walk : 0);
    let sprite;
    if (this.proj.id === "iso") {
      // 8방향 시트 우선, 없으면 기존 4대각 시트의 가까운 방향
      const d8 = p.face8 ?? [1, 3, 5, 7][p.dir] ?? 1;
      const name8 = ["s", "sw", "w", "nw", "n", "ne", "e", "se"][d8];
      const near4 = ["sw", "sw", "nw", "nw", "ne", "ne", "se", "se"][d8];
      sprite = resolveSprite(`iso-avatar:${name8}${frameNo}`) ?? resolveSprite(`iso-avatar:${near4}${frameNo}`);
    } else {
      sprite = resolveSprite(`td-avatar:${"swne"[p.dir] ?? "s"}${frameNo}`) ?? resolveSprite(`avatar:${"swne"[p.dir] ?? "s"}${frameNo}`);
    }
    ctx.fillStyle = "rgba(24,28,58,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, -2, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (sprite) {
      const f = sprite.frame;
      const dh = AVATAR_H;
      const dw = (dh * f.w) / f.h;
      ctx.drawImage(sprite.atlas.image, f.x, f.y, f.w, f.h, -dw / 2, -dh + 4, dw, dh);
    } else {
      drawAvatar(ctx, p.style, p.dir, t, p.moving);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 12px system-ui, sans-serif";
    const tw = ctx.measureText(p.name).width + 14;
    ctx.fillStyle = "rgba(27,36,64,0.85)";
    ctx.beginPath();
    ctx.roundRect(-tw / 2, -AVATAR_H - 18, tw, 20, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.name, 0, -AVATAR_H - 8);
    ctx.restore();
  }

  private drawGrid(x0: number, x1: number, y0: number, y1: number) {
    if (x0 > x1 || y0 > y1) return;
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(27,31,58,0.13)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 1; x++) {
      const a = this.worldToScreen(x, y0);
      const b = this.worldToScreen(x, y1 + 1);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let y = y0; y <= y1 + 1; y++) {
      const a = this.worldToScreen(x0, y);
      const b = this.worldToScreen(x1 + 1, y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /** 셀 사각형의 바닥 다각형 경로 */
  private cellPolygon(x: number, y: number, w = 1, h = 1) {
    const ctx = this.ctx;
    const pts = [this.worldToScreen(x, y), this.worldToScreen(x + w, y), this.worldToScreen(x + w, y + h), this.worldToScreen(x, y + h)];
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  private drawCellOutline(c: { x: number; y: number; w?: number; h?: number }, color: string) {
    const ctx = this.ctx;
    this.cellPolygon(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  private drawGhost(g: Ghost) {
    const a = getAsset(g.assetId);
    if (!a) return;
    const ctx = this.ctx;
    if (a.kind === "tile") {
      this.cellPolygon(g.x, g.y);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = a.colors.top;
      ctx.fill();
      ctx.globalAlpha = 1;
      this.drawCellOutline({ x: g.x, y: g.y }, "#19c2b5");
      return;
    }
    const fp = footprintOf(a, g.rot, g.scale ?? 1);
    this.cellPolygon(g.x, g.y, fp.w, fp.d);
    ctx.fillStyle = g.valid ? "rgba(25,194,181,0.28)" : "rgba(255,80,80,0.35)";
    ctx.fill();
    this.drawObject({ id: "__ghost", assetId: g.assetId, x: g.x, y: g.y, rot: g.rot, scale: g.scale }, 0.65, false);
    this.stats.objectsDrawn--;
  }

  private drawHighlights(h: { added: Set<string>; removed: Set<string> }) {
    const ctx = this.ctx;
    const paint = (set: Set<string>, color: string) => {
      ctx.fillStyle = color;
      for (const k of set) {
        const [x, y] = k.split(",").map(Number);
        this.cellPolygon(x, y);
        ctx.fill();
      }
    };
    paint(h.removed, "rgba(255,80,80,0.35)");
    paint(h.added, "rgba(25,194,181,0.3)");
  }

  private drawZone(z: Zone, mode: SceneState["mode"]) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = mode === "edit" ? "rgba(255,111,97,0.9)" : "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    this.cellPolygon(z.x + 0.04, z.y + 0.04, z.w - 0.08, z.h - 0.08);
    ctx.stroke();
    ctx.restore();
  }

  private drawZoneLabel(z: Zone) {
    // 라벨은 구역의 화면상 가장 위 꼭짓점 근처
    const p = this.worldToScreen(z.x, z.y);
    const ctx = this.ctx;
    ctx.font = "bold 13px system-ui, sans-serif";
    const tw = ctx.measureText(z.name).width + 16;
    const lx = this.proj.id === "iso" ? p.x - tw / 2 : p.x + 6;
    const ly = p.y + 6;
    ctx.fillStyle = "rgba(255,111,97,0.95)";
    ctx.beginPath();
    ctx.roundRect(lx, ly, tw, 22, 11);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(z.name, lx + 8, ly + 11);
  }

  private drawSpawn() {
    const doc = this.doc!;
    const ctx = this.ctx;
    const c = this.worldToScreen(doc.spawn.x + 0.5, doc.spawn.y + 0.5);
    this.cellPolygon(doc.spawn.x + 0.12, doc.spawn.y + 0.12, 0.76, 0.76);
    ctx.fillStyle = "rgba(25,194,181,0.35)";
    ctx.strokeStyle = "#19c2b5";
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1b2440";
    ctx.font = `bold ${Math.max(9, Math.round(12 * this.camera.zoom))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("시작", c.x, c.y);
  }

  private drawBubble(c: { x: number; y: number }, t: number) {
    const p = this.worldToScreen(c.x + 0.5, c.y + 0.5, 2.4);
    const ctx = this.ctx;
    const bob = Math.sin(t * 5) * 3;
    ctx.fillStyle = "#ff6f61";
    ctx.strokeStyle = OUTLINE_MAP;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y + bob, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", p.x, p.y + bob + 1);
  }
}

function chunkChanged(a: MapDoc, b: MapDoc, cx: number, cy: number, size: number) {
  // 북쪽·서쪽 이웃에 따라 물가 둑이 바뀌므로 경계 한 줄씩 더 본다
  for (let y = Math.max(0, cy * size - 1); y < Math.min(b.height, (cy + 1) * size); y++) {
    for (let x = Math.max(0, cx * size - 1); x < Math.min(b.width, (cx + 1) * size); x++) {
      const i = y * b.width + x;
      if (a.terrainPalette[a.terrain[i]] !== b.terrainPalette[b.terrain[i]]) return true;
    }
  }
  return false;
}
