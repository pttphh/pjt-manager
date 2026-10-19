-- =============================================
-- '업데이트' 기능 + '체크(checked)' 상태 폐지
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
--
-- reviewed_at = 이 Todo의 진행사항을 '확인'한 시각.
--   최신 메모가 reviewed_at 보다 새것이면 사이드바 '업데이트'에 뜬다.
--   확인 후 새 메모가 달리면 자동으로 다시 뜬다.
-- =============================================

-- 1) 컬럼 추가 + 최초 1회 백필
--    기존 메모를 전부 '확인함'으로 둬서 업데이트 목록이 빈 상태로 시작하게 한다.
--    (백필을 컬럼 생성과 묶어 둔 이유: 나중에 이 파일을 다시 실행해도
--     그 사이 쌓인 미확인 업데이트를 지워버리지 않도록)
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'todos' and column_name = 'reviewed_at') then
    alter table todos add column reviewed_at timestamptz;
    update todos set reviewed_at = now();
  end if;
end $$;

-- 2) '체크' 상태 폐지 — 기존 체크(진행 중)는 미진행(published)으로 되돌린다
update todos set status = 'published' where status = 'checked';

-- checked_at(migrations/010) 컬럼은 더 이상 쓰지 않지만 되돌릴 수 있게 남겨 둔다.
-- status 의 check 제약도 'checked' 를 그대로 허용해 둔다(롤백 대비).

grant all on todos to anon;
