-- =============================================
-- PJT 긴급/중요 플래그 (PJT 관리 카드 이름 앞 아이콘: 긴급🚨 / 중요💡 / 둘다⭐)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table projects add column if not exists is_urgent boolean not null default false;
alter table projects add column if not exists is_important boolean not null default false;

grant all on projects to anon;
