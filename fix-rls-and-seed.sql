-- =============================================
-- RLS 비활성화 + anon 전체 권한 + 시드 (재실행 안전)
-- Supabase SQL Editor에 그대로 붙여넣고 실행하세요.
-- 원인: 테이블은 생성됐으나 RLS가 켜진 채 grant/disable 구문이 적용되지 않아
--       anon 읽기/쓰기가 모두 막혀 있었음 (42501).
-- =============================================

-- 1) RLS 비활성화
alter table divisions        disable row level security;
alter table tags             disable row level security;
alter table people           disable row level security;
alter table projects         disable row level security;
alter table project_tags     disable row level security;
alter table project_members  disable row level security;
alter table tasks            disable row level security;
alter table task_members     disable row level security;
alter table todos            disable row level security;
alter table todo_assignees   disable row level security;
alter table todo_memos       disable row level security;

-- 2) anon 전체 권한
grant all on divisions        to anon;
grant all on tags             to anon;
grant all on people           to anon;
grant all on projects         to anon;
grant all on project_tags     to anon;
grant all on project_members  to anon;
grant all on tasks            to anon;
grant all on task_members     to anon;
grant all on todos            to anon;
grant all on todo_assignees   to anon;
grant all on todo_memos       to anon;

-- 3) 기본 데이터 시드 (name UNIQUE → 중복 시 무시, 여러 번 실행해도 안전)
insert into divisions (name, sort_order) values
  ('Biz 일반', 1), ('유맥', 2), ('다담', 3),
  ('시네마', 4), ('ITC', 5), ('개인', 6)
on conflict (name) do nothing;

insert into tags (name, sort_order) values
  ('Biz 성과관리', 1), ('Biz 조직운영', 2), ('Biz 전략기획', 3), ('Biz 정기회의', 4),
  ('Life 여유', 5), ('Life 건강', 6), ('Life 관계', 7), ('Life 학습', 8)
on conflict (name) do nothing;
