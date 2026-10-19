import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emitDataChanged } from '../lib/events'
import { hasUnreviewedUpdate, latestMemoTime, markReviewed } from '../lib/updates'
import type { Division } from '../types'

// 'recent'(최근 활동) = 기간 안에 진행사항 메모가 저장됐거나 완료된 Todo를 날짜별로 (완료분까지 포함하는 유일한 보기)
type ViewMode = 'pjt' | 'task' | 'person' | 'recent'
/* 이 탭에 노출되는 Todo = **배포된(published) 것만**(담당자 무관). draft(미배포)·done 은 노출하지 않는다.
 * '체크' 상태는 폐지됐다(migrations/011) — 진행 중인 Todo는 한 구간에 모이고, 완료는 '완료' 버튼으로 바로 간다. */

interface TodoItem {
  id: string
  title: string
  // 최근 활동 보기만 done 을 쓴다. 나머지 보기는 published 만 거른다.
  status: 'published' | 'done'
  doneAt: string | null // migrations/012 트리거가 기록. 012 이전 완료분은 null → 최근 활동에 안 나옴
  memoRaw: { content: string; at: string }[] // 메모 원본(작성 시각 ISO) — 기간 판정·기간 내 메모 미리보기용
  taskId: string
  taskTitle: string
  taskDate: string
  taskProjectName: string
  todoProjectId: string
  todoProjectName: string
  divisionId: string
  assignees: string[]
  latestMemo: { content: string; date: string } | null
  memos: { id: string; content: string; date: string }[] // 최신순
  latestMemoAt: string | null // 확인 시 이 시각을 reviewed_at 으로 기록한다 (lib/updates)
  unreviewed: boolean // 사이드바 '업데이트'에 떠 있는 Todo (= 확인하지 않은 새 진행사항)
}
interface RawTask {
  id: string
  title: string
  task_date: string
  projects: { name: string } | null
  todos:
    | {
        id: string
        title: string
        status: string
        reviewed_at?: string | null // migrations/011 미적용이면 없다
        done_at?: string | null // migrations/012 미적용이면 없다
        projects: { id: string; name: string; division_id: string } | null
        todo_assignees: { people: { name: string } | null }[] | null
        todo_memos: { id: string; content: string; created_at: string }[] | null
      }[]
    | null
}

interface Group {
  key: string
  name: string
  metaLine: string
  count: number
  sortDate: string // 정렬 기준 = 그룹 내 Todo의 Task 작성일 (최신순이면 최대, 오래된순이면 최소)
  pinLast?: boolean // '미지정' 그룹은 정렬과 무관하게 항상 맨 아래
  todos: (TodoItem & { metaLabel: string; metaValue: string })[]
}

/** M/D 표기. 메모의 timestamptz(UTC)는 로컬 날짜로 변환(오전 9시 이전 기록이 하루 전으로 밀리지 않게).
 *  Task 작성일처럼 날짜만 있는 문자열은 그대로 파싱한다. */
const md = (d: string | null) => {
  if (!d) return ''
  if (!d.includes('T')) {
    const [, m, day] = d.slice(0, 10).split('-')
    return `${+m}/${+day}`
  }
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '' : `${dt.getMonth() + 1}/${dt.getDate()}`
}

/* ---- 최근 활동: 날짜 경계는 '로컬(한국) 하루' 기준 ----
 * DB 시각은 UTC 라 문자열로 비교하면 오전 9시 이전 기록이 전날로 잡힌다.
 * 날짜 입력값(YYYY-MM-DD)을 로컬 자정 경계의 ms 로 바꿔 숫자로 비교한다. */
const RECENT_DAYS = 10 // 기본 범위 = 오늘 포함 10일
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ymdToDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const dayStartMs = (ymd: string) => ymdToDate(ymd).getTime()
const dayEndMs = (ymd: string) => {
  const d = ymdToDate(ymd)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1 // 다음날 0시 - 1ms
}
const defaultRange = () => {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (RECENT_DAYS - 1))
  return { start: ymdLocal(start), end: ymdLocal(end) }
}

/* '체크' 상태가 폐지되면서 이 탭의 Todo는 전부 '배포' 상태다 → 상태 뱃지는 정보가 없어 없앴다.
 * 대신 확인하지 않은 새 진행사항이 있는 Todo에만 '업데이트' 표시를 붙인다(사이드바 '업데이트'와 같은 기준). */
function UpdateBadge() {
  return (
    <span
      title="확인하지 않은 새 진행사항이 있습니다"
      style={{
        background: '#E6F1FB',
        color: '#0C447C',
        border: '1px solid #B8D4EF',
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
      }}
    >
      업데이트
    </span>
  )
}

interface TodoCheckTabProps {
  /** 사이드바 '나의 할 일'에서 점프해 온 Todo — 그룹을 펼치고 스크롤·강조한다 */
  focusTodoId?: string | null
  onFocusDone?: () => void
}

export default function TodoCheckTab({ focusTodoId, onFocusDone }: TodoCheckTabProps = {}) {
  const [items, setItems] = useState<TodoItem[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all') // division id | 'all'
  const [view, setView] = useState<ViewMode>('pjt') // 기본 = PJT별 (이 탭의 메인 화면)
  // 최근 활동 기간 (로컬 날짜 YYYY-MM-DD). 기본 = 오늘 포함 10일
  const [range, setRange] = useState(defaultRange)
  // 최근 활동 행을 눌러 PJT별로 넘어갈 때 쓰는 내부 점프 대상 (사이드바 점프는 prop focusTodoId)
  const [localFocus, setLocalFocus] = useState<string | null>(null)
  const [doneTracked, setDoneTracked] = useState(true) // migrations/012(done_at) 적용 여부
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // 미진행 Todo별 진행사항 메모 입력값 (Todo id → 문자열). 저장 후 칸이 비워져 다음 메모를 바로 이어 쓴다.
  const [memoInputs, setMemoInputs] = useState<Record<string, string>>({})
  // 저장된 메모 수정 중 상태 (메모 id + 편집 내용)
  const [editingMemo, setEditingMemo] = useState<{ id: string; content: string } | null>(null)
  // Todo 내용 수정 중 상태 (todo id + 편집 제목)
  const [editingTodo, setEditingTodo] = useState<{ id: string; title: string } | null>(null)
  const savingRef = useRef<Set<string>>(new Set()) // 저장/체크 연타 방지
  // 점프 대상 강조 + 스크롤용 ref
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const todoRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const focusTimersRef = useRef<number[]>([]) // 점프 스크롤 재시도 타이머 (언마운트 때만 정리)

  useEffect(() => {
    void load()
  }, [])

  /** 변경 후 이 탭을 다시 읽고, 사이드바('나의 할 일')에도 알린다.
   *  이 탭의 체크·완료·메모·내용 수정은 모두 사이드바 목록과 정렬에 영향을 준다. */
  async function refresh() {
    await load()
    emitDataChanged()
  }

  async function load() {
    setLoading(true)
    try {
      const [{ data: divData }, { data: taskData }] = await Promise.all([
        supabase.from('divisions').select('*').order('sort_order'),
        // 진행 중(published)은 모든 보기에, 완료(done)는 '최근 활동' 보기에만 쓴다.
        // todos 는 '*' 로 받아 migrations/011·012(reviewed_at·done_at) 미적용이어도 깨지지 않게.
        supabase
          .from('tasks')
          .select(
            'id, title, task_date, projects(name), todos(*, projects(id, name, division_id), todo_assignees(people(name)), todo_memos(id, content, created_at))',
          ),
      ])
      setDivisions((divData as Division[]) ?? [])

      const flat: TodoItem[] = []
      let sawDoneKey = false
      for (const t of (taskData as unknown as RawTask[]) ?? []) {
        for (const td of t.todos ?? []) {
          if ('done_at' in td) sawDoneKey = true
          // 미배포(draft)는 어떤 보기에도 나오지 않는다 — 담당자가 누구든 배포 탭에서 배포해야 올라온다.
          // 'checked' 는 폐지된 상태지만 migrations/011 적용 전에는 남아 있을 수 있어 진행 중으로 함께 보여준다.
          const isDone = td.status === 'done'
          if (!isDone && td.status !== 'published' && td.status !== 'checked') continue
          const assignees = (td.todo_assignees ?? [])
            .map((a) => a.people?.name)
            .filter(Boolean) as string[]
          const memos = (td.todo_memos ?? [])
            .slice()
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          const latestAt = latestMemoTime(td.todo_memos)
          flat.push({
            id: td.id,
            title: td.title,
            status: isDone ? 'done' : 'published',
            doneAt: td.done_at ?? null,
            memoRaw: (td.todo_memos ?? [])
              .filter((m) => m.created_at)
              .map((m) => ({ content: m.content, at: m.created_at })),
            taskId: t.id,
            taskTitle: t.title,
            taskDate: t.task_date,
            taskProjectName: t.projects?.name ?? '(프로젝트 없음)',
            todoProjectId: td.projects?.id ?? '',
            todoProjectName: td.projects?.name ?? '(프로젝트 없음)',
            divisionId: td.projects?.division_id ?? '',
            assignees,
            latestMemo: memos[0] ? { content: memos[0].content, date: md(memos[0].created_at) } : null,
            memos: memos.map((m) => ({ id: m.id, content: m.content, date: md(m.created_at) })),
            latestMemoAt: latestAt,
            // reviewed_at 컬럼이 아직 없으면(011 미적용) 판정하지 않는다 — 안 그러면 메모 있는 Todo가 전부 미확인으로 쏟아진다
            // 완료된 Todo는 업데이트 대상이 아니다(사이드바 '업데이트'도 published 만)
            unreviewed: !isDone && 'reviewed_at' in td && hasUnreviewedUpdate(latestAt, td.reviewed_at),
          })
        }
      }
      setItems(flat)
      // done_at 컬럼 유무 — 012 미적용이면 최근 활동에서 '완료'를 판정할 수 없어 안내를 띄운다
      setDoneTracked(sawDoneKey || flat.length === 0)
    } catch (e) {
      console.error('[TodoCheckTab] 로드 실패', e)
    } finally {
      setLoading(false)
    }
  }

  // 진행사항 메모 1건 저장(누적 insert). 상태는 그대로 published 유지. 저장 후 입력칸이 비워져 다음 메모를 이어 쓴다.
  async function saveMemo(todoId: string) {
    if (savingRef.current.has(todoId)) return
    const content = (memoInputs[todoId] ?? '').trim()
    if (!content) return
    savingRef.current.add(todoId)
    try {
      await supabase.from('todo_memos').insert({ todo_id: todoId, content })
      setMemoInputs((m) => ({ ...m, [todoId]: '' }))
      void refresh()
    } finally {
      savingRef.current.delete(todoId)
    }
  }
  // 완료 — published → done. 입력 중이던 메모가 있으면 데이터 손실 방지 위해 먼저 저장한다.
  // (완료한 Todo는 이 탭과 사이드바에서 빠지고, 세부화면 '완료 n건'에서 되돌릴 수 있다)
  async function completeTodo(todoId: string) {
    if (savingRef.current.has(todoId)) return
    savingRef.current.add(todoId)
    try {
      const content = (memoInputs[todoId] ?? '').trim()
      if (content) await supabase.from('todo_memos').insert({ todo_id: todoId, content })
      await supabase.from('todos').update({ status: 'done' }).eq('id', todoId)
      setMemoInputs((m) => ({ ...m, [todoId]: '' }))
      void refresh()
    } finally {
      savingRef.current.delete(todoId)
    }
  }

  // 확인 — 새 진행사항을 봤다고 기록. 사이드바 '업데이트'에서 빠진다(상태는 그대로 진행 중).
  async function reviewTodo(todoId: string, latestMemoAt: string | null) {
    if (!latestMemoAt) return
    if (await markReviewed(todoId, latestMemoAt)) void load()
  }
  // 저장된 메모 수정/삭제 (연필 버튼에서 진입)
  async function updateMemo(memoId: string, content: string) {
    const c = content.trim()
    if (!c) return
    await supabase.from('todo_memos').update({ content: c }).eq('id', memoId)
    setEditingMemo(null)
    void refresh()
  }
  // Todo 내용(제목) 수정 — 연필 버튼에서 진입. 상태·담당자·PJT는 Task 창에서 바꾼다.
  async function updateTodoTitle(todoId: string, title: string) {
    const t = title.trim()
    if (!t) return
    await supabase.from('todos').update({ title: t }).eq('id', todoId)
    setEditingTodo(null)
    void refresh()
  }
  async function deleteMemo(memoId: string) {
    if (!confirm('이 메모를 삭제할까요?')) return
    await supabase.from('todo_memos').delete().eq('id', memoId)
    setEditingMemo(null)
    void refresh()
  }

  // 정렬은 Task 작성일 최신순 고정 (정렬 드롭박스는 제거됨). task_date 는 YYYY-MM-DD 라 문자열 비교로 충분하다.
  // 그룹의 대표 날짜 = 그룹 내 가장 최근 Task 작성일
  function groupDate(todos: { taskDate: string }[]): string {
    return todos.reduce((acc, t) => ((t.taskDate ?? '') > acc ? t.taskDate : acc), '')
  }
  // 그룹·그룹 내 Todo를 Task 작성일 최신순으로 ('미지정'은 항상 맨 아래)
  function sortGroups(groups: Group[]): Group[] {
    return groups
      .map((g) => ({
        ...g,
        todos: [...g.todos].sort((a, b) => (b.taskDate ?? '').localeCompare(a.taskDate ?? '')),
      }))
      .sort((a, b) => {
        if (a.pinLast !== b.pinLast) return a.pinLast ? 1 : -1
        return b.sortDate.localeCompare(a.sortDate)
      })
  }

  function buildGroups(): Group[] {
    // 진행 중인 Todo는 한 구간에 모인다 ('체크됨' 구간은 폐지 — migrations/011). 완료분은 최근 활동 보기 전용.
    const filtered = items.filter(
      (it) => it.status === 'published' && (filter === 'all' || it.divisionId === filter),
    )
    const status = 'open'
    if (view === 'pjt') {
      // PJT 단위 아코디언 — 기준은 todo.project_id(Todo가 속한 PJT, Task의 PJT가 아님)
      const order: { id: string; name: string }[] = []
      filtered.forEach((it) => {
        if (!order.some((o) => o.id === it.todoProjectId))
          order.push({ id: it.todoProjectId, name: it.todoProjectName })
      })
      return sortGroups(
        order.map((pjt) => {
          const todos = filtered.filter((it) => it.todoProjectId === pjt.id)
          return {
            key: `j:${status}:${pjt.id}`,
            name: pjt.name,
            metaLine: '',
            count: todos.length,
            sortDate: groupDate(todos),
            todos: todos.map((it) => ({
              ...it,
              metaLabel: '담당',
              metaValue: it.assignees.join(', ') || '—',
            })),
          }
        }),
      )
    }
    if (view === 'person') {
      const people: string[] = []
      filtered.forEach((it) => it.assignees.forEach((p) => !people.includes(p) && people.push(p)))
      const groups: Group[] = people
        .map((person) => {
          const todos = filtered.filter((it) => it.assignees.includes(person))
          return {
            key: `p:${status}:${person}`,
            name: person,
            metaLine: '',
            count: todos.length,
            sortDate: groupDate(todos),
            todos: todos.map((it) => ({ ...it, metaLabel: 'PJT', metaValue: it.todoProjectName })),
          }
        })
        .filter((g) => g.todos.length > 0)
      // 담당자가 없는 Todo는 '미지정' 그룹으로 (숨지 않도록)
      const unassigned = filtered.filter((it) => it.assignees.length === 0)
      if (unassigned.length) {
        groups.push({
          key: `p:${status}:__none__`,
          name: '미지정',
          metaLine: '',
          count: unassigned.length,
          sortDate: groupDate(unassigned),
          pinLast: true,
          todos: unassigned.map((it) => ({ ...it, metaLabel: 'PJT', metaValue: it.todoProjectName })),
        })
      }
      return sortGroups(groups)
    }
    // task view
    const order: string[] = []
    filtered.forEach((it) => !order.includes(it.taskId) && order.push(it.taskId))
    return sortGroups(
      order.map((tid) => {
        const todos = filtered.filter((it) => it.taskId === tid)
        const first = todos[0]
        return {
          key: `t:${status}:${tid}`,
          name: first.taskTitle,
          metaLine: `(작성 ${md(first.taskDate)}) — ${first.taskProjectName}`,
          count: todos.length,
          sortDate: first.taskDate ?? '',
          todos: todos.map((it) => ({
            ...it,
            metaLabel: '담당',
            metaValue: it.assignees.join(', ') || '—',
          })),
        }
      }),
    )
  }

  const unchecked = buildGroups()

  /* ---- 최근 활동: 기간 안에 메모가 저장됐거나 완료된 Todo ----
   * Todo당 한 줄. 기간 안의 마지막 메모 시각과 완료 시각 중 더 최근 것을 '활동일'로 삼아
   * 날짜별(로컬 하루)로 묶고, 날짜·행 모두 최신순. 메모 '수정'은 작성 시각이 안 바뀌므로 활동으로 치지 않는다. */
  const recentDays = (() => {
    if (view !== 'recent') return []
    const lo = dayStartMs(range.start)
    const hi = dayEndMs(range.end)
    const inRange = (iso: string | null) => {
      if (!iso) return null
      const t = new Date(iso).getTime()
      return t >= lo && t <= hi ? t : null
    }
    const rows: {
      item: TodoItem
      at: number
      memoAt: number | null
      memoText: string // 기간 안의 마지막 메모 (전체 최신 메모가 아님 — 과거 기간을 고르면 달라진다)
      doneAt: number | null
    }[] = []
    for (const it of items) {
      if (filter !== 'all' && it.divisionId !== filter) continue
      let memoAt: number | null = null
      let memoText = ''
      for (const m of it.memoRaw) {
        const t = inRange(m.at)
        if (t !== null && (memoAt === null || t > memoAt)) {
          memoAt = t
          memoText = m.content
        }
      }
      const doneAt = it.status === 'done' ? inRange(it.doneAt) : null
      if (memoAt === null && doneAt === null) continue
      rows.push({ item: it, at: Math.max(memoAt ?? 0, doneAt ?? 0), memoAt, memoText, doneAt })
    }
    rows.sort((a, b) => b.at - a.at)
    const days: { ymd: string; label: string; rows: typeof rows }[] = []
    for (const r of rows) {
      const d = new Date(r.at)
      const ymd = ymdLocal(d)
      let day = days.find((x) => x.ymd === ymd)
      if (!day) {
        day = { ymd, label: `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`, rows: [] }
        days.push(day)
      }
      day.rows.push(r)
    }
    return days
  })()

  // 점프 대상 — 사이드바(prop) 우선, 없으면 최근 활동 행 클릭(local)
  const focusId = focusTodoId ?? localFocus

  // 점프해 오면: (PJT별로 전환) → 그룹 펼치기 → 스크롤 → 잠시 강조
  useEffect(() => {
    if (!focusId || loading) return
    // 점프는 항상 PJT별에서 받는다 — 최근 활동 등 다른 보기에선 대상이 화면에 없을 수 있다.
    // 보기를 바꾸면 그룹이 다시 계산되므로 여기서 멈추고 다음 렌더에서 이어간다.
    if (view !== 'pjt') {
      setView('pjt')
      return
    }
    const target = items.find((it) => it.id === focusId && it.status === 'published')
    if (!target) {
      // 완료돼서 이 탭에 없는 Todo — 갈 곳이 없으니 요청만 정리한다
      if (focusTodoId) onFocusDone?.()
      else setLocalFocus(null)
      return
    }
    // 해당 Todo가 들어 있는 그룹을 펼친다 (접힘 상태를 명시적으로 해제)
    const keys = unchecked
      .filter((g) => g.todos.some((t) => t.id === focusId))
      .map((g) => g.key)
    if (keys.length) {
      setCollapsed((c) => {
        const next = { ...c }
        keys.forEach((k) => delete next[k])
        return next
      })
    }
    setHighlightId(focusId)
    // 그룹을 방금 펼쳤거나 탭이 막 마운트된 경우 DOM 반영이 늦으므로 여러 번 재시도한다.
    // behavior:'smooth' 는 렌더가 멈춘 탭에서 스크롤이 아예 일어나지 않아 쓰지 않는다.
    //
    // 타이머는 이 effect 의 cleanup 으로 지우면 안 된다 — 바로 아래 onFocusDone() 이
    // 부모의 focusTodoId 를 null 로 만들어 effect 가 재실행되고, 그 cleanup 이
    // 스크롤 재시도를 전부 취소해 버린다(= 스크롤이 안 되던 원인). 언마운트 때만 정리한다.
    ;[0, 60, 180, 400, 800, 1400].forEach((ms) => {
      focusTimersRef.current.push(
        window.setTimeout(() => todoRefs.current[focusId]?.scrollIntoView({ block: 'center' }), ms),
      )
    })
    focusTimersRef.current.push(window.setTimeout(() => setHighlightId(null), 2600))
    if (focusTodoId) onFocusDone?.()
    else setLocalFocus(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loading, items, view])

  // 점프용 타이머는 언마운트 시에만 정리
  useEffect(() => () => focusTimersRef.current.forEach(clearTimeout), [])
  const isOpen = (key: string) => !collapsed[key]
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const ctrlLabel: React.CSSProperties = { fontSize: '11px', color: '#8A877F', whiteSpace: 'nowrap' }
  const selectStyle: React.CSSProperties = {
    fontFamily: 'inherit',
    fontSize: '12px',
    color: '#1F1E1B',
    background: '#fff',
    border: '1px solid #CFCDC7',
    borderRadius: 8,
    padding: '6px 10px',
    cursor: 'pointer',
    outline: 'none',
  }
  const seg = (active: boolean, left: boolean): React.CSSProperties => ({
    border: 0,
    borderLeft: left ? '1px solid #CFCDC7' : undefined,
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 600,
    padding: '6px 14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    background: active ? '#185FA5' : '#fff',
    color: active ? '#fff' : '#55534E',
  })

  return (
    <div style={{ padding: '16px 28px 32px' }}>
      {loading ? (
        <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
      ) : (
        <>
          {/* 상단: [보기 기준] → [기간(최근 활동일 때만)] → [구분 드롭박스] (좌→우). 정렬 드롭박스는 제거(최신순 고정) */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <div className="flex flex-shrink-0 items-center gap-[7px]">
              <span style={{ fontSize: '11px', color: '#8A877F', whiteSpace: 'nowrap' }}>보기 기준</span>
              <div style={{ display: 'flex', border: '1px solid #CFCDC7', borderRadius: 8, overflow: 'hidden' }}>
                <button style={seg(view === 'pjt', false)} onClick={() => setView('pjt')}>
                  PJT별
                </button>
                <button style={seg(view === 'task', true)} onClick={() => setView('task')}>
                  Task별
                </button>
                <button style={seg(view === 'person', true)} onClick={() => setView('person')}>
                  담당자별
                </button>
                <button style={seg(view === 'recent', true)} onClick={() => setView('recent')}>
                  최근 활동
                </button>
              </div>
            </div>
            {view === 'recent' && (
              <div className="flex flex-shrink-0 items-center gap-[7px]">
                <span style={ctrlLabel}>기간</span>
                <input
                  type="date"
                  value={range.start}
                  max={range.end}
                  onChange={(e) => e.target.value && setRange((r) => ({ ...r, start: e.target.value }))}
                  style={selectStyle}
                />
                <span style={ctrlLabel}>~</span>
                <input
                  type="date"
                  value={range.end}
                  min={range.start}
                  onChange={(e) => e.target.value && setRange((r) => ({ ...r, end: e.target.value }))}
                  style={selectStyle}
                />
                <button
                  onClick={() => setRange(defaultRange())}
                  title={`오늘 포함 최근 ${RECENT_DAYS}일로`}
                  style={{ ...selectStyle, color: '#55534E' }}
                >
                  최근 {RECENT_DAYS}일
                </button>
              </div>
            )}
            <div className="flex flex-shrink-0 items-center gap-[7px]">
              <span style={ctrlLabel}>구분</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value)} style={selectStyle}>
                <option value="all">전체</option>
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {view === 'recent' ? (
            /* ---- 최근 활동: 날짜별 타임라인 (읽기 전용) ----
             * 진행 중 행을 누르면 PJT별로 넘어가 그 Todo로 이동한다(거기서 메모·완료·확인).
             * 완료 행은 이 탭에 갈 곳이 없어 누르지 않는다(완료 취소는 세부화면 '완료' 목록에서). */
            <div>
              {!doneTracked && (
                <div style={{ fontSize: '11.5px', color: '#8A877F', background: '#FAEEDA', border: '1px solid #E0C9A6', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
                  완료 기록이 아직 없습니다 — <b>migrations/012-todo-done-at.sql</b> 을 적용하면 그 이후 완료한 일부터 함께 표시됩니다. 지금은 진행사항 메모만 보입니다.
                </div>
              )}
              {recentDays.length === 0 && (
                <div style={{ fontSize: '12px', color: '#B4B1A9', padding: '6px 2px' }}>
                  이 기간에 진행사항 메모나 완료된 일이 없습니다.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {recentDays.map((day) => (
                  <div key={day.ymd}>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1F1E1B', marginBottom: 6 }}>
                      {day.label} <span style={{ fontWeight: 400, color: '#B4B1A9' }}>· {day.rows.length}건</span>
                    </div>
                    <div style={{ border: '1px solid #E2E0DB', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                      {day.rows.map(({ item, memoAt, memoText, doneAt }, i) => {
                        const isDone = doneAt !== null && (memoAt === null || doneAt >= memoAt)
                        const clickable = item.status === 'published'
                        return (
                          <div
                            key={item.id}
                            role={clickable ? 'button' : undefined}
                            tabIndex={clickable ? 0 : undefined}
                            onClick={clickable ? () => setLocalFocus(item.id) : undefined}
                            onKeyDown={clickable ? (e) => e.key === 'Enter' && setLocalFocus(item.id) : undefined}
                            title={clickable ? '클릭: PJT별 보기에서 이 Todo로 이동' : undefined}
                            className={clickable ? 'hover:bg-sidebar-bg' : ''}
                            style={{ padding: '9px 12px', borderTop: i ? '1px solid #F0EEEA' : 0, cursor: clickable ? 'pointer' : 'default' }}
                          >
                            <div className="flex items-center justify-between gap-2.5">
                              <span className="flex min-w-0 items-center gap-2" style={{ fontSize: '12.5px' }}>
                                <span
                                  style={{
                                    flex: '0 0 auto', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 4,
                                    ...(isDone
                                      ? { background: '#E1F5EE', color: '#085041', border: '1px solid #B7E3D3' }
                                      : { background: '#E6F1FB', color: '#0C447C', border: '1px solid #B8D4EF' }),
                                  }}
                                >
                                  {isDone ? '완료' : '메모'}
                                </span>
                                <span className="min-w-0 truncate" style={{ color: item.status === 'done' ? '#8A877F' : '#1F1E1B' }}>
                                  {item.title}
                                </span>
                              </span>
                              <span style={{ flex: '0 0 auto', fontSize: '11px', color: '#8A877F', whiteSpace: 'nowrap' }}>
                                {item.todoProjectName}
                                {item.assignees.length > 0 && ` · ${item.assignees.join(', ')}`}
                              </span>
                            </div>
                            {/* 기간 안에 메모가 있었으면 그 메모 한 줄 (완료와 메모가 같이 있으면 둘 다 보인다) */}
                            {memoAt !== null && memoText && (
                              <div className="truncate" style={{ fontSize: '11.5px', color: '#8A877F', marginTop: 4, paddingLeft: 2 }}>
                                {isDone && <span style={{ color: '#B4B1A9', marginRight: 6 }}>메모 {md(new Date(memoAt).toISOString())}</span>}
                                {memoText}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
          {/* 미진행 Todo */}
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#633806', marginBottom: 10 }}>
            미진행 Todo
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
            {unchecked.length === 0 && (
              <div style={{ fontSize: '12px', color: '#B4B1A9', padding: '6px 2px' }}>미진행 Todo가 없습니다.</div>
            )}
            {unchecked.map((g) => (
              <div key={g.key} style={{ border: '1px solid #E0C9A6', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  onClick={() => toggle(g.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    background: '#FAEEDA',
                    border: 0,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: '10px 13px',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0, fontSize: '13px', color: '#633806' }}>
                    <span style={{ display: 'inline-block', width: 14, marginRight: 4 }}>
                      {isOpen(g.key) ? '▾' : '▸'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{g.name}</span>{' '}
                    <span style={{ opacity: 0.75 }}>{g.metaLine}</span>
                  </span>
                  <span style={{ flex: '0 0 auto', fontSize: '11.5px', color: '#633806', whiteSpace: 'nowrap' }}>
                    미진행 {g.count}건
                  </span>
                </button>
                {isOpen(g.key) && (
                  <div style={{ padding: '2px 13px 12px', background: '#fff' }}>
                    {g.todos.map((td) => (
                      <div
                        key={td.id}
                        ref={(el) => (todoRefs.current[td.id] = el)}
                        style={{
                          paddingTop: 11,
                          ...(highlightId === td.id
                            ? {
                                background: '#E6F1FB',
                                boxShadow: '0 0 0 2px #185FA5',
                                borderRadius: 8,
                                // 축약형(padding)을 쓰면 기본 paddingTop 과 섞여, 강조가 풀릴 때
                                // React 가 여백을 제대로 되돌리지 못한다 — 개별 속성만 쓴다
                                paddingRight: 9,
                                paddingBottom: 9,
                                paddingLeft: 9,
                                marginLeft: -9,
                                marginRight: -9,
                              }
                            : null),
                        }}
                      >
                        <div className="mb-[7px] flex items-center justify-between gap-2.5">
                          <span style={{ minWidth: 0, fontSize: '12.5px', color: '#1F1E1B' }} className="flex min-w-0 flex-1 items-center gap-2">
                            {td.unreviewed && <UpdateBadge />}
                            {editingTodo?.id === td.id ? (
                              <>
                                <input
                                  value={editingTodo.title}
                                  onChange={(e) => setEditingTodo({ id: td.id, title: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') updateTodoTitle(td.id, editingTodo.title)
                                    if (e.key === 'Escape') setEditingTodo(null)
                                  }}
                                  autoFocus
                                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid #CFCDC7', borderRadius: 8, padding: '5px 9px', fontSize: '12.5px', fontFamily: 'inherit', color: '#1F1E1B' }}
                                />
                                <button
                                  onClick={() => updateTodoTitle(td.id, editingTodo.title)}
                                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #CFCDC7', background: '#fff', color: '#55534E', cursor: 'pointer', fontFamily: 'inherit', fontSize: '11.5px', fontWeight: 600, borderRadius: 7, padding: '4px 11px' }}
                                >
                                  저장
                                </button>
                                <button
                                  onClick={() => setEditingTodo(null)}
                                  title="취소"
                                  style={{ flex: '0 0 auto', border: 0, background: 'transparent', color: '#B4B1A9', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}
                                >
                                  ✕
                                </button>
                              </>
                            ) : (
                              <>
                                <span className="min-w-0">{td.title}</span>
                                <button
                                  onClick={() => setEditingTodo({ id: td.id, title: td.title })}
                                  title="Todo 내용 수정"
                                  style={{ flex: '0 0 auto', border: 0, background: 'transparent', cursor: 'pointer', fontSize: '11px', padding: '0 2px', lineHeight: 1, opacity: 0.65 }}
                                >
                                  ✏️
                                </button>
                              </>
                            )}
                          </span>
                          <span style={{ flex: '0 0 auto', fontSize: '11px', color: '#8A877F', whiteSpace: 'nowrap' }}>
                            {td.metaLabel}: {td.metaValue}
                          </span>
                        </div>
                        {td.memos.length > 0 && (
                          <div className="mb-[7px] pl-[22px]" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {td.memos.map((mo) =>
                              editingMemo?.id === mo.id ? (
                                <div key={mo.id} className="flex gap-1.5 items-center">
                                  <input
                                    value={editingMemo.content}
                                    onChange={(e) => setEditingMemo({ id: mo.id, content: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') updateMemo(mo.id, editingMemo.content)
                                      if (e.key === 'Escape') setEditingMemo(null)
                                    }}
                                    autoFocus
                                    style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid #CFCDC7', borderRadius: 8, padding: '5px 9px', fontSize: '12px', fontFamily: 'inherit', color: '#1F1E1B' }}
                                  />
                                  <button
                                    onClick={() => updateMemo(mo.id, editingMemo.content)}
                                    style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #CFCDC7', background: '#fff', color: '#55534E', cursor: 'pointer', fontFamily: 'inherit', fontSize: '11.5px', fontWeight: 600, borderRadius: 7, padding: '4px 11px' }}
                                  >
                                    저장
                                  </button>
                                  <button
                                    onClick={() => deleteMemo(mo.id)}
                                    style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #E4B8B8', background: '#fff', color: '#A32D2D', cursor: 'pointer', fontFamily: 'inherit', fontSize: '11.5px', fontWeight: 600, borderRadius: 7, padding: '4px 11px' }}
                                  >
                                    삭제
                                  </button>
                                  <button
                                    onClick={() => setEditingMemo(null)}
                                    title="취소"
                                    style={{ flex: '0 0 auto', border: 0, background: 'transparent', color: '#B4B1A9', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div key={mo.id} className="flex items-center gap-1.5" style={{ fontSize: '11.5px', color: '#8A877F', lineHeight: 1.4 }}>
                                  <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ color: '#B4B1A9', marginRight: 6 }}>{mo.date}</span>
                                    {mo.content}
                                  </span>
                                  <button
                                    onClick={() => setEditingMemo({ id: mo.id, content: mo.content })}
                                    title="메모 수정"
                                    style={{ flex: '0 0 auto', border: 0, background: 'transparent', cursor: 'pointer', fontSize: '11px', padding: '0 2px', lineHeight: 1, opacity: 0.65 }}
                                  >
                                    ✏️
                                  </button>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                        <div className="pl-[22px]" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div className="flex gap-1.5">
                            <input
                              value={memoInputs[td.id] ?? ''}
                              onChange={(e) => setMemoInputs((m) => ({ ...m, [td.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && saveMemo(td.id)}
                              placeholder="진행사항 메모 입력…"
                              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid #CFCDC7', borderRadius: 8, padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit', color: '#1F1E1B' }}
                            />
                            <button
                              onClick={() => saveMemo(td.id)}
                              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #CFCDC7', background: '#fff', color: '#55534E', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '0 16px' }}
                            >
                              저장
                            </button>
                          </div>
                          <div className="flex justify-end gap-1.5">
                            {/* 확인 = 새 진행사항을 봤다(사이드바 '업데이트'에서 빠짐). 상태는 그대로 진행 중 */}
                            {td.unreviewed && (
                              <button
                                onClick={() => reviewTodo(td.id, td.latestMemoAt)}
                                title="새 진행사항을 확인했습니다 — 업데이트 목록에서 빠집니다"
                                style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #185FA5', background: '#fff', color: '#185FA5', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '6px 16px' }}
                              >
                                확인
                              </button>
                            )}
                            {/* 완료 = 진행 단계 종료(published → done) */}
                            <button
                              onClick={() => completeTodo(td.id)}
                              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #085041', background: '#085041', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '6px 18px' }}
                            >
                              완료
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
