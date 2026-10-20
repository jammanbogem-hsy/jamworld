# 모아 월드 — Codex 제작 에셋

## 현재 적용: v2 만화체 / 두 시점

2026-10-20 사용자 피드백으로 아래 v1 그림을 교체했다. 내장 ImageGen으로 새 원본을 제작하고, 같은 물체를 시점별로 다시 그렸다.

- 원본: `assets/v2/td-{nature,furniture,building,avatar}.png`, `assets/v2/iso-{nature,furniture,building,avatar}.png`
- 소품 27종에 방향 대안을 포함해 시점별 36프레임, 캐릭터는 시점별 16프레임. 총 8시트, 104프레임.
- 짙은 남색 외곽선, 선명한 녹색·청록·코랄·금색, 단순한 셀 채색으로 통일했다.
- 탑뷰는 축이 반듯한 높은 직교 시점, 아이소는 2:1 마름모 격자용 시점이다.
- 아이소 돌담·울타리·퀴즈판·안내판과 탑뷰 집의 회전 방향은 추가 생성으로 교정했다.
- 실제 원본은 탑뷰/캐릭터 1254×1254, 아이소 소품 1448×1086이다. 생성 시트의 간격이 불균일하므로 균등 분할하지 않는다.
- `assets/v2/manifest.json`의 실제 소스 영역 104개를 사용해 자른다. 아바타는 동일 크기와 발 기준점을 유지한다.
- 전체 생성·교정 프롬프트: `assets/v2/prompts.json`. 사용 도구는 내장 ImageGen이며 Tripo를 호출하지 않았다.
- 바닥 9종은 새 색과 단순한 패턴을 코드로 그려 두 투영에 맞춘다. 검은 선을 모든 바닥 칸에 반복하지 않는다.
- 상세 디자인 규격: `DUAL_VIEW_V2.md`.

## v1 기록 (이전 원본)

2026-10-20. 두 이미지 모두 Codex 내장 ImageGen으로 새로 제작했다. Tripo는 호출하지 않았다.

## 소품

- 원본: `assets/moa-props-atlas.png`
- 실제 크기: 1254×1254, 알파 채널 포함.
- 4열×4행. 행 우선 순서:
  - tree, bush, rocks, bench
  - sign, portal, desk, chair
  - bookshelf, lamp, fountain, flowerpot
  - wall, crate, mushrooms, flag
- 요청 규격은 1024×1024였지만 실제 생성 크기는 1254×1254이므로 실제 이미지 크기로 셀 경계를 계산한다.
- 구현 시 셀별 알파 경계를 초기 처리 단계에서 한 번 계산하고 바닥 중앙을 기준점으로 사용한다.
- 그림의 입체감과 상단 좌측 광원을 활용한다. 매 프레임 실시간 조명 계산은 불필요하다.

## 아바타

- 원본: `assets/moa-avatar-atlas.png`
- 실제 크기: 1254×1254, 알파 채널 포함.
- 4열×4행. 행은 정면(남), 왼쪽(서), 뒷면(북), 오른쪽(동).
- 각 행은 대기와 걷기 동작 프레임. 프레임 간 발 기준점과 실루엣 크기를 맞춰 재생한다.
- 청록 후드, 노란 배낭, 크림색 바지, 코랄색 신발의 원본 탐험가 캐릭터.

## 사용 지침

- 배포용 파생본은 알파를 보존하는 WebP로 최적화하고 원본을 보존한다.
- 에셋 로딩 실패 시 단순 도형 대체 표현을 표시한다.
- 캐시 크기에 상한을 둔다. 여러 줌 배율이나 회전별로 무제한 비트맵을 만들지 않는다.
- 이 원본 이미지들은 브롤스타즈 파일에서 추출한 이미지가 아니다.

## 생성 프롬프트 사양

두 프롬프트 공통: `stylized-concept`, production sprite atlas, genuine transparent background, exactly 4 columns by 4 rows, one object per cell, consistent high-angle camera looking down 55 degrees, fixed lighting from upper left, original chunky cartoon toy-like 3D rendered appearance, no labels/grid/logo/background, readable at 64 pixels, generous transparent margins.

소품 프롬프트: 위 소품 순서를 정확히 지정하고, jade/teal foliage, ochre wood, coral accents, rounded bevelled shapes, bottom-center anchors를 요청했다. 나무·포털·가로등·깃대가 셀 밖으로 나오지 않도록 지정했다.

아바타 프롬프트: 동일 캐릭터를 16칸에 유지하고 각 방향에서 idle, left-foot step, passing pose, right-foot step을 요청했다. 짧은 짙은 갈색 머리, 따뜻한 중간 피부색, 청록 후드, 노란 배낭, 크림 바지, 코랄 운동화를 지정했다. 뒷면에 얼굴이 나타나지 않도록 명시했다.
