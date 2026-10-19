import { supabase } from './supabase'
import { emitDataChanged } from './events'

/**
 * 진행사항 '업데이트' 판정 — 사이드바와 Todo 체크 탭이 이 규칙 하나만 쓴다.
 * 최신 메모가 있고, 아직 확인하지 않았거나(reviewed_at 없음) 확인 이후에 새 메모가 달렸으면 true.
 *
 * 문자열 비교를 하지 않는 이유: Supabase 가 돌려주는 timestamptz 는 소수점 자릿수가 들쭉날쭉해
 * 사전순 비교가 시간 순서와 어긋날 수 있다.
 */
export function hasUnreviewedUpdate(
  latestMemoAt: string | null | undefined,
  reviewedAt: string | null | undefined,
): boolean {
  if (!latestMemoAt) return false
  if (!reviewedAt) return true
  return new Date(latestMemoAt).getTime() > new Date(reviewedAt).getTime()
}

/** 메모 목록에서 가장 최근 작성 시각 */
export function latestMemoTime(memos: { created_at: string }[] | null | undefined): string | null {
  let best: string | null = null
  for (const m of memos ?? []) {
    if (!m.created_at) continue
    if (!best || new Date(m.created_at).getTime() > new Date(best).getTime()) best = m.created_at
  }
  return best
}

/**
 * '확인' — 이 Todo의 진행사항을 지금 본 메모까지 읽은 것으로 기록한다.
 *
 * reviewed_at 에 '지금 시각'이 아니라 **확인한 최신 메모의 작성 시각**을 넣는다.
 * 클라이언트 시계가 DB 보다 늦으면 '지금'으로 기록했을 때 방금 달린 메모가 확인 시각보다
 * 새것으로 판정돼 사라지지 않는다. 메모 시각을 그대로 쓰면 시계 차이와 무관하다.
 */
export async function markReviewed(todoId: string, latestMemoAt: string): Promise<boolean> {
  const { error } = await supabase.from('todos').update({ reviewed_at: latestMemoAt }).eq('id', todoId)
  if (error) {
    if (error.code === 'PGRST204' || error.code === '42703') {
      alert('업데이트 확인을 저장하지 못했습니다.\nmigrations/011-todo-reviewed-at.sql 을 적용하세요.')
    } else {
      console.error('[updates] 확인 저장 실패', error)
    }
    return false
  }
  emitDataChanged()
  return true
}
