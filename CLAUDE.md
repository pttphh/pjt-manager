# CLAUDE.md — 프로젝트 관리 툴 v2

이 문서는 Claude Code 세션의 고정 기준이다. 매 세션 맥락을 재추측하지 말고 이 문서를 따른다.
상세 요구사항은 `prd-v2.md`, DB는 `schema-v2.sql` 참조 (둘 다 프로젝트 루트에 있음).

## 한 줄 정의
경영자와 소수 팀원용 PC 전용 업무 관리 웹앱. PJT → Tasks → Todo 3계층, **Todo 단위 배포**(draft→published) → 진행 체크(checked→done) 흐름.

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
    layout/   Sidebar.tsx(구분별 PJT 트리, 드래그 리사이즈 160~320px, localStorage)
              Layout.tsx  ProtectedRoute.tsx
    ui/       Badge.tsx Button.tsx Modal.tsx TagInput.tsx
              ItemManager.tsx  -- 구분·태그·멤버 목록/수정/삭제/추가 공용 (설정 3탭 + ⚙ 팝업)
              InlineManage.tsx -- ItemManager를 감싼 ⚙ 인라인 팝업 껍데기
    task/     TaskModal.tsx          -- 우측 사이드 패널(drawer). 바깥클릭 닫힘 없음(dirty면 확인창), X·취소만. decisions Ctrl+B 볼드
    project/  ProjectFormModal.tsx   -- PJT 등록/편집 (⚙ 인라인 구분·태그 관리 포함)
  pages/      PasswordPage.tsx MainPage.tsx ProjectDetailPage.tsx SettingsPage.tsx
  tabs/       TodoCheckTab.tsx TaskDeployTab.tsx ProjectManageTab.tsx
  lib/        supabase.ts
  types/      index.ts
```

## 핵심 타입
```ts
export type ProjectStatus = 'pending' | 'active' | 'hold' | 'done'
// 배포는 Todo 단위: draft(미배포) → published(배포/미진행) → checked(체크) → done(완료)
export type TodoStatus = 'draft' | 'published' | 'checked' | 'done'

export interface Division { id: string; name: string; sort_order: number }
export interface Tag { id: string; name: string; sort_order: number }
export interface Person { id: string; name: string }

export interface Project {
  id: string; name: string; description: string | null
  link_urls?: string[] | null         // 관련 온라인 주소 여러 개 (migrations/006), 세부화면 상단에서 각각 새 창으로 열림 (구 단일 link_url=003)
  is_urgent?: boolean; is_important?: boolean  // 긴급/중요 (migrations/007). PJT 관리 카드 이름 앞 아이콘: 긴급🚨 중요💡 둘다⭐
  division_id: string; status: ProjectStatus
  start_date: string | null; due_date: string | null; completed_at: string | null
  divisions?: Division
  project_tags?: { tags: Tag }[]
  project_members?: { people: Person }[]
}
export interface Task {
  id: string; project_id: string; title: string; task_date: string
  decisions: string | null; is_misc: boolean   // 배포 상태 없음 (Todo 단위 배포)
  projects?: Project; task_members?: { people: Person }[]; todos?: Todo[]
}
export interface Todo {
  id: string; task_id: string; project_id: string; title: string
  status: TodoStatus; deployed_at?: string | null; sort_order: number
  todo_assignees?: { people: Person }[]; todo_memos?: TodoMemo[]
}
export interface TodoMemo { id: string; todo_id: string; content: string; created_at: string }
```

## 반드시 지킬 도메인 규칙
1. **Todo의 project_id ≠ task의 project_id 가능.** 기본값은 Task의 PJT. 변경 허용 범위 = 동일 구분 + status가 pending/active인 PJT만.
2. **Todo 체크 탭**: `todos.status in ('published','checked')`인 Todo만 표시 — draft 미노출, done 제거. 각 Todo 앞 **단일 상태 뱃지**: 배포(초록)=published → 체크(파랑)=checked. 상단에 구분 필터 칩(Todo의 project_id → division 기준) + **묶음 토글(Tasks/담당자)**. **보기 기준** 토글은 필터 칩 왼쪽에 배치, 3종: [Task별](Task 단위 아코디언, 메타 `담당: …`) / [나의 할 일](담당자에 `lib/config.MY_NAME` 포함 Todo만, Task 그룹핑) / [담당자별](사람 단위 아코디언, 메타 `PJT: …`, 담당자 없으면 '미지정' 그룹). 구분 필터와 함께 동작. 미진행(published) 구간과 체크됨(checked) 구간 두 구간(한 그룹이 양 구간 동시 노출 가능). 미진행 Todo는 '저장 & 체크' → 'checked' + 하단 이동(**메모는 선택, 비어 있어도 체크 가능**). 체크됨 Todo는 최신 메모(날짜만) 표시 + **'체크 해제'(→ 'published' 복귀, 메모 이력 유지)** / **'완료로 변경'(→ 'done', 화면 제거)** 두 버튼. Task의 전 Todo가 done이면 그룹도 제거.
3. **PJT 세부화면 Todo 목록**: **todo.project_id = 이 PJT OR task.project_id = 이 PJT** 합집합(출처 PJT + 태그된 PJT 양쪽에 노출). 다른 PJT로 태그된 Todo엔 `→ 대상PJT명` 표기. 각 Todo에 🗑 삭제 버튼(확인창). 체크박스 자유 체크/해제: 체크→'done', 해제→메모 있으면 'checked', 없으면 배포됐으면 'published'·미배포면 'draft'.
4. **메모는 누적 저장**(todo_memos insert), 화면에는 최신 1건만 표시. 날짜만 표기(시각 없음).
5. **TaskModal은 단일 창**: 신규 등록·기존 Task 클릭 전부 동일 컴포넌트. 필드: Task명 / 날짜(기본 작성일) / 멤버(기본=PJT 멤버 전원) / 결정&전달사항 / Todo 행(내용·담당자·PJT·삭제). 담당자 = Task 멤버 중 체크박스 복수 선택. Todo 상태는 이 창에 표기하지 않고 변경 불가. **새로 추가되는 Todo는 항상 draft로 생성**(기존 Todo 상태는 건드리지 않음). 하단: 저장 + 삭제(확인창, 기타 Task는 삭제 불가)만 — **배포 버튼 없음**(배포는 배포 탭에서 Todo 단위/Task 일괄 처리).
6. **배포 탭**: draft **또는** published Todo가 있는 Task 묶음 표시(배포해도 회색으로 남아 되돌리기 가능, **모든 Todo가 checked/done으로 넘어가야 사라짐**). 묶음 = 헤더 `Task명 (작성 M/D) — 프로젝트명`(draft 있으면 주황+'이 Task 전체 배포', 전부 배포됐으면 회색+'배포됨 n건·되돌리기 가능') + 지시사항(decisions) 미리보기 + 전체 Todo 목록(draft=정상+'배포', published=회색+'미배포로 되돌리기', checked/done=회색 표시만). 각 Task 헤더 좌측 ▶/▼로 접기/펼치기(헤더 클릭 토글, '전체 배포' 버튼은 stopPropagation). 배포 시 `deployed_at=now()`, 되돌리기 시 null. PJT 세부 Tasks 목록 표기는 `YY.MM.DD Task명`.
7. **PJT 관리 탭**: 태그별 컬럼(고정폭 ~4개 노출, 나머지 가로 스크롤), PJT명 카드. 복수 태그 = 중복 노출. 마지막에 '태그 없음' 컬럼. 카드 배경 = PJT 상태색. 카드 이름 앞에 우선순위 아이콘(긴급🚨/중요💡/둘다⭐). 상단에 **상태 필터 칩(미진행·진행중·보류·완료 다중 선택, 기본값 = 완료 제외 3개)** — 칩 색이 곧 카드색 범례. 완료 PJT는 '완료' 칩을 켜면 함께 표시(설정에서도 열람 가능). 우측 상단 'PJT 등록'. 새 Task 작성 버튼은 이 탭/배포 탭에 없음(Task 작성은 PJT 세부화면에서만).
8. **PJT 등록 시 "기타" Task 자동 생성**: is_misc=true. 특별 취급 없음 — 기타 Task의 Todo도 draft로 생성되어 같은 배포 절차를 탄다(단, 기타 Task 자체는 삭제 불가).
9. **구분·태그·멤버 관리는 `ItemManager` 하나로 공용**. 두 진입점이 같은 컴포넌트를 쓴다: ① ProjectFormModal 안의 ⚙ 인라인 팝업(InlineManage = 팝업 껍데기), ② `/settings` 3탭. 삭제는 `lib/deleteGuards`의 사용처 검사를 반드시 거친다 — 구분=사용 중이면 **차단**, 태그·멤버=사용 건수 경고 후 확인. 중복 구현 금지.
10. **삭제**: PJT·Task 모두 삭제 가능, cascade(스키마에 정의됨), 반드시 확인창.
11. **PC 전용.** 반응형 작업하지 않는다.

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
- **PJT 상태색(단일 소스 = `types.STATUS_CARD_STYLE`)**: 미진행=회색(#F1F0EC/#55534E) · 진행중=파랑(#E6F1FB/#0C447C) · 보류=노랑(#FAEEDA/#633806) · 완료=초록(#E1F5EE/#085041). **긴급(is_urgent) 체크 시 상태 무관 빨강(#FCEBEB/#791F1F)** — `types.projectColor(status, urgent)` 사용. PJT 카드·세부 상태 드롭박스 등 상태색 쓰는 모든 곳 일괄.
- 사이드바·PJT 카드 이름 앞 아이콘: `types.priorityIcon(urgent, important)` (긴급🚨·중요💡·둘다⭐) 공용.
- 카드 border border-gray-200 rounded-xl, 그림자 최소화. 입력 필드 흰 배경.

## 대표 쿼리 패턴
```ts
// 사이드바: 구분 → active/pending/hold PJT
supabase.from('projects').select('*, divisions(name)').neq('status','done').order('name')

// Todo 체크 탭: Task 묶음 + Todo + 담당자 + 최신 메모 (published/checked만 클라이언트 필터)
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
