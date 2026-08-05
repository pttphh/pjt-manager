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
  /** 체크(checked) 단계를 거친 시각 (migrations/010). 체크 해제 시 null.
   *  완료(done) 해제 시 checked 로 되돌릴지 판단하는 근거 — 메모 유무로 추정하지 않는다. */
  checked_at?: string | null
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

/**
 * PJT 카드/상태 표시 색: 빨강(긴급 or 내 미실행 Todo 보유), 아니면 상태색.
 * myOpenTodo = 담당자에 lib/config.MY_NAME 이 포함된 done 아닌 Todo가 이 PJT에 있음 (PJT 관리 카드에서만 사용).
 */
export function projectColor(
  status: ProjectStatus,
  urgent?: boolean | null,
  myOpenTodo?: boolean | null,
): Swatch4 {
  return urgent || myOpenTodo ? URGENT_STYLE : STATUS_CARD_STYLE[status]
}

/**
 * 우선순위 아이콘 (사이드바·PJT 관리 카드 공용). 정기가 있으면 항상 가장 왼쪽.
 * 정기=🔄, 긴급=🚨, 중요=💡, 긴급+중요=🔥
 *
 * 긴급+중요는 긴급(🚨)의 연장선 — 같은 빨강 계열이면서 '최우선'으로 읽히는 🔥를 쓴다.
 * 전부 이모지라 색은 이모지 자체가 갖는다 (CSS color 지정 불필요).
 */
export function priorityIcon(
  urgent?: boolean | null,
  important?: boolean | null,
  regular?: boolean | null,
): string {
  const base = urgent && important ? '🔥' : urgent ? '🚨' : important ? '💡' : ''
  return (regular ? '🔄' : '') + base
}
