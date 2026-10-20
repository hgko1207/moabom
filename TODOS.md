# TODOS

## Collections

### 학습 먼저 규칙(prereq) + 오락 컬렉션

**What:** profiles.json에 `prereq`를 다시 넣고(예: 넘버블럭스를 오늘 2편 보면 헬로카봇이 열림), 헬로카봇·포켓몬스터·똥탐정의 공식 채널을 검증해 컬렉션으로 추가한다.

**Why:** 설계 전제 1에서 핵심 가치로 꼽은 "학습 먼저" 규칙이 v1에는 없다(eng review R9에서 v1 스키마에서 제거).

**Context:** `today.started`가 영상 ID 목록이라 컬렉션별 오늘 편수를 구할 수 있다. 설계 문서의 prereq 예시는 `{ "unlock": "hellocarbot", "after": { "collection": "numberblocks", "episodesToday": 2 } }`. 공식 채널이 확인되지 않는 컬렉션은 추가하지 않는다(비공식 채널로 대체 금지).

**Effort:** M
**Priority:** P2
**Depends on:** v1 안정화, 각 컬렉션 공식 채널 확인

## Progress

### 진도 옮기기 (폰 ↔ 태블릿)

**What:** 한 기기의 진도(✔)를 코드나 링크로 다른 기기에 옮긴다(설계 문서 규칙 X1~X4).

**Why:** v1 진도는 기기별이라, 같은 아이가 두 기기를 쓰면 "다음 볼 영상(▶)"이 기기마다 다르다.

**Context:** eng review D2에서 v1.1로 미뤘다(decision e4ae488d). 저장 키가 `moabom:v1:`로 버전이 붙어 있어 나중에 붙여도 데이터가 깨지지 않는다. iOS 홈 화면 앱은 Safari와 저장소를 따로 쓰므로 붙여넣기 경로가 필요하다(X3).

**Effort:** M
**Priority:** P3
**Depends on:** 실사용에서 같은 아이가 두 기기를 쓰는 것이 확인될 때

## Player

### strictPlayer (클릭 차단 레이어)

**What:** 프로필 옵션 `strictPlayer`를 켜면 플레이어 위에 클릭 차단 레이어와 자체 재생/일시정지 버튼을 둔다.

**Why:** 다른 영상 감지(P2)가 안 되거나 아이가 유튜브 로고를 눌러 빠져나가는 경우의 대비책이다.

**Context:** "너무 키즈용"이라는 판단으로 v1에서 뺐다. 프로필 옵션이라 주제 중립 구조는 유지된다. 플레이어를 가리는 것은 YouTube 약관상 회색지대이므로 가족용 범위에서만 쓴다.

**Effort:** M
**Priority:** P3
**Depends on:** M4/M5 실기기 관찰에서 이탈이 실제로 보일 때

### 실제 화수 라벨 (컬렉션별 제목 패턴)

**What:** 컬렉션 설정에 선택 항목 `episodeLabel: { pattern, format }`을 두고, fetch 때 원제목에서 실제 화수를 뽑아 카드 라벨로 쓴다(맞지 않으면 지금처럼 "{그룹} {순서}화").

**Why:** 2단계 라벨은 그룹 이름 + 순서라(phase-2 eng review D3, decision d8077efe), 넘버블록스는 실제 16화가 "2단계 1화"로, 옥토넛은 더블 에피소드 때문에 한 편씩 밀린 번호로 나온다.

**Context:** 제목 형식 예: 넘버블록스 "16. 전체 에피소드"(`^(\d+)` → "{1}화"), 옥토넛 "시즌2 에피소드3"(`시즌\s*(\d+)\s*에피소드\s*0*(\d+)` → "시즌 {1}·{2}화"), 알파블록스·컬러블록스 "S1 E2"는 지금 방식과 같음, 블루이·깨비키즈는 번호 없음. 코드의 `gstack-shortcut(dec-d8077efe)` 표시가 바꿀 곳이다. 설정 검증이 잘못된 정규식을 막고, `/add-character`에 패턴 적기 단계를 넣는다.

**Effort:** S
**Priority:** P3
**Depends on:** 부모가 라벨이 실제 화수와 다르다고 할 때

### 자막 버튼

**What:** 재생 화면 버튼 줄에 "자막"을 더한다(다른 버튼처럼 기본 꺼짐, 기기 설정에서 켬).

**Why:** 2단계 계획(P2-1)에 있었지만 2026-10-20에 뺐다. YouTube 플레이어 안의 CC 버튼으로 이미 켤 수 있고, 앱에서 켜는 방법(`loadModule('captions')`, `setOption('captions','track',…)`)은 공식 문서에 없어 기기마다 확인이 필요하다.

**Context:** 만들 때: fetch에서 videos.list `contentDetails.caption`을 `hasCaptions`로 저장해 자막 없는 영상에서는 버튼을 숨긴다. iPad Safari·안드로이드 Chrome에서 모듈 방식이 되는지 먼저 확인하고, 안 되면 `cc_load_policy`로 플레이어를 현재 시각에서 다시 만든다(같은 편이라 편수에 새로 세지 않음, 다른 영상 감지는 첫 재생까지 쉼). 구현 흔적은 git 05aa844(Wire phase 2 …)에 있다.

**Effort:** S
**Priority:** P3
**Depends on:** 부모나 아이가 CC 버튼을 찾기 어렵다고 할 때

## Devices

### TV 대응

**What:** TV 브라우저(삼성·LG·안드로이드TV)에서 방향키와 Enter만으로 전체를 조작하고, 큰 포커스 테두리와 4~5열 레이아웃을 쓴다.

**Why:** 원래 명세의 수용 기준("TV 리모컨 방향키만으로 전체 조작 가능")인데 v1 범위(태블릿 + 폰)에서 제외됐다.

**Context:** TV 브라우저별 iframe 호환성은 확인되지 않았다. v1의 `fs=0` + CSS "크게 보기" 결정이 TV에서도 통하는지 확인해야 한다.

**Effort:** L
**Priority:** P3
**Depends on:** v1 태블릿·폰 안정화, 집 TV 실기기

## Testing

### 화면 회귀 자동 테스트 (jsdom)

**What:** jsdom을 개발 의존성으로 넣고, 홈·설정·기록 화면을 그려 버튼을 누른 뒤 저장값과 이동을 확인하는 vitest 화면 테스트를 만든다.

**Why:** 지금 테스트는 순수 함수만 본다. 화면 코드를 옮기면(1단계 설정·홈, 2단계 컬렉션·플레이어) 버튼 연결이 빠져도 `npm test`와 타입 검사가 잡지 못한다.

**Context:** 2026-10-18 eng review D7에서 1단계는 헤드리스 브라우저 점검(분리 전후 `npm run build && npm run preview`, 목록은 docs/designs/moabom-launch-ready.md의 R5)을 골랐다. 그 목록을 그대로 자동 테스트의 기대값으로 옮기면 된다. YouTube IFrame과 localStorage는 테스트용 대체물이 필요하다(storage.test.ts의 mapKV 참고).

**Effort:** M
**Priority:** P3
**Depends on:** 헤드리스 점검을 3번 돌렸거나, 화면 회귀가 배포까지 나갔을 때 시작

## Completed
