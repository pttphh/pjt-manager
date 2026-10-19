# CLAUDE.md — 프로젝트 관리 툴 v2

이 문서는 Claude Code 세션의 고정 기준이다. 매 세션 맥락을 재추측하지 말고 이 문서를 따른다.
상세 요구사항은 `prd-v2.md`, DB는 `schema-v2.sql` 참조 (둘 다 프로젝트 루트에 있음).

## 한 줄 정의
경영자와 소수 팀원용 PC 전용 업무 관리 웹앱. PJT → Tasks → Todo 3계층, **Todo 단위 배포**(draft→published) → **완료**(done) 흐름. 진행사항 메모는 사이드바 **'업데이트'**에서 확인한다(확인은 상태가 아님).

## 기술 스택
Vite + React 18 + TypeScript + Tailwind CSS v3 / Supabase (anon key, RLS 없음) / React Router v6 / Vercel

## 인증 (Supabase Auth 사용 금지)
- `/`에서 비밀번호 입력 → `VITE_APP_PASSWORD` 비교 → sessionStorage `authenticated='true'`
- ProtectedRoute: sessionStorage 확인, 없으면 `/`로 리다이렉트
- 역할/계정 없음. 전원 동일 권한.

## 환경변수 (.env.local — git에 올리지 않는다)
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_APP_PASSWORD=
```

## 라우팅
```
/              PasswordPage
/main          MainPage (Layout, 3탭: Todo체크 | 배포 | PJT관리)
/project/:id   ProjectDetailPage (Layout)
/settings      SettingsPage (Layout, 3탭: 구분 | 태그 | 멤버 — 목록·수정·삭제·추가. 비밀번호 변경 없음)
```

## 파일 구조
```
src/
  components/
    layout/   Sidebar.tsx([나의 할 일 | 업데이트] 버튼 전환 — 규칙12. 드래그 리사이즈 220~400px, 폭·탭 localStorage)
              Layout.tsx  ProtectedRoute.tsx
    ui/       Badge.tsx Button.tsx Modal.tsx TagInput.tsx
              ItemManager.tsx  -- 구분·태그·멤버 목록/수정/삭제/추가 공용 (설정 3탭 + ⚙ 팝업)
              InlineManage.tsx -- ItemManager를 감싼 ⚙ 인라인 팝업 껍데기
    task/     TaskModal.tsx          -- **좌측** 사이드 패널(drawer). ≥lg 폭 = 화면 왼쪽 끝 ~ 세부화면 Tasks 칸 오른쪽 끝(`widthPx` prop, zoom 보정한 CSS px) — 사이드바와 Tasks 칸은 덮되 **우측 Todo 는 가리지 않는다**, 최소 500px. 분할·좁은 화면(<lg)에선 전체화면(w-full). 바깥클릭 닫힘 없음(dirty면 확인창), X·취소만. decisions Ctrl+B 볼드
    project/  ProjectFormModal.tsx   -- PJT 등록/편집 (⚙ 인라인 구분·태그 관리 포함)
  pages/      PasswordPage.tsx MainPage.tsx ProjectDetailPage.tsx SettingsPage.tsx
  tabs/       TodoCheckTab.tsx TaskDeployTab.tsx ProjectManageTab.tsx
  lib/        supabase.ts
              updates.ts  -- '업데이트' 판정(hasUnreviewedUpdate)·확인(markReviewed) 단일 소스. 사이드바·Todo 체크 탭 공용
              url.ts      -- toHref (PJT·Task 링크 공용)
  types/      index.ts
```

## 핵심 타입
```ts
export type ProjectStatus = 'pending' | 'active' | 'hold' | 'done'
// 배포는 Todo 단위: draft(미배포) → published(배포/진행) → done(완료)
// 'checked' 상태는 폐지(migrations/011). 진행사항 '확인'은 상태가 아니라 reviewed_at 으로 관리한다.
export type TodoStatus = 'draft' | 'published' | 'done'

export interface Division { id: string; name: string; sort_order: number }
export interface Tag { id: string; name: string; sort_order: number }
export interface Person { id: string; name: string }

export interface Project {
  id: string; name: string; description: string | null
  link_urls?: string[] | null         // 관련 온라인 주소 여러 개 (migrations/006), 세부화면 상단에서 각각 새 창으로 열림 (구 단일 link_url=003)
  is_urgent?: boolean; is_important?: boolean  // 긴급/중요 (migrations/007). PJT 관리 카드 이름 앞 아이콘: 긴급🚨 중요💡 둘다🔥
  division_id: string; status: ProjectStatus
  start_date: string | null; due_date: string | null; completed_at: string | null
  divisions?: Division
  project_tags?: { tags: Tag }[]
  project_members?: { people: Person }[]
}
export interface Task {
  id: string; project_id: string; title: string; task_date: string
  decisions: string | null; is_misc: boolean   // 배포 상태 없음 (Todo 단위 배포)
  link_urls?: string[] | null                  // 관련 링크 여러 개 (migrations/009), 세부화면 Tasks 목록에서 ↗로 새 창 열림
  projects?: Project; task_members?: { people: Person }[]; todos?: Todo[]
}
export interface Todo {
  id: string; task_id: string; project_id: string; title: string
  status: TodoStatus; deployed_at?: string | null; sort_order: number
  reviewed_at?: string | null  // 진행사항을 '확인'한 시각 (migrations/011). 최신 메모가 이보다 새것이면 '업데이트'에 뜬다
  done_at?: string | null      // 완료 시각 (migrations/012, **DB 트리거**가 기록·완료 취소 시 null). 012 이전 완료분은 null
  checked_at?: string | null   // @deprecated — 'checked' 상태 폐지로 미사용(migrations/010, 롤백 대비로 컬럼만 남김)
  todo_assignees?: { people: Person }[]; todo_memos?: TodoMemo[]
}
export interface TodoMemo { id: string; todo_id: string; content: string; created_at: string }
```

## 반드시 지킬 도메인 규칙
1. **Todo의 project_id ≠ task의 project_id 가능.** 기본값은 Task의 PJT. 변경 허용 범위 = 동일 구분 + status가 pending/active인 PJT만.
2. **Todo 체크 탭**: **배포된 것만 보인다 — 담당자 무관.** `todos.status = 'published'`만 표시하고 draft(미배포)·done은 제외(migrations/011 적용 전 남은 옛 `checked`는 진행 중으로 함께 표시). **'체크됨' 구간·일괄 완료 버튼은 폐지** — 진행 중 Todo는 한 구간('미진행 Todo')에 모인다. 상태 뱃지는 없앴다(전부 배포 상태라 정보가 없음) — 대신 **확인 안 한 새 진행사항이 있는 Todo에만 '업데이트' 뱃지**(사이드바 '업데이트'와 같은 기준, `lib/updates`). 각 Todo 하단 버튼: **'확인'**(미확인일 때만 — 업데이트 목록에서 빠짐, 상태 불변) / **'완료'**(published→done, 입력 중이던 메모가 있으면 먼저 저장). 상단 컨트롤은 좌→우로 **[보기 기준 토글] → [기간(최근 활동일 때만)] → [구분 드롭박스]**. **정렬 드롭박스는 제거** — Task 작성일 **최신순 고정**(그룹 순서와 그룹 내 Todo 순서 모두), 담당자별의 '미지정' 그룹만 항상 맨 아래. **구분 필터는 드롭박스**(Todo의 project_id → division 기준, '전체' + 구분 목록). **보기 기준** 토글 4종: **[PJT별](기본값 = 이 탭의 메인 화면. Todo의 `project_id` 기준 PJT 단위 아코디언, 메타 `담당: …`)** / [Task별](Task 단위 아코디언, 메타 `담당: …`) / [담당자별](사람 단위 아코디언, 메타 `PJT: …`, 담당자 없으면 '미지정' 그룹) / **[최근 활동]** — '나의 할 일' 보기는 사이드바로 옮겨 삭제됨(규칙12). 구분 필터와 함께 동작.
   - **최근 활동** = 기간 안에 **진행사항 메모가 저장됐거나 완료된** Todo. **이 탭에서 완료분까지 보이는 유일한 보기**(나머지 보기는 published만). 기간 = 시작~종료 날짜 입력, **기본 오늘 포함 10일**, `최근 10일` 버튼으로 복귀. **날짜별 묶음**(`10/19 (월) · n건`), 날짜·행 모두 최신순. **Todo당 1줄** — 기간 안의 마지막 메모 시각과 완료 시각 중 더 최근 것이 활동일, 뱃지 `완료`/`메모`, **미리보기는 기간 안의 마지막 메모**(전체 최신 메모 아님 — 과거 기간을 고르면 달라진다). 메모 '수정'은 활동 아님(작성 시각 불변). **날짜 경계는 로컬(한국) 하루** — 입력 날짜를 로컬 자정 ms 로 바꿔 숫자로 비교(UTC 문자열로 자르면 오전 9시 이전 기록이 전날로 잡힘). **읽기 전용**: 진행 중 행 클릭 → PJT별로 전환해 그 Todo로 이동, 완료 행은 클릭 불가(완료 취소는 세부화면 '완료' 목록). 완료 판정은 `done_at`(migrations/012 트리거) — **012 이전 완료분은 날짜가 없어 제외**(없는 날짜를 지어내지 않음), 012 미적용이면 메모만 보이고 안내 표시.
   - **점프(사이드바·최근 활동 행 클릭)는 항상 PJT별로 전환**한 뒤 대상으로 이동한다 — 다른 보기에선 대상이 화면에 없을 수 있다. 완료돼서 이 탭에 없는 Todo면 요청만 정리. 미진행 Todo는 진행사항 메모 입력칸 **우측의 '저장' 버튼**으로 1건씩 누적 insert(상태 published 유지, 저장 후 칸이 비워져 다음 메모를 바로 이어 씀). 각 Todo 제목 옆 **연필(✏️) 버튼으로 내용을 인라인 수정**(입력 + '저장'·'✕' 취소, Enter 저장·Esc 취소. 제목만 — 상태·담당자·PJT는 Task 창에서). 이 탭의 모든 변경(확인·완료·메모·내용 수정)은 `emitDataChanged()`로 사이드바에 통보해 '나의 할 일'·'업데이트'가 즉시 갱신된다. 저장된 메모(날짜만)는 누적 표시되며, 각 메모 우측 **연필(✏️) 버튼으로 수정 모드 진입** → 인라인 입력 + **'저장'(내용 수정)·'삭제'(확인창 후 제거)·'✕'(취소)**. 메모를 새로 저장하면 그 Todo는 **업데이트 목록에 오른다**(작성자 구분이 없어 본인이 쓴 메모도 뜬다 — 확인으로 지운다. 불편하면 메모 작성자 칸 추가를 검토). 메모 '수정'은 업데이트로 치지 않는다(작성 시각 불변). Task의 전 Todo가 done이면 그룹도 제거.
3. **PJT 세부화면 좌우 배치 = 좌 Tasks / 우 Todo (둘 다 `flex:1 1 0` — 폭 1:1)** (Task 사이드 패널이 우측에 열려도 좌측 Todo가 가려지지 않도록). **Todo 목록**: **todo.project_id = 이 PJT OR task.project_id = 이 PJT** 합집합(출처 PJT + 태그된 PJT 양쪽에 노출). 다른 PJT로 태그된 Todo엔 `→ 대상PJT명` 표기. 각 Todo에 🗑 삭제 버튼(확인창). **체크박스 = 완료(done) 토글**('체크' 상태 폐지 — migrations/011). 완료는 **두 곳에서 가능**: 이 체크박스 + Todo 체크 탭의 '완료' 버튼. **완료된 Todo는 기본으로 접혀 있다**(`완료 n건` 토글로 펼침 — 쌓이면 화면을 덮으므로 감추되, 무엇을 끝냈는지 보고 잘못 완료한 것을 되돌릴 통로는 남긴다). 전이: 미완료(draft·published)→`done` / `done`→해제(완료 취소)→배포된 적 있으면(`deployed_at`) `published`, 없으면 `draft`.
4. **메모는 누적 저장**(todo_memos insert), 화면에는 최신 1건만 표시. 날짜만 표기(시각 없음).
5. **TaskModal은 단일 창**: 신규 등록·기존 Task 클릭 전부 동일 컴포넌트. 필드: Task명 / 날짜(기본 작성일) / 멤버(기본=PJT 멤버 전원) / 결정&전달사항 / **링크(여러 개, 새 창)** / Todo 행(내용·담당자·PJT·삭제). 링크는 PJT와 동일 패턴(link_urls 배열, migrations/009 미적용 시 폴백 저장), 세부화면 Tasks 목록에 각 링크 `↗`로 노출. 담당자 = Task 멤버 중 체크박스 복수 선택. Todo 상태는 이 창에 표기하지 않고 변경 불가. **새로 추가되는 Todo는 담당자와 무관하게 항상 draft로 생성**(기존 Todo 상태는 건드리지 않음). **모든 Todo는 배포 탭에서 배포를 거쳐야** 진행 단계로 넘어간다 — 담당자가 `MY_NAME`이라고 배포를 건너뛰지 않는다. 하단: 저장 + 삭제(확인창, 기타 Task는 삭제 불가)만 — **배포 버튼 없음**(배포는 배포 탭에서 Todo 단위/Task 일괄 처리).
6. **배포 탭**: 두 섹션 — 상단 **미배포**(draft Todo 있는 Task, 기본 펼침) / 하단 **배포됨**(draft 없이 published만, **기본 접힘**·헤더 클릭으로 펼침). 배포해도 회색으로 남아 되돌리기 가능, **모든 Todo가 done으로 넘어가야 사라짐**(무한 누적 아님. '체크' 폐지로 이전보다 오래 남는다 — 배포됨 섹션은 기본 접힘). 묶음 = 헤더 `Task명 (작성 M/D) — 프로젝트명`(draft 있으면 주황+'이 Task 전체 배포', 전부 배포됐으면 회색+'배포됨 n건·되돌리기 가능') + 지시사항(decisions) 미리보기 + **링크(Task의 `link_urls`, 있을 때만 노출 — 배포 시 지시사항과 함께 전달되는 참고 자료. `↗` 새 창)** + 전체 Todo 목록(draft=정상+'배포', published=회색+'미배포로 되돌리기', done=회색 표시만). 각 Task 헤더 좌측 ▶/▼로 접기/펼치기(헤더 클릭 토글, '전체 배포' 버튼은 stopPropagation). 배포 시 `deployed_at=now()`, 되돌리기 시 null. PJT 세부 Tasks 목록 표기는 `YY.MM.DD Task명`.
7. **PJT 관리 탭**: 태그별 컬럼(그리드 auto-fill minmax(220px,1fr) 자동 줄바꿈 — 가로 스크롤 없음, 빈 컬럼도 표시), PJT명 카드. 복수 태그 = 중복 노출. 마지막에 '태그 없음' 컬럼. 카드 배경 = PJT 상태색(단, **긴급이거나 '내 미실행 Todo' 보유 시 빨강** — 색상 토큰 절 참조). 카드 이름 앞에 우선순위 아이콘(긴급🚨/중요💡/둘다🔥). 상단에 **상태 필터 칩(미진행·진행중·보류·완료 다중 선택, 기본값 = 완료 제외 3개)** — 칩 색이 곧 카드색 범례. 완료 PJT는 '완료' 칩을 켜면 함께 표시(설정에서도 열람 가능). 우측 상단 'PJT 등록'. 새 Task 작성 버튼은 이 탭/배포 탭에 없음(Task 작성은 PJT 세부화면에서만).
8. **PJT 등록 시 "기타-{프로젝트명}" Task 자동 생성**: is_misc=true (미스 Task 식별은 title이 아니라 `is_misc` 플래그로만 판별). 특별 취급 없음 — 기타 Task의 Todo도 draft로 생성되어 같은 배포 절차를 탄다(단, 기타 Task 자체는 삭제 불가).
9. **구분·태그·멤버 관리는 `ItemManager` 하나로 공용**. 두 진입점이 같은 컴포넌트를 쓴다: ① ProjectFormModal 안의 ⚙ 인라인 팝업(InlineManage = 팝업 껍데기), ② `/settings` 3탭. 삭제는 `lib/deleteGuards`의 사용처 검사를 반드시 거친다 — 구분=사용 중이면 **차단**, 태그·멤버=사용 건수 경고 후 확인. 중복 구현 금지.
10. **삭제**: PJT·Task 모두 삭제 가능, cascade(스키마에 정의됨), 반드시 확인창.
11. **PC 전용.** 반응형 작업하지 않는다. (예외: TaskModal drawer만 분할·좁은 화면<lg에서 전체화면으로 전환 — 규칙5.)
12. **사이드바 = [나의 할 일 | 업데이트] 버튼 전환**(선택 탭은 localStorage 기억). PJT 트리·정렬·필터 없음(PJT 진입은 PJT 관리 탭에서만 한다). 두 목록 모두 **배포된(`published`) Todo**에서 나온다(draft는 배포 탭에서 배포해야 올라오고, done은 제외).
   - **업데이트** = 확인하지 않은 새 진행사항이 달린 Todo(**담당자 무관**). 판정은 `lib/updates.hasUnreviewedUpdate`: 최신 메모가 있고 `reviewed_at`이 없거나 그보다 새것. **Todo당 1건**(최신 메모 내용 2줄 미리보기 + `PJT명 · M/D`), **최신 메모순**. 카드 클릭 = Todo 체크 탭 점프(나의 할 일과 동일), 카드의 **'확인'** = 이동 없이 바로 지움. 확인 시 `reviewed_at`에 **'지금'이 아니라 확인한 최신 메모의 작성 시각**을 넣는다(클라이언트 시계가 DB보다 늦으면 '지금'으로는 방금 달린 메모가 안 지워짐). 확인 후 새 메모가 달리면 자동으로 다시 뜬다. migrations/011 미적용이면 판정 불가 → 건수 숨기고 적용 안내(전부 미확인으로 쏟아지지 않게).
   - **나의 할 일** = 담당자에 `lib/config.MY_NAME`이 포함된 Todo. 상태 뱃지 없음. 순서는 **활동일 오래된순 고정** — 활동일 = **마지막 진행사항 메모(`todo_memos.created_at`), 없으면 Todo 등록일(`todos.created_at`)**. 진행사항을 적으면 그 날짜로 갱신되어 아래로 내려가므로, 오래 방치된 일만 위에 남는다. 카드에 표시하는 날짜도 이 활동일이다(정렬과 표시가 어긋나지 않게). 각 항목 = Todo명 + `PJT명 · M/D`. **클릭 시 점프**: `navigate('/main', { state: { focusTodoId } })` → MainPage가 Todo 체크 탭을 열고 `focusTodoId`를 넘김 → TodoCheckTab이 **PJT별로 전환**(최근 활동 등에선 대상이 없을 수 있음)한 뒤 그 Todo가 속한 그룹을 펼치고 스크롤·강조(2.6초). 스크롤은 `behavior:'smooth'` 금지(렌더가 멈춘 탭에서 아예 동작하지 않음) — 즉시 스크롤 + 재시도.

## Tailwind 색상 토큰
```ts
colors: {
  primary: '#185FA5', 'primary-light': '#E6F1FB',
  success: '#085041', 'success-light': '#E1F5EE',
  warning: '#633806', 'warning-light': '#FAEEDA',
  danger:  '#A32D2D', 'danger-light': '#FCEBEB',
  'sidebar-bg': '#F5F4F0',
}
```
- **PJT 상태색(단일 소스 = `types.STATUS_CARD_STYLE`)**: 미진행=회색(#F1F0EC/#55534E) · 진행중=파랑(#E6F1FB/#0C447C) · 보류=노랑(#FAEEDA/#633806) · 완료=초록(#E1F5EE/#085041). **긴급(is_urgent) 체크 시 상태 무관 빨강(#FCEBEB/#791F1F)** — `types.projectColor(status, urgent, myOpenTodo?)` 사용. PJT 카드·세부 상태 드롭박스 등 상태색 쓰는 모든 곳 일괄.
- **내 미실행 Todo 빨강(PJT 관리 카드 전용)**: 담당자에 `lib/config.MY_NAME`이 포함된 **done 아닌** Todo(draft·published)를 가진 PJT는 긴급과 같은 빨강. 판정 기준은 **`todo.project_id`**(Todo가 속한 PJT, task.project_id 아님). `projectColor`의 3번째 인자로 넘긴다 — 세부화면 드롭박스는 이 규칙을 쓰지 않는다(2번째 인자까지만).
- 사이드바·PJT 카드 이름 앞 아이콘: `types.priorityIcon(urgent, important, regular)` 공용 — 정기🔄(항상 맨 왼쪽)·긴급🚨·중요💡·긴급+중요🔥(긴급🚨의 연장선 — 전부 이모지라 CSS color 불필요). is_regular=migrations/008.
- 카드 border border-gray-200 rounded-xl, 그림자 최소화. 입력 필드 흰 배경.

## 대표 쿼리 패턴
```ts
// 사이드바: 구분 → active/pending/hold PJT
supabase.from('projects').select('*, divisions(name)').neq('status','done').order('name')

// Todo 체크 탭: Task 묶음 + Todo + 담당자 + 메모 (published만 클라이언트 필터, todos(*) 로 reviewed_at 포함)
supabase.from('tasks')
  .select(`*, projects(name, division_id),
    todos(*, projects(name, division_id), todo_assignees(people(name)),
      todo_memos(content, created_at))`)

// 배포 탭: draft Todo가 있는 Task 묶음 (클라이언트 필터)
supabase.from('tasks')
  .select('id, title, task_date, decisions, projects(name), todos(id, title, status, sort_order)')

// PJT 세부 Todo: project_id 매칭 (Task 무관)
supabase.from('todos')
  .select('*, tasks(title, status), todo_assignees(people(name)), todo_memos(id)')
  .eq('project_id', projectId)
```

## 개발 순서 (권장)
1) 스캐폴딩 + 라우팅 + 인증 → 2) schema-v2.sql 적용 + 사이드바 → 3) PJT 관리 탭 + ProjectFormModal(⚙ 포함, 기타 Task 자동 생성) → 4) PJT 세부화면 + TaskModal → 5) Tasks 배포 탭 → 6) Todo 체크 탭 → 7) 설정 → 8) 배포

## Git/배포
- .gitignore: node_modules, dist, .env.local 필수 확인 후 push
- GitHub 새 레포: Public, README/gitignore/license 모두 Off
- Vercel 최초 연동만 웹 UI 수동, 이후 push 자동 배포. 환경변수는 Vercel 대시보드에 별도 입력
- 커밋 이메일 불일치로 Deployment Blocked 시: `git config --global user.email` 수정 → `git commit --amend --reset-author --no-edit` → force push
