// 공방 보조 에이전트: 학생 대화를 읽고 제작 카드(이름·설명·분류·태그·크기·통과 여부)를 제안한다.
// 제안일 뿐이며 제출·승인·생성은 학생/교사가 따로 한다. 이미지 생성은 하지 않는다.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { DEFAULT_MODELS, type ProviderEnv } from "./providers";

const SYSTEM = `당신은 초등학생이 게임 맵에 쓸 그림 에셋을 기획하도록 돕는 '모아 월드 에셋 공방' 도우미입니다.
학생의 말을 듣고 짧고 친절한 한국어로 답한 뒤, propose_card 도구로 제작 카드를 제안하세요.
- 분류(category): terrain(바닥 텍스처), nature, building, furniture, interactive(그림만, 실제 포털·퀴즈 기능은 따로 지정), decor, character(배치용 정적 인물, 걷는 플레이 아바타 아님)
- 태그 1~8개(짧은 한국어 단어), 이름 30자 이내, 설명 300자 이내(색·모양·재료를 구체적으로)
- footprint 는 1~3칸, height 는 0.2~3, 지나갈 수 있는 물체면 passable=true
- 폭력적·무서운·개인정보·실존 인물·상표가 들어간 요청은 정중히 다른 아이디어를 제안하세요.
- 이미지를 만들었다고 말하지 마세요. 카드는 선생님 승인 후에 그림으로 만들어집니다.`;

const CARD_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    category: { type: "string", enum: ["terrain", "nature", "building", "furniture", "interactive", "decor", "character"] },
    tags: { type: "array", items: { type: "string" } },
    footprint: { type: "object", properties: { w: { type: "integer" }, d: { type: "integer" } } },
    passable: { type: "boolean" },
    height: { type: "number" },
  },
  required: ["reply", "name", "category", "tags"],
} as const;

export interface AssistTurn {
  role: "user" | "assistant";
  text: string;
}

/** 기본 OpenAI(비용 기준), 학생이 고르면 그 공급자. 고른 공급자 키가 없으면 다른 쪽으로 대신 답하고 실제 모델을 돌려준다 */
export async function assistCard(
  env: ProviderEnv,
  turns: AssistTurn[],
  signal: AbortSignal,
  prefer: "openai" | "anthropic" = "openai",
): Promise<{ reply: string; card: Record<string, unknown> | null; model: string; provider: "openai" | "anthropic" }> {
  const msgs = turns.slice(-12).map((t) => ({ role: t.role, content: t.text.slice(0, 800) }));
  const useAnthropic = prefer === "anthropic" ? !!env.ANTHROPIC_API_KEY : !env.OPENAI_API_KEY && !!env.ANTHROPIC_API_KEY;
  if (useAnthropic && env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
    const model = env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
    const res = await client.messages.create(
      {
        model,
        max_tokens: 2000,
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: [{ name: "propose_card", description: "제작 카드 제안", input_schema: CARD_SCHEMA as unknown as Anthropic.Tool.InputSchema }],
        tool_choice: { type: "auto" },
        messages: msgs,
      } as Anthropic.MessageCreateParamsNonStreaming,
      { signal },
    );
    const tool = res.content.find((b) => b.type === "tool_use");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    const card = tool && tool.type === "tool_use" ? (tool.input as Record<string, unknown>) : null;
    return { reply: String(card?.reply ?? text ?? "").slice(0, 600) || "카드를 확인해 주세요.", card, model: res.model, provider: "anthropic" };
  }
  if (env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 1, timeout: 60_000 });
    const model = env.OPENAI_MODEL || DEFAULT_MODELS.openai;
    const res = await client.responses.create(
      {
        model,
        instructions: SYSTEM,
        input: msgs,
        tools: [{ type: "function", name: "propose_card", description: "제작 카드 제안", parameters: CARD_SCHEMA as unknown as Record<string, unknown>, strict: false }],
        tool_choice: "required",
        max_output_tokens: 2000,
      },
      { signal },
    );
    const call = (res.output ?? []).find((o) => o.type === "function_call");
    let card: Record<string, unknown> | null = null;
    if (call && call.type === "function_call") {
      try {
        card = JSON.parse(call.arguments);
      } catch {
        card = null;
      }
    }
    return { reply: String(card?.reply ?? res.output_text ?? "").slice(0, 600) || "카드를 확인해 주세요.", card, model: res.model, provider: "openai" };
  }
  throw new Error("대화 도우미 키가 설정되지 않았습니다");
}
