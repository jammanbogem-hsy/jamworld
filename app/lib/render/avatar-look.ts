// 기본 탐험가 아바타 색 바꾸기 (무료·즉시, 서버·API 호출 없음).
// 원본 시트에서 옷(청록)·신발(코랄)·가방(금색)·머리(갈색) 색 영역을 찾아 색상각만 바꾸고 명암은 유지한다.
// 외형마다 한 번만 계산하고, 시점 아틀라스 이미지를 교체한다(원본은 보관해 되돌릴 수 있음).
import { COLOR_HSL, DEFAULT_LOOK, HAIR_HSL, isDefaultLook, type AvatarLook } from "../server/workshop/avatar";
import { replaceAtlasImage, originalAtlasImage } from "./atlas";

type Region = "top" | "shoes" | "pack" | "hair";

/** 원본 시트 기준 색(HSL) — 이 색에서 목표 색으로 옮긴다 */
const SOURCE: Record<Region, [number, number, number]> = {
  top: COLOR_HSL.teal,
  shoes: COLOR_HSL.coral,
  pack: COLOR_HSL.gold,
  hair: HAIR_HSL.brown,
};

function classify(h: number, s: number, l: number): Region | null {
  if (s > 0.25 && h >= 158 && h <= 200 && l > 0.15 && l < 0.85) return "top";
  if (s > 0.45 && h >= 36 && h <= 60 && l > 0.32 && l < 0.85) return "pack";
  if (s > 0.42 && (h >= 342 || h <= 12) && l > 0.38 && l < 0.82) return "shoes";
  return null;
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function target(look: AvatarLook, region: Region): [number, number, number] {
  return region === "hair" ? HAIR_HSL[look.hair] : COLOR_HSL[look[region]];
}

/** 픽셀 단위 색 바꾸기 (ImageData 를 직접 수정) */
export function recolorPixels(data: Uint8ClampedArray, look: AvatarLook) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    const [h, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
    const region = classify(h, s, l);
    if (!region) continue;
    const [sh, ss, sl] = SOURCE[region];
    const [th, ts, tl] = target(look, region);
    if (th === sh && ts === ss && tl === sl) continue;
    const ns = Math.max(0, Math.min(1, s * (ts / Math.max(ss, 0.01))));
    const nl = Math.max(0, Math.min(1, l + (tl - sl)));
    const [r, g, b] = hsl2rgb(th, ns, nl);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

const lookKey = (l: AvatarLook) => `${l.top}-${l.shoes}-${l.pack}-${l.hair}`;
let appliedKey = lookKey(DEFAULT_LOOK);

/** 현재 불러온 아바타 아틀라스(td/iso)에 외형 적용. 기본 외형이면 원본으로 되돌린다 */
export function applyAvatarLook(look: AvatarLook | null | undefined, names = ["td-avatar", "iso-avatar", "avatar"]) {
  const l = look ?? DEFAULT_LOOK;
  const key = lookKey(l);
  for (const name of names) {
    const orig = originalAtlasImage(name);
    if (!orig) continue;
    if (isDefaultLook(l)) {
      replaceAtlasImage(name, orig);
      continue;
    }
    const w = (orig as HTMLImageElement).naturalWidth || (orig as HTMLCanvasElement).width;
    const h = (orig as HTMLImageElement).naturalHeight || (orig as HTMLCanvasElement).height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) continue;
    g.drawImage(orig, 0, 0);
    const img = g.getImageData(0, 0, w, h);
    recolorPixels(img.data, l);
    g.putImageData(img, 0, 0);
    replaceAtlasImage(name, c);
  }
  appliedKey = key;
  return appliedKey;
}
