-- =============================================
-- PJT 관리 탭: 태그 ✎ 편집(이름·색) + 드래그 정렬(컬럼·카드) 지원용 컬럼 추가
-- 전제: fix-rls-and-seed.sql 을 먼저 실행해 RLS 비활성화 + anon grant 가 되어 있어야 함.
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

-- 1) 태그 색상 (뱃지 배경/글자/보더) — 태그 ✎ 편집에서 변경
alter table tags         add column if not exists color_bg text default '#F0EFEC';
alter table tags         add column if not exists color_fg text default '#55534E';
alter table tags         add column if not exists color_bd text default '#D9D7D1';

-- 2) 정렬 순서
--    projects.sort_order      → '태그 없음' 컬럼의 카드 순서
--    project_tags.sort_order  → 각 태그 컬럼별 카드 순서 (PJT가 여러 태그에 있으면 컬럼마다 독립)
alter table projects     add column if not exists sort_order integer default 0;
alter table project_tags add column if not exists sort_order integer default 0;

-- 3) 기존 태그에 디자인 팔레트 색 초기 배정 (sort_order 기준 7색 순환, 이후 편집 가능)
update tags set color_bg='#E1F5EE', color_fg='#085041', color_bd='#B7E3D3' where (sort_order-1) % 7 = 0;
update tags set color_bg='#E6F1FB', color_fg='#0C447C', color_bd='#B8D4EF' where (sort_order-1) % 7 = 1;
update tags set color_bg='#EEEDFE', color_fg='#3C3489', color_bd='#C9C5F5' where (sort_order-1) % 7 = 2;
update tags set color_bg='#FAEEDA', color_fg='#633806', color_bd='#E0C9A6' where (sort_order-1) % 7 = 3;
update tags set color_bg='#FCEBEB', color_fg='#A32D2D', color_bd='#EFCFCF' where (sort_order-1) % 7 = 4;
update tags set color_bg='#EAF3E9', color_fg='#3D6B33', color_bd='#C7DEC2' where (sort_order-1) % 7 = 5;
update tags set color_bg='#F0EFEC', color_fg='#55534E', color_bd='#D9D7D1' where (sort_order-1) % 7 = 6;

-- 4) anon 권한 재확인 (신규 컬럼 포함)
grant all on tags         to anon;
grant all on projects     to anon;
grant all on project_tags to anon;
