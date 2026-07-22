-- =============================================
-- PJT 링크를 여러 개 저장 (단일 link_url → 배열 link_urls)
-- Supabase SQL Editor 에 붙여넣고 실행하세요. (재실행 안전)
-- =============================================

alter table projects add column if not exists link_urls text[] default '{}';

-- 기존 단일 링크(link_url)를 배열로 이전 (배열이 비어 있고 단일 링크가 있는 경우만)
update projects
   set link_urls = array[link_url]
 where link_url is not null and link_url <> ''
   and (link_urls is null or array_length(link_urls, 1) is null);

grant all on projects to anon;
