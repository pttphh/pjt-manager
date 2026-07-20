-- =============================================
-- PJT 세부화면 상단 '링크' 필드 (온라인 주소, 새 창으로 열기)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table projects add column if not exists link_url text;

-- 신규 컬럼 포함 anon 권한 재확인
grant all on projects to anon;
