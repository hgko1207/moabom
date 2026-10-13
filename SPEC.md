# 모아봄 (moabom) — 개발 명세 v4

> 골라 담은 영상만, 모아서 봄.
> 변경 이력: v1 넘버블록스 단일 → v2 여러 시리즈 → v3 이름 확정, 컬렉션 구조 → **v4 부모 큐레이션(영상 ID 목록), 설계·엔지니어링·디자인 리뷰 반영 (2026-10-12)**

## 0. 한 줄 요약
부모가 고른 공식 채널 영상 목록을 순서 그대로 아이의 학습 경로로 보여주는 정적 웹앱. 앱 안에서만 재생하고, 하루 분량을 편 경계에서 지키며, 유튜브 추천으로 빠지지 않게 한다. 구조는 주제 중립(강의·설교·튜토리얼도 같은 방식).

## 1. 이름 규칙
- 표시명 **모아봄**, 저장소·패키지 `moabom`, 배포 https://moabom.hgko.dev (GitHub Pages 사용자 지정 도메인, 2026-10-13부터. 예전 주소 hgko1207.github.io/moabom 은 GitHub가 새 주소로 넘겨 줌)
- 묶음 단위는 **컬렉션(collection)**. "시리즈" 금지.
- 저장소는 **공개**. `profiles.json`의 이름은 **별칭만**(실명 금지).

## 2. 사용자 / 기기 (v1)
- 아이 둘(6세, 4세)이 거의 함께 봄 → v1은 공용 프로필 하나. 관리자는 부모. 4세는 글을 못 읽음.
- v1 기기: **태블릿 + 폰**. TV는 TODOS.md.
- v1 컬렉션: **넘버블록스 한국어 공식 채널 하나** (`@numberblocks_kr`, `UCR9zv3dquE6GURdKGJkVz-g`, 2026-10-12 사용자 확정). 1~90화와 S5 E01~30이 약 5분짜리 개별 영상으로 있음(최근 업로드는 1시간 모음집과 Shorts 위주).

## 3. 핵심 원칙
1. 영상은 앱 안에서 임베드 재생. 유튜브 앱·사이트로 이동시키지 않음.
2. 글 없이 쓸 수 있게: 썸네일·숫자·아이콘 우선, 글자는 부모용 보조.
3. 공식 채널 화이트리스트에 없는 영상은 수집 단계에서 0건.
4. 이미지는 `i.ytimg.com` 썸네일과 Lucide 아이콘만. 캐릭터를 그리거나 생성하지 않음. 이모지를 디자인 요소로 쓰지 않음.
5. API 키는 클라이언트에 절대 노출하지 않음(`.env`, GitHub Secrets).
6. 새 컬렉션 = 설정 파일 1개(+ draft-groups로 초안) + fetch. 코드 수정 0줄.
7. 특정 컬렉션·주제를 코드에 하드코딩하지 않음.

## 4. 기술 스택과 파일 구성
- Vite + TypeScript(vanilla), GitHub Pages, vitest. 스크립트는 Node 24로 `.ts`를 직접 실행(추가 런타임 없음).
- YouTube Data API v3는 Node 기본 `fetch`로 호출(googleapis 의존성 없음).

```
config/collections/{id}.json   컬렉션 설정
config/profiles.json           프로필·제한 (모든 기기 공통)
data/collections/{id}/videos.json  fetch 결과 (커밋됨)
scripts/fetch.ts               find-channel / fetch 명령, 필터·안전장치(순수 함수)
scripts/youtube.ts             YouTube Data API 클라이언트
src/config.ts                  설정 타입과 검증 (앱·스크립트 공용)
src/rules.ts                   제한·진도·다음 화 규칙 (순수 함수)
src/storage.ts                 localStorage 래퍼 (try/catch)
src/player.ts                  IFrame Player 래퍼
src/main.ts                    화면 + 해시 라우팅
src/icons.ts, src/styles.css   아이콘·디자인 토큰
.github/workflows/pages.yml    push·주간 cron·수동 실행 하나로 배포
```

## 5. 컬렉션 설정 `config/collections/{id}.json`
```json
{
  "id": "numberblocks",
  "displayName": "넘버블록스",
  "enabled": true,
  "channels": ["UCR9zv3dquE6GURdKGJkVz-g"],
  "coverVideoId": null,
  "groupLabel": "단계",
  "groups": [
    { "id": "lv1", "label": "1단계", "playlistId": "PL…" }
  ],
  "excludeShorts": false,
  "titleExcludePatterns": [],
  "titleStripPatterns": ["^\\s*\\|\\s*", "\\s*\\|.*$", "^\\d+\\.?\\s+", "\\s*#shorts\\b"]
}
```
- 그룹마다 영상 출처는 둘 중 하나: `videos`(영상 ID 배열, 배열 순서 = 시청 순서) 또는 `playlistId`(재생목록 순서). 그룹 순서는 배열 순서.
- **아동용(made for kids) 영상은 유튜브에서 "재생목록에 저장"이 막혀 있다**(COPPA). 넘버블록스 한국 공식 채널은 전 영상이 아동용이므로 `videos`를 쓴다. `playlistId`는 아동용이 아닌 컬렉션(강의 등)용.
- `videos` 초안은 `npm run draft-groups`로 만들고 부모가 확인한 뒤 설정에 넣는다(아래 §7).
- `excludeShorts`를 켜면 180초 이하를 제외하고 경고 로그를 남김(기본 false).
- `titleStripPatterns`로 원제목에서 접두어·접미어를 지워 `displayTitle`을 만듦.
- `id`는 `^[a-z0-9-]+$`. 채널이 비어 있으면 fetch를 거부.

### 5-1. 단계 종류와 자동 단계 (2026-10-12 추가)
- `kind`: `"series"`(기본, 정식 편: "오늘 볼 영상"·✔ 진행·다음 화가 이 순서를 따름) 또는 `"free"`(모음집·클립: 탭에서 자유롭게 고르고, 다음 화는 같은 탭 안에서만).
- 영상 출처 세 번째: `uploads: { minSec, maxSec, latest, titlePattern }` — 화이트리스트 채널 업로드(최신순)에서 조건으로 고르고 최신 N개만. 매주 갱신 때 새 영상이 자동으로 들어옴. 예: 넘버블록스 `모음집` = `{ minSec: 901, latest: 30 }`.
- 현재 컬렉션: 넘버블록스(1~5단계 + 모음집 30), 블루이(`@blueykr`: 에피소드 공식 재생목록 + 긴 모음 `uploads ≥30분` + 최고의 순간 공식 재생목록), 알파블록스(`@officialalphablocks`, 영어: 시즌 1~6 공식 재생목록 + 30·45·60분 모음 공식 재생목록). 블루이 정식 편은 한국 유튜브에 약 16편뿐(전체는 디즈니+).

## 6. 프로필 설정 `config/profiles.json`
```json
{
  "profiles": [
    { "id": "home", "name": "우리집", "color": "#4C8BF5", "collections": ["numberblocks"],
      "dailyEpisodes": 3, "dailyMinutes": null }
  ]
}
```
- v1은 **공용 프로필 하나**(두 아이가 거의 같이 봄, 2026-10-12 결정). 프로필이 하나면 프로필 화면을 건너뛴다. 코드는 여러 프로필을 계속 지원하므로 나중에 설정만 추가하면 된다. `startGroup`(선택)도 그대로 지원.
- `dailyEpisodes`와 `dailyMinutes`가 둘 다 null이면 무제한(현재 기본값).
- **기기 설정이 우선**(2026-10-12): 컬렉션 선택 화면의 톱니바퀴를 2초 누르면 설정 화면. 하루 제한 없음 / 하루 N분(10~240, 10분 단위) / 하루 N편(1~20), "오늘 기록 초기화". 이 기기의 localStorage(`moabom:v1:device:settings`)에만 저장.
- `prereq`는 v1 스키마에 없음. 있으면 검증 오류("v1.1 기능").
- 알 수 없는 컬렉션 ID를 참조하면 검증 오류.

## 7. 데이터 수집 (`npm run find-channel`, `npm run draft-groups`, `npm run fetch`)
1. `npm run find-channel -- "넘버블록스"`: 채널 후보(ID, 제목, 구독자 수, 영상 수, 링크)를 출력만 함. 설정에 쓰는 것은 사람이 확인한 뒤.
2. `npm run draft-groups -- --collection numberblocks --ranges 1-15,16-30 [--pattern "S5 E(\d+)"]`: 화이트리스트 채널의 업로드에서 제목의 편 번호로 그룹 초안(`data/collections/{id}/draft-groups.json`, git 제외)을 만든다. 중복 업로드는 최신 것을 고르고 나머지는 대안으로, 빠진 번호는 따로 보고한다. 업로드 목록에 없는 일부 공개 영상은 잡히지 않으므로 공식 재생목록과 대조한다.
3. `npm run fetch -- --collection numberblocks` / `--all` / `--force`
   - 그룹마다 `videos` 또는 `playlistItems.list`(50개씩 페이지) → `videos.list`(50개 배치)
   - 제외: 화이트리스트 밖 채널(경고), `embeddable=false`, 비공개, 응답에 없는 ID(삭제), Shorts(설정 시), `titleExcludePatterns`
   - **캐시 없음**: 매 실행 전체 조회(API 30일 갱신 정책을 자동으로 지킴, 쿼터 주당 수십 유닛)
   - **안전장치(F3)**: API 오류·재생목록 조회 실패가 하나라도 있으면 파일을 쓰지 않고 exit 1. 그룹이 0건이 되거나 직전보다 50% 넘게 줄면 `--force` 없이는 실패. 직전 데이터가 없는 첫 실행은 비교 생략.
   - 출력 `data/collections/{id}/videos.json`: `{ collectionId, fetchedAt, groups: [{ id, videos: [...] }] }`
4. 영상 레코드: `{ id, title, displayTitle, durationSec, channelId, group, order }`
5. 썸네일 `https://i.ytimg.com/vi/{id}/hqdefault.jpg`

## 8. 규칙 (src/rules.ts, 단위 테스트 대상)
### 하루 제한 (L)
- **L1** 한 영상이 **그날** PLAYING 상태로 10초를 넘기면 그날의 `started`에 추가(같은 날 재시청은 다시 세지 않음).
- **L2** `seconds`는 실제 재생 시간(1초 폴링).
- **L3** 새 편을 시작할 때 `started.length >= dailyEpisodes` 또는 `seconds >= dailyMinutes*60`이면 막음. 재생 중인 편은 끝까지.
- **L3a** 제한 도달 후에는 오늘 마지막으로 시작한 편이 **아직 완료되지 않았을 때만** 다시 열 수 있음.
- **L4** 제한은 기기당(서버 없음).
- **L6** (2026-10-12) 15분이 넘는 영상은 하루 제한에 닿으면 그 자리에서 멈추고 달 화면으로. 그 영상은 오늘 다시 열 수 없고(`today.stopped`), 다음 날 멈춘 자리부터 이어 봄.
- **O5** (2026-10-12) 모든 영상의 마지막 재생 위치를 저장(`position`)하고 다시 열면 그 자리부터(처음 5초·끝 15초 근처, 다 본 영상은 처음부터). 끝까지 보면 위치를 지움.
- **L5** 한 기기에서는 하루에 한 프로필만(그날 처음 고른 프로필). `?profile=p2`를 한 번 열면 그 기기를 해당 프로필에 고정.

### 진도·순서 (O)
- **O1** 누적 재생 시간 ≥ 길이의 90%면 `watched`. `progress`는 재생 중 매초 저장(localStorage 쓰기 1회/초), 완료 시 삭제. 이미 본 영상을 다시 보면 기록하지 않음.
- **O2** 순서는 권장. 모든 탭·카드를 누를 수 있음.
- **O3** 다음 볼 영상 = `startGroup`(기본 첫 그룹)부터 그룹 순서 → 재생목록 순서로 첫 미시청 영상. 이후를 다 봤으면 첫 그룹부터 다시. 이 기기에서 재생 오류가 난 영상은 건너뜀.
- **O3a** 처음 여는 탭 = 다음 볼 영상이 있는 그룹(없으면 `last`의 그룹, 그것도 없으면 startGroup).

### 플레이어 (P)
- **P1** `youtube.com` 임베드(2026-10-12 변경: nocookie 모드는 로그인 쿠키를 쓰지 않아 유튜브 프리미엄이 인식되지 않고 광고가 나옴. 기기의 Chrome에서 프리미엄 계정으로 유튜브에 로그인해 두면 설치 앱도 같은 로그인을 씀), `rel=0`, `playsinline=1`, **`fs=0`**. "크게 보기" = 앱의 무대 요소를 실제 전체 화면으로 + 가로 고정(안드로이드). 오버레이는 무대 안에 있어 전체 화면에서도 보임. iPhone은 요소 전체 화면이 없어 CSS 방식.
- **P2** 1초마다 `getVideoUrl()`의 v 값을 확인(보조: `getVideoData`). 다르면 `stopVideo()` 후 이어보기 오버레이. 앱이 다음 화를 로드할 때는 expectedId를 먼저 바꾸고 첫 PLAYING까지 비교 생략. 감지 불가면 console.warn + 작은 "감지 꺼짐" 표시.
- **P3** 남은 20초에 "다음 화" 카드(재생 순서상 바로 다음 편). 이번 편으로 제한 도달(편수, 또는 `seconds + 남은 길이 >= 분 제한`)이면 달 표시. 그룹 끝이면 다음 그룹 첫 편, 컬렉션 끝이면 다 봤어요. 자동 재생 없음. 카드를 누르면 즉시 다음 편.
- **P4** onError(2/5/100/101/150)면 즉시 앱 화면으로 덮고 편수·진도에 기록하지 않음. 그 영상은 `failed`에 기록.

### 저장 키 (localStorage, 모두 try/catch)
- `moabom:v1:{profileId}:{collectionId}` → `{ watched: {id: ts}, progress: {id: sec}, failed: {id: ts}, last }`
- `moabom:v1:{profileId}:today` → `{ date, started: [id], finished: [id], playedToday: {id: sec}, seconds }`
- `moabom:v1:device:today` → `{ date, profileId }`, `moabom:v1:device:pinned` → `profileId`

## 9. 화면
1. **프로필 선택**: 색 원 + 별칭. 오늘 이 기기에서 이미 다른 프로필을 썼다면 나머지는 흐리게(L5). 고정된 기기는 건너뜀.
2. **컬렉션 선택**: 허용 컬렉션이 1개면 건너뜀.
3. **컬렉션 화면**: 맨 위에 "오늘 볼 영상" 큰 카드(2배 크기, 프로필 색 테두리). 그 아래 그룹 탭(그룹 첫 영상 썸네일 + 큰 숫자, 글자 라벨은 작게). 카드 = 썸네일 + 왼쪽 위 편 번호 배지 + 오른쪽 아래 길이 + displayTitle 2줄. 본 영상 ✔, 실패 영상 ⚠ + 흐림, 제한 도달 시 달 + 흐림. 현재 탭만 렌더하고 `loading="lazy"`.
4. **플레이어**: 세로 = 영상 맨 위 + 그 아래 "다음 화" 자리, 가로 = 영상이 높이를 채우고 카드는 우하단 폭 30%(최소 220px).
5. **오늘은 여기까지**: 어두운 배경, 큰 달, 오늘 본 편 ✔ 줄, 내일 볼 편 + 자물쇠. 출구는 ◀ 하나.
6. **다 봤어요**: 큰 카드 자리에 ✔ 배지 + 첫 편 썸네일 + ↻(처음부터).
- 상태: 설정과 videos.json은 빌드에 포함되므로 목록 로딩·실패 상태는 없음. 썸네일 실패(오프라인 오류 또는 유튜브의 120×90 회색 대체 이미지) = 프로필 색 + 큰 편 번호, 오프라인 = 와이파이 끊김 아이콘 + ↻(online 이벤트 시 다시 그림). 서비스 워커 캐시 없음.
- 길찾기: 모든 화면 왼쪽 위 64px ◀. 해시 라우팅 `#/p/{pid}`, `#/p/{pid}/c/{cid}`, `#/p/{pid}/c/{cid}/v/{vid}`.
- 데이터가 30일보다 오래되면 첫 화면 구석에 "데이터 갱신 필요".

## 10. 디자인 토큰 (`src/styles.css` :root)
- 글꼴 Pretendard(자체 호스팅). 본문 최소 18px, 카드 제목 18/24 600, 탭 숫자 32 700, 화면 제목 28 700.
- 색 `--bg #F4F6FA`, `--surface #FFFFFF`, `--ink #1B2230`, `--ink-2 #4A5568`, `--done #1F9D55`, `--night #1E2340`, `--night-ink #E8EAF6`. 강조색은 프로필 색 하나(테두리·채움에만, 본문 글자색 금지).
- 간격 8의 배수, 카드 사이 16px, 모서리 12px(알약형 금지), 그림자 없음, 포커스 링 4px 프로필 색.
- 모션 두 가지: 누름 scale 0.97 100ms, 20초 카드 등장 200ms ease-out. `prefers-reduced-motion`이면 끔.
- 아이콘 Lucide(ISC) 10개 인라인: chevron-left, play, maximize, check, moon, lock, rotate-ccw, wifi-off, unplug, triangle-alert.
- 접근성: 모든 조작은 `<button>` + 한국어 `aria-label`, 랜드마크, 그리드 방향키(roving tabindex), 대비 4.5:1, 터치 타깃 64px.

## 11. 배포
- `pages.yml` 하나: push → test → build → deploy. 주간 cron·수동 실행이면 앞에 fetch → 커밋(`pull --rebase`) 단계 추가. `concurrency: pages`. 수동 실행에 `force` 입력.
- 홈 화면 추가용 `manifest.webmanifest`.
- 설치 안내 (`#/p/{pid}/install`, 설정과 홈 화면 아래 닫을 수 있는 카드에서 진입, 앱으로 열렸으면 숨김). Android Chrome은 `beforeinstallprompt`를 index.html에서 미리 잡아 [앱 설치] 한 번 누르기, 그 밖에는 기기별 순서 안내. Chrome 150(2026-07)부터 메뉴 이름이 "홈 화면에 추가" → "설치 및 바로가기 만들기"로 바뀌어 두 이름을 모두 적는다.

## 12. 마일스톤
1. **M1 구조 + 수집**: 저장소, 설정 스키마·검증, find-channel·fetch, 테스트.
2. **M2 그룹 구성** (완료 2026-10-12): 공식 채널 확정, draft-groups로 5단계 초안(1~15·16~30·31~60·61~90화·시즌5, 원작 시리즈 순서 기준) → 부모 확인(21화 교체, 시즌5 28화 수동 추가) → fetch 120편.
3. **M3 UI** (완료 2026-10-12): 화면 1~3, 6, 토큰·아이콘(Lucide, ISC), Pretendard, 반응형, 접근성(방향키 그리드), 해시 라우팅. 영상 화면은 M4 전까지 자리표시.
4. **M4 플레이어** (코드 완료 2026-10-12, 실기기 확인 남음): P1~P4, 규칙 L/O, 화면 4·5. 헤드리스 브라우저로 재생·편수 산입·20초 카드·끝 오버레이·다른 영상 감지(iframe에 다른 영상 강제 로드)·하루 제한·밤 화면 확인. 완료 조건: 태블릿·폰 실기기에서 일시정지 더보기·관련 영상 클릭 시 1~2초 안에 멈추고 이어보기 오버레이.
5. **M5 배포** (배포 완료 2026-10-12, 실기기 관찰 남음): https://hgko1207.github.io/moabom/ . pages.yml push 배포와 수동 갱신(fetch → 봇 커밋 → 배포) 모두 성공, Secret `YOUTUBE_API_KEY` 등록, manifest·아이콘. 남은 일: 실기기 30분 관찰 → strictPlayer 필요 여부 판단.

## 13. 수용 기준
- 4세가 글 없이 프로필 → 오늘 볼 영상 → 재생까지 혼자 한다.
- 태블릿·폰에서 3편 연속 시청 중 유튜브 앱·사이트로 넘어가지 않는다.
- 한 기기에서 dailyEpisodes 도달 시 다음 편이 막히고 보던 편은 끝까지 재생된다. 형제 프로필로 우회할 수 없다.
- 새 컬렉션 = 설정 1개 + fetch, 코드 수정 0줄.
- `dist`에서 API 키 문자열이 검색되지 않는다. 화이트리스트 밖 채널 영상 0건.

## 14. 범위 밖 (TODOS.md)
진도 옮기기(기기 간), strictPlayer, 학습 먼저 규칙(prereq) + 오락 컬렉션, TV 대응, 오프라인 캐시.

## 15. 작업 원칙 (Claude Code)
- 마일스톤이 끝날 때마다 결과와 확인 필요 사항을 보고하고 멈춘다.
- 채널 ID처럼 확실하지 않은 값은 추측하지 말고 후보를 보여준 뒤 확인을 받는다.
- 공식 채널이 아닌 영상은 어떤 경우에도 포함하지 않는다.
- 상세 근거: `~/.gstack/projects/moa-bom/khkkh-unknown-design-20261009-180406.md` (결정 기록 D/R 번호).
