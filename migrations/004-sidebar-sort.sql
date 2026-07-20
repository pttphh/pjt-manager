-- =============================================
-- 사이드바에서 구분 내 PJT를 드래그로 위아래 정렬하기 위한 컬럼.
-- (PJT 관리 탭 '태그 없음' 컬럼용 sort_order 와 충돌하지 않도록 별도 컬럼)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table projects add column if not exists sidebar_sort integer default 0;

grant all on projects to anon;
