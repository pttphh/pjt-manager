import { MY_NAME } from './config'

type Named = { id: string; name: string }

/** 담당자(person id 목록)에 MY_NAME 이 포함되는지 */
export function assignedToMe(assigneeIds: string[], people: Named[]): boolean {
  const myIds = new Set(people.filter((p) => p.name === MY_NAME).map((p) => p.id))
  return assigneeIds.some((id) => myIds.has(id))
}

/**
 * 새로 만드는 Todo의 초기 상태.
 * 담당자에 MY_NAME 이 있으면 배포 절차가 무의미하므로(자기 자신에게 배포할 이유가 없다)
 * 처음부터 published 로 만들어 Todo 체크 탭·사이드바에 바로 올린다. 그 외에는 기존대로 draft.
 */
export function initialTodoStatus(
  assigneeIds: string[],
  people: Named[],
): { status: 'draft' | 'published'; deployed_at: string | null } {
  return assignedToMe(assigneeIds, people)
    ? { status: 'published', deployed_at: new Date().toISOString() }
    : { status: 'draft', deployed_at: null }
}
