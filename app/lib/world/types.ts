// 모아 월드 맵 문서 스키마. 편집기·에이전트·플레이가 모두 이 문서 하나를 공유한다.

export const SCHEMA_VERSION = 1;

export type Rot = 0 | 90 | 180 | 270;

export interface PlacedObject {
  id: string;
  assetId: string;
  x: number;
  y: number;
  rot: Rot;
  /** 크기 배율 0.5~3 (없으면 1). 점유 칸 = max(1, round(기본 칸 × 배율)), 충돌은 점유 칸과 같다 */
  scale?: number;
}

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignInteraction {
  id: string;
  type: "sign";
  x: number;
  y: number;
  text: string;
}

export interface QuizInteraction {
  id: string;
  type: "quiz";
  x: number;
  y: number;
  question: string;
  choices: string[];
  answer: number;
}

export interface PortalInteraction {
  id: string;
  type: "portal";
  x: number;
  y: number;
  /** 도착 포털 id. targetMapId 가 없으면 같은 맵, 있으면 그 맵 안의 포털 */
  targetId?: string;
  /** 같은 프로젝트의 다른 맵(페이지) id. targetId 가 없으면 그 맵의 시작점으로 이동 */
  targetMapId?: string;
  label?: string;
}

export type Interaction = SignInteraction | QuizInteraction | PortalInteraction;

export interface MapDoc {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  /** terrain 값은 이 팔레트(타일 에셋 id 목록)의 인덱스 */
  terrainPalette: string[];
  terrain: number[];
  objects: PlacedObject[];
  zones: Zone[];
  interactions: Interaction[];
  spawn: { x: number; y: number };
  /** 결정적 id 발급용 카운터 */
  nextId: number;
  /**
   * 맵에 쓴 사용자(공방) 에셋의 동작·이름 정보. 맵만 옮겨도 검증·충돌이 유지된다.
   * 그림 URL 은 권한이 있을 때만 보이고, 없으면 도형으로 대체된다.
   */
  assets?: Record<string, EmbeddedAsset>;
}

export interface EmbeddedAsset {
  name: string;
  kind: "tile" | "object";
  category: AssetDef["category"];
  tags: string[];
  footprint: { w: number; d: number };
  blocking: boolean;
  height: number;
  views: { td?: string; iso?: string; texture?: string };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  mapIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type AssetShape =
  | "flat"
  | "box"
  | "cyl"
  | "tree"
  | "pine"
  | "bush"
  | "rock"
  | "flower"
  | "fence"
  | "lamp"
  | "sign"
  | "board"
  | "portal"
  | "house"
  | "flag"
  | "shelf"
  | "desk"
  | "chair"
  | "bench";

export interface ViewRender {
  /**
   * 우선순위 순 프레임 후보. ref = "아틀라스:프레임" (방향 2 에셋은 렌더러가 "@a"/"@b" 를 붙여 먼저 찾는다),
   * scale = 그릴 폭 ÷ footprint 화면 폭
   */
  sprites: Array<{ ref: string; scale: number }>;
}

export interface AssetDef {
  id: string;
  name: string;
  kind: "tile" | "object";
  category: "terrain" | "nature" | "building" | "furniture" | "interactive" | "decor" | "character";
  tags: string[];
  /** 회전 0 기준 점유 셀 수 */
  footprint: { w: number; d: number };
  /** 셀 높이 단위 (렌더 전용, 충돌은 2D) */
  height: number;
  /** 오브젝트: 이동을 막는가 / 타일: 걸을 수 있는가 */
  blocking: boolean;
  walkable?: boolean;
  shape: AssetShape;
  colors: { top: string; side: string; accent?: string };
  interaction?: "sign" | "quiz" | "portal";
  /** 시각 방향 수: 1 = 대칭(회전해도 같은 그림, 자연물 등은 뒤집지 않음), 2 = a(긴 변 x축)/b(긴 변 y축) */
  orients: 1 | 2;
  /** 시점별 렌더 소스. 그 시점 아틀라스가 없으면 같은 시점의 도형 fallback (다른 시점 그림은 쓰지 않음) */
  render: {
    td: ViewRender;
    iso: ViewRender;
    /** 바닥 텍스처(정사각, 두 시점에 투영) "아틀라스:프레임" */
    texture?: string;
    glb?: { src: string; scale?: number; offset?: [number, number, number]; rotY?: number };
  };
  source: "builtin-shape" | "codex" | "tripo" | "user";
}
