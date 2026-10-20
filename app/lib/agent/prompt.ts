// 모델에 보낼 맵 요약·카탈로그·도구 정의. 서버와 테스트에서 공유한다.
import { CATALOG, scopedUserAssets, withAssetScope } from "../world/catalog.ts";
import { assetScopeFor } from "../world/ops.ts";
import type { EmbeddedAsset } from "../world/types.ts";
import { tileAt } from "../world/map.ts";
import { OP_NAMES } from "../world/ops.ts";
import type { MapDoc } from "../world/types.ts";
import { getAsset } from "../world/catalog.ts";

export const MAX_AGENT_CELLS = 120 * 120;
const MAX_LISTED_OBJECTS = 350;

export const SYSTEM_PROMPT = `당신은 '모아 월드' 맵 편집 에이전트입니다. 사용자의 한국어 요청을 읽고, 현재 맵을 수정하는 선언적 작업 목록을 submit_map_ops 도구로 제출합니다.

규칙:
- 반드시 submit_map_ops 도구를 정확히 한 번 호출하세요. 코드나 설명문만 답하지 마세요.
- 에셋은 제공된 카탈로그의 id 만 사용하세요. 없는 에셋이 필요하면 가장 비슷한 것을 쓰고 summary 에 알리세요.
- 좌표는 셀 단위 정수입니다. x 는 오른쪽으로, y 는 아래쪽(화면 앞쪽)으로 증가합니다. "오른쪽"=큰 x, "아래"=큰 y.
- 오브젝트끼리 같은 칸에 겹칠 수 없습니다. 맵 경계 밖에 놓을 수 없습니다.
- 시작 위치(S)를 막지 말고, 시작 위치에서 모든 구역·안내판·퀴즈·포털까지 걸어갈 수 있게 하세요. 방에는 문(doors)을 남기세요.
- 방은 room 작업을 쓰세요. room 은 해당 사각형을 비우고 바닥·벽·문·구역을 한 번에 만듭니다. 구역 이름은 사용자가 나중에 부를 수 있게 짧고 구체적으로.
- 기존 방을 넓히거나 옮길 때: clearRect 로 옛 방 사각형을 지운 뒤 같은 name 으로 room 을 다시 만들고 안의 가구를 다시 배치하세요.
- 안내판은 sign, 퀴즈는 quiz(보기 2~5개, answer 는 0부터), 포털은 portalPair 를 쓰세요.
- 요청 범위 밖의 기존 내용은 건드리지 마세요. 작업 수는 꼭 필요한 만큼(최대 200개).
- summary 는 사용자에게 보여 줄 한국어 1~3문장입니다.

작업 형식(op 필드로 구분):
place{assetId,x,y,rot?} remove{id} move{id,x,y} rotate{id,rot}
paint{tileId,x,y,w?,h?} clearRect{x,y,w,h} line{assetId,x1,y1,x2,y2(가로/세로만)}
scatter{assetId,x,y,w,h,count,seed?} room{name,x,y,w,h,wallId?,floorId?,doors?:[{side:N|S|E|W,at?,width?}]}
zone{name,x,y,w,h} removeZone{id} sign{x,y,text} quiz{x,y,question,choices,answer}
portalPair{a:{x,y},b:{x,y},label?} removeInteraction{id} setSpawn{x,y}`;

export const TOOL_NAME = "submit_map_ops";
export const TOOL_DESCRIPTION = "현재 맵에 적용할 선언적 작업 목록과 사용자에게 보여 줄 요약을 제출합니다.";

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "사용자에게 보여 줄 한국어 요약 (1~3문장)" },
    ops: {
      type: "array",
      description: "순서대로 적용할 작업 목록",
      items: {
        type: "object",
        properties: { op: { type: "string", enum: OP_NAMES } },
        required: ["op"],
        additionalProperties: true,
      },
    },
  },
  required: ["summary", "ops"],
} as const;

/** 내장 카탈로그 + 현재 요청 범위의 사용자 에셋(그 actor 의 보관함·맵 정의). 다른 사용자 에셋은 넣지 않는다 */
export function catalogText() {
  const lines = [...CATALOG, ...scopedUserAssets()].map((a) => {
    const fp = `${a.footprint.w}x${a.footprint.d}`;
    const flags = a.kind === "tile" ? (a.walkable === false ? "타일,이동불가" : "타일") : a.blocking ? "막힘" : "통과";
    return `${a.id} | ${a.name} | ${fp} | ${flags} | ${a.tags.join(",")}`;
  });
  return `id | 이름 | 크기(가로x세로) | 성질 | 태그\n${lines.join("\n")}`;
}

/** 맵 상태를 문자 격자로 요약 (#막힘 ~물 o통과오브젝트 S시작 .빈칸) */
export function mapContext(doc: MapDoc) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const occ = new Map<number, string>();
  for (const o of doc.objects) {
    const a = getAsset(o.assetId);
    const fp = a ? (o.rot === 90 || o.rot === 270 ? { w: a.footprint.d, d: a.footprint.w } : a.footprint) : { w: 1, d: 1 };
    for (let dy = 0; dy < fp.d; dy++) for (let dx = 0; dx < fp.w; dx++) occ.set((o.y + dy) * doc.width + o.x + dx, a?.blocking ? "#" : "o");
  }
  const objRows: string[] = [];
  const terrRows: string[] = [];
  for (let y = 0; y < doc.height; y++) {
    let r = "";
    let t = "";
    for (let x = 0; x < doc.width; x++) {
      const i = y * doc.width + x;
      const tile = tileAt(doc, x, y);
      if (x === doc.spawn.x && y === doc.spawn.y) r += "S";
      else if (occ.has(i)) r += occ.get(i);
      else if (getAsset(tile)?.walkable === false) r += "~";
      else r += ".";
      t += letters[doc.terrain[i]] ?? "?";
    }
    objRows.push(`${String(y).padStart(3)} ${r}`);
    terrRows.push(`${String(y).padStart(3)} ${t}`);
  }
  const header = "    " + Array.from({ length: doc.width }, (_, x) => (x % 10 === 0 ? String((x / 10) % 10) : " ")).join("");
  const palette = doc.terrainPalette.map((id, i) => `${letters[i]}=${id}`).join(", ");
  const objects = doc.objects.slice(0, MAX_LISTED_OBJECTS).map((o) => `${o.id} ${o.assetId} (${o.x},${o.y})${o.rot ? ` rot${o.rot}` : ""}`);
  const more = doc.objects.length > MAX_LISTED_OBJECTS ? `\n… 외 ${doc.objects.length - MAX_LISTED_OBJECTS}개 생략` : "";
  const zones = doc.zones.map((z) => `${z.id} '${z.name}' x=${z.x} y=${z.y} w=${z.w} h=${z.h}`);
  const inter = doc.interactions.map((i) =>
    i.type === "sign" ? `${i.id} 안내판 (${i.x},${i.y}) "${i.text.slice(0, 40)}"` : i.type === "quiz" ? `${i.id} 퀴즈 (${i.x},${i.y}) "${i.question.slice(0, 40)}"` : `${i.id} 포털 (${i.x},${i.y}) → ${i.targetId ?? i.targetMapId}`,
  );
  return [
    `맵 '${doc.name}' 크기 ${doc.width}x${doc.height}, 시작 위치 (${doc.spawn.x},${doc.spawn.y})`,
    `[점유 격자] #=막는 오브젝트 o=통과 오브젝트 ~=물 S=시작 .=빈칸 (행 번호=y, 열=x)\n${header}\n${objRows.join("\n")}`,
    `[바닥 격자] ${palette}\n${header}\n${terrRows.join("\n")}`,
    `[구역]\n${zones.join("\n") || "(없음)"}`,
    `[상호작용]\n${inter.join("\n") || "(없음)"}`,
    `[오브젝트 목록]\n${objects.join("\n") || "(없음)"}${more}`,
  ].join("\n\n");
}

export function userMessage(doc: MapDoc, request: string, extraAssets?: Record<string, EmbeddedAsset>) {
  return withAssetScope(assetScopeFor(doc, extraAssets), () => `[에셋 카탈로그]\n${catalogText()}\n\n[현재 맵]\n${mapContext(doc)}\n\n[사용자 요청]\n${request}`);
}

export function repairMessage(errors: string[]) {
  return `제출한 작업을 적용하지 못했습니다. 맵은 바뀌지 않았습니다. 다음 문제를 고쳐 submit_map_ops 를 다시 호출하세요:\n- ${errors.slice(0, 8).join("\n- ")}`;
}

/** 모델 출력 → {summary, ops}. 도구 입력이 문자열로 올 수도 있어 둘 다 처리 */
export function parseToolInput(input: unknown): { summary: string; ops: unknown[] } | null {
  let v = input;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      const m = /\{[\s\S]*\}/.exec(v as string);
      if (!m) return null;
      try {
        v = JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { summary?: unknown; ops?: unknown };
  if (!Array.isArray(o.ops)) return null;
  return { summary: typeof o.summary === "string" ? o.summary : "", ops: o.ops };
}
