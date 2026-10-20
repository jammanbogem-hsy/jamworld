// 이미지 생성 프롬프트 (이식용으로 분리). 학생 문장은 길이 제한 후 '설명'으로만 넣는다.
import type { ApprovedSnapshot } from "./types.ts";
import { CATEGORY_KO } from "./types.ts";

export const IMAGE_MODEL = "gpt-image-2.5-flare";

const STYLE =
  "Original chunky cartoon toy-like game asset in the Moa World style: thick dark navy (#1b1f3a) outline, 2-3 tone cel shading, " +
  "vivid saturated colors (jade/teal, coral, gold, warm wood), fixed light from the upper left, clean simple shapes readable at 64px. " +
  "No text, no logo, no frame, no ground shadow, no background scenery.";

function subject(s: ApprovedSnapshot) {
  const d = s.draft;
  const desc = d.description.trim().slice(0, 300);
  return `Subject: "${d.name.slice(0, 30)}" (${CATEGORY_KO[d.category]}). ${desc ? `Student description: ${desc}.` : ""} Footprint about ${d.footprint.w}x${d.footprint.d} grid cells, height about ${d.height} units.`;
}

export function texturePrompt(s: ApprovedSnapshot, hasDrawing = false) {
  return `${subject(s)}\n${hasDrawing ? "Use the attached student drawing as the design reference for colors and pattern. " : ""}Create ONE seamless tileable square ground texture seen straight from above (orthographic, no perspective), filling the whole image edge to edge, opaque, no objects or shadows, large clean color areas with a few simple bold details. ${STYLE.replace("no ground shadow, ", "")}`;
}

export function topDownPrompt(s: ApprovedSnapshot, hasDrawing: boolean) {
  return `${subject(s)}\n${hasDrawing ? "Use the attached student drawing as the design reference: keep its idea, colors and silhouette, and redraw it cleanly. " : ""}Draw a single object centered on a transparent background in a fixed top-down 3/4 game view looking north: show the top and the south-facing front, no side faces visible, viewed from about 55 degrees above. The object's lowest point touches the bottom center of the image. ${STYLE}`;
}

export function isoPrompt(s: ApprovedSnapshot) {
  return `${subject(s)}\nThe attached image is the same object in top-down view. Redraw exactly the same object (same shape, colors, details and proportions) in a 2:1 isometric game view: show the top and both the south-west and south-east faces, centered on a transparent background, its lowest point at the bottom center. ${STYLE}`;
}
