"use client";

import { useEffect, useRef, useState } from "react";
import { recolorPixels } from "@/lib/render/avatar-look";
import type { AvatarLook } from "@/lib/server/workshop/avatar";

interface Sheet {
  image: HTMLImageElement;
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

async function loadSheet(name: string): Promise<Sheet | null> {
  try {
    const meta = (await (await fetch(`/assets/atlas/${name}.json`)).json()) as { image: string; frames: Sheet["frames"] };
    const image = new Image();
    image.src = `/assets/atlas/${meta.image}`;
    await image.decode();
    return { image, frames: meta.frames };
  } catch {
    return null;
  }
}

/** 탑뷰·아이소 아바타 미리보기 (색 적용, 걷기 프레임 순환) */
export default function AvatarPreview({ look }: { look: AvatarLook }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sheets, setSheets] = useState<{ td: Sheet | null; iso: Sheet | null } | null>(null);
  const tinted = useRef<{ td?: HTMLCanvasElement; iso?: HTMLCanvasElement }>({});

  useEffect(() => {
    void Promise.all([loadSheet("td-avatar"), loadSheet("iso-avatar")]).then(([td, iso]) => setSheets({ td, iso }));
  }, []);

  // 외형이 바뀔 때만 색 적용 (한 번 계산)
  useEffect(() => {
    if (!sheets) return;
    for (const v of ["td", "iso"] as const) {
      const s = sheets[v];
      if (!s) continue;
      const c = tinted.current[v] ?? document.createElement("canvas");
      c.width = s.image.naturalWidth;
      c.height = s.image.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(s.image, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      recolorPixels(d.data, look);
      g.putImageData(d, 0, 0);
      tinted.current[v] = c;
    }
  }, [sheets, look]);

  // 미리보기는 보이는 동안만 8fps 로 걷기
  useEffect(() => {
    if (!sheets) return;
    let raf = 0;
    let last = 0;
    let n = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || t - last < 125) return;
      last = t;
      n++;
      const c = ref.current;
      if (!c) return;
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, c.width, c.height);
      const f = [1, 2, 3, 2][n % 4];
      const items: Array<[Sheet | null, HTMLCanvasElement | undefined, string, number, string]> = [
        [sheets.td, tinted.current.td, `s${f}`, 40, "탑뷰"],
        [sheets.td, tinted.current.td, `e${f}`, 140, ""],
        [sheets.iso, tinted.current.iso, `se${f}`, 260, "아이소"],
        [sheets.iso, tinted.current.iso, `nw${f}`, 360, ""],
      ];
      g.font = "bold 12px system-ui";
      g.fillStyle = "#4a5574";
      for (const [s, img, name, x, label] of items) {
        const fr = s?.frames[name] ?? s?.frames[name.replace(/\d$/, "0")];
        if (!s || !img || !fr) continue;
        const h = 150;
        const w = (h * fr.w) / fr.h;
        g.fillStyle = "rgba(24,28,58,0.18)";
        g.beginPath();
        g.ellipse(x + 40, 178, 26, 9, 0, 0, Math.PI * 2);
        g.fill();
        g.drawImage(img, fr.x, fr.y, fr.w, fr.h, x + 40 - w / 2, 182 - h, w, h);
        if (label) {
          g.fillStyle = "#4a5574";
          g.fillText(label, x + 60, 204);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sheets]);

  return (
    <div>
      <canvas ref={ref} width={460} height={212} style={{ width: "100%", maxWidth: 460, background: "#e9f6ee", borderRadius: 14 }} aria-label="아바타 미리보기" />
      {!sheets && <p className="ws-note">미리보기 불러오는 중…</p>}
    </div>
  );
}
