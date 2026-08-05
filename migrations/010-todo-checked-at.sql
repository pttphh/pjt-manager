-- =============================================
-- Todo가 '체크(checked)' 단계를 거쳤는지 기록
-- 완료(done) 해제 시 어디로 되돌릴지 판단하는 근거.
-- (기존에는 메모 유무로 추정했으나, 메모 없이도 체크가 가능해 오판이 있었다)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table todos add column if not exists checked_at timestamptz;

-- 백필: 지금 체크 상태인 Todo는 체크를 거친 것이 확실하다.
update todos set checked_at = now()
 where status = 'checked' and checked_at is null;

-- 백필: 이미 완료된 Todo는 이력이 없으므로, 종전 판정 기준(메모 보유)을 그대로 적용해
--       최소한 기존 동작과 어긋나지 않게 한다.
update todos t set checked_at = now()
 where t.status = 'done' and t.checked_at is null
   and exists (select 1 from todo_memos m where m.todo_id = t.id);

grant all on todos to anon;
