-- =============================================
-- 배포 개념을 Task 단위 → Todo 단위로 변경
--  · todos.status 4단계: draft(미배포) → published(배포) → checked(체크) → done(완료)
--  · todos.deployed_at 추가 (배포 시각, 미배포 복귀 시 null)
--  · tasks.status / tasks.deployed_at 제거 (Task는 더 이상 배포 상태를 갖지 않음)
--  · is_misc 컬럼은 유지하되 특별 취급 없음 (기타 Task의 Todo도 draft로 생성되어 배포 절차를 탐)
--
-- 기존 DB 전용 마이그레이션. 새로 설치하는 DB는 갱신된 schema-v2.sql 만 실행하면 됨.
-- 재실행 안전: 데이터 이전 구문은 tasks.status 가 남아 있을 때만 동작.
-- Supabase SQL Editor 에 붙여넣고 실행하세요.
-- =============================================

-- 1) todos: deployed_at 추가 + 기존 3단계 check 제거 (이전 작업 전에 제거해야 함)
alter table todos add column if not exists deployed_at timestamptz;
alter table todos drop constraint if exists todos_status_check;

-- 2) 기존 데이터 이전 — tasks.status 가 남아 있을 때만 실행 (재실행 안전)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'tasks' and column_name = 'status'
  ) then
    -- published Task의 pending Todo → published (배포 시각 승계)
    update todos t
       set status = 'published',
           deployed_at = coalesce(k.deployed_at, now())
      from tasks k
     where t.task_id = k.id and k.status = 'published' and t.status = 'pending';

    -- draft Task의 pending Todo → draft
    update todos t
       set status = 'draft'
      from tasks k
     where t.task_id = k.id and k.status = 'draft' and t.status = 'pending';

    -- 이미 checked/done 인 Todo 는 상태 유지, 배포 시각만 승계
    update todos t
       set deployed_at = k.deployed_at
      from tasks k
     where t.task_id = k.id and t.deployed_at is null and k.deployed_at is not null;
  end if;
end $$;

-- 3) todos: 새 기본값 + 4단계 check
alter table todos alter column status set default 'draft';
alter table todos add constraint todos_status_check
  check (status in ('draft', 'published', 'checked', 'done'));

-- 4) tasks: 배포 개념 제거
alter table tasks drop column if exists status;
alter table tasks drop column if exists deployed_at;

-- 5) anon 권한 재확인
grant all on tasks to anon;
grant all on todos to anon;
