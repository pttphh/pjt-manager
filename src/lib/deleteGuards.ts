import { supabase } from './supabase'

export interface GuardResult {
  /** 있으면 삭제 차단 + 이 문구로 경고 */
  block?: string
  /** 있으면 이 문구로 확인창을 띄우고, 확인 시에만 삭제 */
  confirm?: string
}
export type GuardTarget = { id: string; name: string }

async function countOf(table: string, column: string, value: string): Promise<number> {
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
  return count ?? 0
}

/** 구분: 해당 구분에 속한 PJT가 있으면 삭제 불가 (projects.division_id 는 NOT NULL) */
export async function guardDivisionDelete(item: GuardTarget): Promise<GuardResult> {
  const n = await countOf('projects', 'division_id', item.id)
  if (n > 0) {
    return {
      block: `'${item.name}' 구분에 속한 PJT가 ${n}개 있어 삭제할 수 없습니다.\n해당 PJT들의 구분을 먼저 변경한 뒤 삭제하세요.`,
    }
  }
  return { confirm: `'${item.name}' 구분을 삭제하시겠습니까?` }
}

/** 태그: 사용 중이어도 삭제 가능(project_tags 는 cascade). 다만 사용 중이면 확인창에 명시 */
export async function guardTagDelete(item: GuardTarget): Promise<GuardResult> {
  const n = await countOf('project_tags', 'tag_id', item.id)
  if (n > 0) {
    return {
      confirm: `'${item.name}' 태그는 PJT ${n}개에서 사용 중입니다.\n삭제하면 해당 PJT의 태그 연결도 함께 제거됩니다. 계속할까요?`,
    }
  }
  return { confirm: `'${item.name}' 태그를 삭제하시겠습니까?` }
}

/** 멤버: PJT 멤버·Task 멤버·Todo 담당자로 쓰이면 경고 후 확인 (모두 cascade 삭제됨) */
export async function guardPersonDelete(item: GuardTarget): Promise<GuardResult> {
  const [pm, tm, ta] = await Promise.all([
    countOf('project_members', 'person_id', item.id),
    countOf('task_members', 'person_id', item.id),
    countOf('todo_assignees', 'person_id', item.id),
  ])
  if (pm + tm + ta > 0) {
    return {
      confirm:
        `'${item.name}'은(는) 현재 사용 중입니다.\n` +
        `· PJT 멤버 ${pm}건\n· Task 멤버 ${tm}건\n· Todo 담당자 ${ta}건\n\n` +
        `삭제하면 위 배정이 모두 함께 제거됩니다. 계속할까요?`,
    }
  }
  return { confirm: `'${item.name}'을(를) 삭제하시겠습니까?` }
}

export const GUARDS = {
  divisions: guardDivisionDelete,
  tags: guardTagDelete,
  people: guardPersonDelete,
} as const
