export type ProjectStatus = 'pending' | 'active' | 'hold' | 'done'
// 배포는 Todo 단위: draft(미배포) → published(배포/미진행) → checked(체크) → done(완료)
export type TodoStatus = 'draft' | 'published' | 'checked' | 'done'

export interface Division {
  id: string
  name: string
  sort_order: number
}
export interface Tag {
  id: string
  name: string
  sort_order: number
  // 태그 뱃지 색 (migrations/002). 없으면 팔레트 순환색으로 폴백.
  color_bg?: string | null
  color_fg?: string | null
  color_bd?: string | null
}
export interface Person {
  id: string
  name: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  /** 관련 온라인 주소 (migrations/003=단일 link_url, 006=배열 link_urls). 세부화면 상단에서 새 창으로 열림 */
  link_url?: string | null
  link_urls?: string[] | null
  is_urgent?: boolean | null // 긴급 (migrations/007)
  is_important?: boolean | null // 중요 (migrations/007)
  division_id: string
  status: ProjectStatus
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  sidebar_sort?: number | null // 사이드바 구분 내 정렬 (migrations/004)
  divisions?: Division
  project_tags?: { tags: Tag }[]
  project_members?: { people: Person }[]
}

export interface Task {
  id: string
  project_id: string
  title: string
  task_date: string
  decisions: string | null
  is_misc: boolean
  projects?: Project
  task_members?: { people: Person }[]
  todos?: Todo[]
}

export interface Todo {
  id: string
  task_id: string
  project_id: string
  title: string
  status: TodoStatus
  deployed_at?: string | null // 배포 시각 (미배포 복귀 시 null)
  sort_order: number
  todo_assignees?: { people: Person }[]
  todo_memos?: TodoMemo[]
}

export interface TodoMemo {
  id: string
  todo_id: string
  content: string
  created_at: string
}

export interface Swatch4 {
  bg: string
  fg: string
  bd: string
  label: string
}

// PJT 상태별 색상 (상태색을 쓰는 모든 곳의 단일 소스)
export const STATUS_CARD_STYLE: Record<ProjectStatus, Swatch4> = {
  pending: { bg: '#F1F0EC', fg: '#55534E', bd: '#DAD8D2', label: '미진행' }, // 회색
  active: { bg: '#E6F1FB', fg: '#0C447C', bd: '#B8D4EF', label: '진행중' }, // 파랑
  hold: { bg: '#FAEEDA', fg: '#633806', bd: '#E0C9A6', label: '보류' }, // 노랑
  done: { bg: '#E1F5EE', fg: '#085041', bd: '#B7E3D3', label: '완료' }, // 초록
}

// 긴급 표시(상태 무관 빨강). 긴급+중요도 빨강.
export const URGENT_STYLE: Swatch4 = { bg: '#FCEBEB', fg: '#791F1F', bd: '#EFCFCF', label: '긴급' }

/** PJT 카드/상태 표시 색: 긴급이면 빨강, 아니면 상태색 */
export function projectColor(status: ProjectStatus, urgent?: boolean | null): Swatch4 {
  return urgent ? URGENT_STYLE : STATUS_CARD_STYLE[status]
}

/** 긴급/중요 아이콘: 긴급=🚨, 중요=💡, 둘 다=⭐ (사이드바·PJT 관리 카드 공용) */
export function priorityIcon(urgent?: boolean | null, important?: boolean | null): string {
  if (urgent && important) return '⭐'
  if (urgent) return '🚨'
  if (important) return '💡'
  return ''
}
