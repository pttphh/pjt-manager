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
  is_regular?: boolean | null // 정기 (migrations/008)
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
  link_urls?: string[] | null // 관련 온라인 주소 여러 개 (migrations/009). 세부화면 Tasks 목록에서 새 창으로 열림
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

/**
 * 우선순위 아이콘 (사이드바·PJT 관리 카드 공용). 정기가 있으면 항상 가장 왼쪽.
 * 정기=🔄, 긴급=🚨, 중요=💡, 긴급+중요=★(빨강)
 *
 * 긴급+중요는 이모지 ⭐(고정 노랑) 대신 텍스트 글리프 ★(U+2605 + VS15)를 쓴다.
 * 텍스트 글리프라 CSS color가 먹으므로, 아이콘을 그리는 쪽에서 PRIORITY_ICON_COLOR를
 * 그대로 걸어주면 된다 — 나머지 이모지(🔄🚨💡)는 color 영향을 받지 않는다.
 */
export const PRIORITY_ICON_COLOR = '#D92D20' // 긴급+중요 ★ 전용 빨강

export function priorityIcon(
  urgent?: boolean | null,
  important?: boolean | null,
  regular?: boolean | null,
): string {
  const base = urgent && important ? '★︎' : urgent ? '🚨' : important ? '💡' : ''
  return (regular ? '🔄' : '') + base
}
