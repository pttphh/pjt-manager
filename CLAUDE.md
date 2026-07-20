# CLAUDE.md — 프로젝트 관리 툴 v2

이 문서는 Claude Code 세션의 고정 기준이다. 매 세션 맥락을 재추측하지 말고 이 문서를 따른다.
상세 요구사항은 `prd-v2.md`, DB는 `schema-v2.sql` 참조 (둘 다 프로젝트 루트에 있음).

## 한 줄 정의
경영자와 소수 팀원용 PC 전용 업무 관리 웹앱. PJT → Tasks → Todo 3계층, Task 배포 → Todo 진행 체크 흐름.

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
/main          MainPage (Layout, 3탭: Todo체크 | Tasks배포 | PJT관리)
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
    task/     TaskModal.tsx          -- 보기/편집 겸용 단일 팝업 (아래 참조)
    project/  ProjectFormModal.tsx   -- PJT 등록/편집 (⚙ 인라인 구분·태그 관리 포함)
  pages/      PasswordPage.tsx MainPage.tsx ProjectDetailPage.tsx SettingsPage.tsx
  tabs/       TodoCheckTab.tsx TaskDeployTab.tsx ProjectManageTab.tsx
  lib/        supabase.ts
  types/      index.ts
```

## 핵심 타입
```ts
export type ProjectStatus = 'pending' | 'active' | 'hold' | 'done'
export type TaskStatus = 'draft' | 'published'
export type TodoStatus = 'pending' | 'checked' | 'done'

export interface Division { id: string; name: string; sort_order: number }
export interface Tag { id: string; name: string; sort_order: number }
export interface Person { id: string; name: string }

export interface Project {
  id: string; name: string; description: string | null
  link_url?: string | null            // 관련 온라인 주소 (migrations/003), 세부화면 상단에서 새 창으로 열림
  division_id: string; status: ProjectStatus
  start_date: string | null; due_date: string | null; completed_at: string | null
  divisions?: Division
  project_tags?: { tags: Tag }[]
  project_members?: { people: Person }[]
}
export interface Task {
  id: string; project_id: string; title: string; task_date: string
  decisions: string | null; status: TaskStatus; is_misc: boolean
  deployed_at: string | null
  projects?: Project; task_members?: { people: Person }[]; todos?: Todo[]
}
export interface Todo {
  id: string; task_id: string; project_id: string; title: string
  status: TodoStatus; sort_order: number
  todo_assignees?: { people: Person }[]; todo_memos?: TodoMemo[]
}
export interface TodoMemo { id: string; todo_id: string; content: string; created_at: string }
```

## 반드시 지킬 도메인 규칙
1. **Todo의 project_id ≠ task의 project_id 가능.** 기본값은 Task의 PJT. 변경 허용 범위 = 동일 구분 + status가 pending/active인 PJT만.
2. **Todo 체크 탭**: 배포 여부와 무관하게 **전체 Task의 Todo 표시**(미배포 Task 포함). 각 Todo 앞에 **단일 상태 뱃지** 표기: 미배포(주황) → 배포(초록) → 체크(파랑). 체크되면 배포/미배포 뱃지가 '체크'로 교체(2개 병행 아님). 상단에 구분 필터 칩(Todo의 project_id → division 기준) + **묶음 토글(Tasks/담당자)**. 묶음=Tasks면 Task 단위 아코디언(메타 `담당: …`), 묶음=담당자면 사람 단위 아코디언(메타 `PJT: …`). 미진행 구간과 체크됨 구간 두 구간(각 구간엔 해당 상태 Todo만, 한 그룹이 양 구간 동시 노출 가능). 미진행 Todo는 '저장 & 체크' → status 'checked' + 하단 이동(**메모는 선택, 비어 있어도 체크 가능**; 배포/미배포 무관). 체크됨 Todo는 최신 메모(날짜만) 표시 + **'체크 해제'(→ 'pending', 미진행 복귀, 메모 이력 유지)** / **'완료로 변경'(→ 'done', 화면 제거)** 두 버튼. Task의 전 Todo가 done이면 그룹도 제거.
3. **PJT 세부화면 Todo 목록**: project_id 매칭 기준, 미배포 Task의 Todo 포함 전체. 체크박스 자유 체크/해제. 체크→'done'. 해제→메모 있으면 'checked', 없으면 'pending'.
4. **메모는 누적 저장**(todo_memos insert), 화면에는 최신 1건만 표시. 날짜만 표기(시각 없음).
5. **TaskModal은 단일 창**: 신규 등록·기존 Task 클릭·배포 탭 '내용보기' 전부 동일 컴포넌트. 필드: Task명 / 날짜(기본 작성일) / 멤버(기본=PJT 멤버 전원) / 결정&전달사항 / Todo 행(내용·담당자·PJT·삭제). 담당자 = Task 멤버 중 체크박스 복수 선택. Todo 상태는 이 창에 표기하지 않고 변경 불가. 하단: 저장 + (draft이면 '배포 완료' / published이면 '미배포로 되돌리기') + 삭제(확인창).
6. **행 표기 규칙**: Tasks 배포 탭 `Task명 (작성|배포 M/D) — 프로젝트명`. PJT 세부 Tasks 목록 `YY.MM.DD Task명`.
7. **PJT 관리 탭**: 태그별 컬럼, PJT명 카드만. 복수 태그 = 중복 노출. 마지막에 '태그 없음' 컬럼. 카드 배경 = PJT 상태색. 상단에 **상태 필터 칩(미진행·진행중·보류·완료 다중 선택, 기본값 = 완료 제외 3개)** — 칩 색이 곧 카드색 범례. 완료 PJT는 '완료' 칩을 켜면 함께 표시(설정에서도 열람 가능). 우측 상단 'PJT 등록'. 새 Task 작성 버튼은 이 탭/배포 탭에 없음(Task 작성은 PJT 세부화면에서만).
8. **PJT 등록 시 "기타" Task 자동 생성**: is_misc=true, status='published', deployed_at=now().
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
- PJT 카드: pending=warning-light / active=primary-light / hold=danger-light
- Task 미배포=warning 계열, 배포됨=success 계열
- 카드 border border-gray-200 rounded-xl, 그림자 최소화. 입력 필드 흰 배경.

## 대표 쿼리 패턴
```ts
// 사이드바: 구분 → active/pending/hold PJT
supabase.from('projects').select('*, divisions(name)').neq('status','done').order('name')

// Todo 체크 탭: 전체 Task(배포 무관) + Todo + 담당자 + 최신 메모 (배포 유무는 task.status로 뱃지 표기)
supabase.from('tasks')
  .select(`*, projects(name, division_id),
    todos(*, projects(name, division_id), todo_assignees(people(name)),
      todo_memos(content, created_at))`)

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
