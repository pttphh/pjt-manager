-- =============================================
-- PJT '정기' 플래그 (사이드바·PJT 관리 카드 이름 앞 회전화살표 🔄, 아이콘 중 가장 왼쪽)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table projects add column if not exists is_regular boolean not null default false;

grant all on projects to anon;
