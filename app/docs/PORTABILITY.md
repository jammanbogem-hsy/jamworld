# 이식·자체 호스팅 안내

모아 월드를 다른 프로젝트나 서버로 옮길 때 필요한 경계와 형식을 정리한다.

## 1. 맵 데이터 (브라우저)

- 스페이스(프로젝트)는 지금 브라우저 `localStorage` 에 저장한다(`moa.projects.v1`, `moa.map.v1.<id>`).
- **내보내기**: 에디터 "내보내기" → `*.moa-project.json`
  - 형식: `{format:"moa-world/project", version:1, project, maps[]}`
  - 모든 페이지와 페이지 간 포털을 함께 담는다. 페이지 메뉴 "이 페이지만 내보내기"는 기존 `moa-world/map` 한 장 형식이다.
- **가져오기**: 대시보드에서는 새 스페이스가 되고, 에디터에서는 페이지로 추가된다. 맵 id 는 새로 매기고 포털 `targetMapId` 도 같이 바꾼다. 번들 밖 페이지로 가는 포털은 정리하고 경고한다.
- **공방 에셋을 쓴 맵**:
  - `doc.assets` 에 동작 정보(이름·분류·점유 칸·충돌·높이·그림 URL)를 내장한다. 그래서 맵만 옮겨도 검증과 충돌이 유지된다.
  - 그림 URL 은 원래 서버의 권한 확인 경로(`/api/workshop/files/...`)다. 다른 서버로 옮기면 파일 이관 전까지 도형으로 표시된다.
- 스키마: `lib/world/types.ts`, 검증: `lib/world/io.ts`, `lib/world/validate.ts`, `lib/world/bundle.ts`.

## 2. 내장 에셋 (앱 번들)

- 원본: `design/assets/v2`, `design/assets/v3` (PNG + `manifest.json` 정확한 rect).
- 앱용: `node scripts/build-atlas.mjs` → `public/assets/atlas/*.webp + *.json`. 프레임 이름은 manifest 이름 그대로다.
- 카탈로그: `lib/world/catalog.ts`
  - 시점별 렌더 후보(`render.td/iso`), 방향 수(`orients`), 크기 배율(`V2_FRAMES`).
  - 동작(충돌·크기·높이·상호작용)은 그림과 분리되어 있다.
- 생성 프롬프트: 원본 시트는 `design/assets/*/prompts.json`(Codex), 공방 생성은 `lib/server/workshop/prompts.ts`.

## 3. 서버 저장소 (공방)

| 경계 | 현재 (Sites/Workers) | 교체 방법 |
|---|---|---|
| 구조 데이터 | D1 (`hosting.json` d1=`DB`), 스키마 `db/schema.ts`, 마이그레이션 `drizzle/*.sql` | `lib/server/workshop/store.ts` 의 `Store` 인터페이스 구현을 SQLite/Postgres 로 작성 (원자 연산: `beginGeneration`, `completeGeneration`, `saveLibrary` 는 트랜잭션 필수) |
| 파일 | R2 (`BUCKET`), 키 `cls/<학급>/req/<요청>/…`, `cls/<학급>/gen/<생성>/…` | `Files` 인터페이스(put/get)를 S3 호환 저장소로 구현 |
| 이미지 생성 | OpenAI Images API (`gpt-image-2.5-flare`, 1024², medium, webp, n=1) | `ImageProvider` 인터페이스 |
| 비용 | 호출별 usage 즉시 저장 + 완료 시 요금표 고정(`lib/server/workshop/pricing.ts`) | 요금표는 `OPENAI_IMAGE_PRICING` 로 덮어쓰기 |

- 로컬 D1 마이그레이션은 README "Local D1 migrations" 명령으로 적용한다. 요청 처리 중에 DDL 을 실행하지 않는다.
- 학생 그림과 생성 결과는 공개 Git 에 올리지 않는다. 서버 export 는 후속 과제다(R2 키 목록 + D1 `library_assets.manifest`).

## 4. 인증·권한

- 교사: Sites 로그인(SIWC) 신원 + 서버 허용 목록 `TEACHER_ALLOWLIST`(fail-closed). 다른 호스팅으로 옮기면 SIWC 대신 쓸 OIDC 신원을 `siwcIdentity()` 자리에 연결한다.
- 학생: 학급 초대 토큰(해시 저장) + 별명 + 개인 PIN(PBKDF2-SHA256 10만 회, 솔트) → HttpOnly·Secure·SameSite=Lax 세션 쿠키(해시 저장, 14일).
- 비용이 드는 API(`/api/agent`, `/api/workshop/assist`, 생성)는 허용 교사 또는 허용 교사 학급 학생만 쓸 수 있다.

## 5. 환경 변수 (`.env.example`, 값은 `.dev.vars`·호스팅 시크릿에만)

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_PRICING`, `TEACHER_ALLOWLIST`
