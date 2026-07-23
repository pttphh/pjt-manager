-- =============================================
-- Task에도 관련 링크를 여러 개 저장 (PJT의 link_urls와 동일 패턴)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table tasks add column if not exists link_urls text[] default '{}';

grant all on tasks to anon;
