-- =============================================
-- 프로젝트 관리 툴 v2 — Supabase 스키마
-- 단일 비밀번호 방식 (계정/역할 없음, RLS 비활성화)
-- 트리: PJT → Tasks → Todo (Todo는 project_id 개별 매칭)
-- =============================================

-- 구분 (단일 필수)
create table divisions (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- 태그 (선택, 복수)
create table tags (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- 담당자/멤버 (계정 무관 이름 태그)
create table people (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  created_at timestamptz default now()
);

-- 프로젝트 (PJT)
create table projects (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text,                       -- 기초 사항
  division_id uuid references divisions(id) not null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'hold', 'done')),
    -- pending=미진행(노랑) active=진행중(파랑) hold=보류(빨강) done=완료(목록 미표시)
  start_date date,
  due_date date,                          -- 완료 예정일
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- PJT ↔ 태그 (복수)
create table project_tags (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  unique (project_id, tag_id)
);

-- PJT 멤버
create table project_members (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,
  person_id uuid references people(id) on delete cascade not null,
  unique (project_id, person_id)
);

-- Task (배포 상태 없음 — 배포는 Todo 단위로 처리)
create table tasks (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references projects(id) on delete cascade not null,  -- 소속 PJT (고정)
  title text not null,
  task_date date not null default current_date,  -- 기본=작성일, 지정 가능
  decisions text,                                -- 결정 & 전달 사항
  is_misc boolean not null default false,        -- "기타" 상설 Task 여부 (특별 취급 없음, 표기용)
  created_at timestamptz default now()
);

-- Task 멤버 (기본 = PJT 멤버 전원 복사, 추가/삭제 가능)
create table task_members (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references tasks(id) on delete cascade not null,
  person_id uuid references people(id) on delete cascade not null,
  unique (task_id, person_id)
);

-- Todo (배포 단위 — 4단계 상태)
create table todos (
  id uuid default gen_random_uuid() primary key,
  task_id uuid references tasks(id) on delete cascade not null,     -- 작성 출처 Task
  project_id uuid references projects(id) on delete cascade not null, -- 매칭 PJT (기본=Task의 PJT, 동일 구분 내 pending/active PJT로 변경 가능)
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'checked', 'done')),
    -- draft=미배포 published=배포(미진행) checked=체크 done=완료 (양방향 전환 허용)
  deployed_at timestamptz,                       -- 배포 시각 (미배포 복귀 시 null)
  sort_order integer default 0,
  created_at timestamptz default now()
);

-- Todo 담당자 (복수, Task 멤버 중 선택 — 앱 레벨에서 강제)
create table todo_assignees (
  id uuid default gen_random_uuid() primary key,
  todo_id uuid references todos(id) on delete cascade not null,
  person_id uuid references people(id) on delete cascade not null,
  unique (todo_id, person_id)
);

-- 진행사항 메모 (누적 저장, 화면에는 최신 1건만 표시)
create table todo_memos (
  id uuid default gen_random_uuid() primary key,
  todo_id uuid references todos(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

-- =============================================
-- 앱 레벨 규칙 (스키마로 강제하지 않는 것들)
-- 1) PJT 등록 시 "기타" Task 자동 생성: is_misc=true (특별 취급 없음, Todo가 배포 단위)
-- 2) Todo의 project_id 변경 가능 범위: 소속 Task PJT와 동일 구분 + status in ('pending','active')
-- 3) 체크박스 해제 시 복귀 상태: todo_memos 존재 → 'checked',
--    없으면 deployed_at 존재 → 'published', 아니면 'draft'
-- 4) Todo 체크 화면 노출: todos.status in ('published','checked') — draft 미노출, done 제거
-- 5) 배포 탭: draft Todo가 있는 Task만 묶음 표시, Todo 단위/Task 일괄 배포(draft→published)
-- =============================================

-- RLS 비활성화 + anon 전체 권한
alter table divisions disable row level security;
alter table tags disable row level security;
alter table people disable row level security;
alter table projects disable row level security;
alter table project_tags disable row level security;
alter table project_members disable row level security;
alter table tasks disable row level security;
alter table task_members disable row level security;
alter table todos disable row level security;
alter table todo_assignees disable row level security;
alter table todo_memos disable row level security;

grant all on divisions to anon;
grant all on tags to anon;
grant all on people to anon;
grant all on projects to anon;
grant all on project_tags to anon;
grant all on project_members to anon;
grant all on tasks to anon;
grant all on task_members to anon;
grant all on todos to anon;
grant all on todo_assignees to anon;
grant all on todo_memos to anon;

-- =============================================
-- 기본 데이터
-- =============================================
insert into divisions (name, sort_order) values
  ('Biz 일반', 1), ('유맥', 2), ('다담', 3),
  ('시네마', 4), ('ITC', 5), ('개인', 6);

insert into tags (name, sort_order) values
  ('Biz 성과관리', 1), ('Biz 조직운영', 2), ('Biz 전략기획', 3), ('Biz 정기회의', 4),
  ('Life 여유', 5), ('Life 건강', 6), ('Life 관계', 7), ('Life 학습', 8);
