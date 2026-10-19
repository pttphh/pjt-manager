-- =============================================
-- Todo 완료 시각(done_at) — Todo 체크 탭 '최근 활동' 보기용
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
--
-- 앱 코드가 아니라 DB 트리거로 기록한다.
-- 완료가 일어나는 곳이 여러 군데(Todo 체크 탭 '완료', 세부화면 체크박스)라
-- 코드마다 기록하면 새 경로가 생겼을 때 빠뜨리기 쉽다. 트리거는 어디서 완료하든 빠지지 않는다.
--
-- 이미 완료된 Todo는 완료 시각을 알 수 없으므로 비워 둔다(= 최근 활동에 나오지 않음).
-- 없는 날짜를 지어내지 않는다.
-- =============================================

alter table todos add column if not exists done_at timestamptz;

create or replace function set_todo_done_at() returns trigger as $$
begin
  if new.status = 'done' then
    -- INSERT 에서는 OLD 가 없으므로 분기를 나눈다 (OR 로 묶으면 OLD 를 읽다 에러가 날 수 있음)
    if tg_op = 'INSERT' then
      new.done_at := coalesce(new.done_at, now());
    elsif old.status is distinct from 'done' then
      new.done_at := now();          -- 막 완료됨
    end if;                          -- 이미 done 이던 행은 기존 완료 시각 유지
  else
    new.done_at := null;             -- 완료 취소 → 지움
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_todo_done_at on todos;
create trigger trg_todo_done_at
  before insert or update of status on todos
  for each row execute function set_todo_done_at();

grant all on todos to anon;
