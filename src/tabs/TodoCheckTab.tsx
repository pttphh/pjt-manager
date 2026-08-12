import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emitDataChanged } from '../lib/events'
import { MY_NAME } from '../lib/config'
import type { Division, TodoStatus } from '../types'

type ViewMode = 'pjt' | 'task' | 'person'
// 정렬: Task 작성일 기준 최신순/오래된순
type SortOrder = 'newest' | 'oldest'
/** 이 탭에 노출되는 Todo 상태.
 *  미진행 구간 = draft | published, 체크됨 구간 = checked. done 은 제거.
 *  draft 는 원래 미노출이지만 **담당자가 MY_NAME 인 Todo만 예외로 노출**한다
 *  (자기 자신에게 배포할 이유가 없으므로 — 사이드바 '나의 할 일'과 짝을 이룬다). */
type ShownStatus = 'draft' | 'published' | 'checked'
type Section = 'open' | 'checked'

interface TodoItem {
  id: string
  title: string
  status: ShownStatus
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

// 단일 상태 뱃지 (Todo 자체 상태 기준): 미배포(draft) → 배포(published) → 체크(checked)
function StatusBadge({ status }: { status: ShownStatus }) {
  const s =
    status === 'checked'
      ? { bg: '#E6F1FB', fg: '#0C447C', bd: '#B8D4EF', label: '체크' }
      : status === 'draft'
        ? { bg: '#F1F0EC', fg: '#55534E', bd: '#DAD8D2', label: '미배포' }
        : { bg: '#E1F5EE', fg: '#085041', bd: '#B7E3D3', label: '배포' }
  return (
    <span
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.bd}`,
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
      }}
    >
      {s.label}
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
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest') // Task 작성일 기준 정렬
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
        // 노출 기준: published·checked 전부 + draft 는 담당자가 MY_NAME 인 것만. done 제거.
        supabase
          .from('tasks')
          .select(
            'id, title, task_date, projects(name), todos(id, title, status, projects(id, name, division_id), todo_assignees(people(name)), todo_memos(id, content, created_at))',
          ),
      ])
      setDivisions((divData as Division[]) ?? [])

      const flat: TodoItem[] = []
      for (const t of (taskData as unknown as RawTask[]) ?? []) {
        for (const td of t.todos ?? []) {
          const assignees = (td.todo_assignees ?? [])
            .map((a) => a.people?.name)
            .filter(Boolean) as string[]
          // draft 는 내 담당일 때만 노출 (자기 자신에게 배포할 이유가 없으므로)
          const shown =
            td.status === 'published' ||
            td.status === 'checked' ||
            (td.status === 'draft' && assignees.includes(MY_NAME))
          if (!shown) continue
          const memos = (td.todo_memos ?? [])
            .slice()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
          flat.push({
            id: td.id,
            title: td.title,
            status: td.status as ShownStatus,
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
          })
        }
      }
      setItems(flat)
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
  // 상태 변경 공용 — migrations/010(checked_at) 미적용 시에도 깨지지 않도록 폴백
  async function setTodoStatus(todoId: string, status: TodoStatus, checkedAt?: string | null) {
    const patch = checkedAt === undefined ? { status } : { status, checked_at: checkedAt }
    const { error } = await supabase.from('todos').update(patch).eq('id', todoId)
    if (error && (error.code === 'PGRST204' || error.code === '42703')) {
      await supabase.from('todos').update({ status }).eq('id', todoId)
    }
  }

  // 체크(상태 변경) — 저장과 분리. 입력 중이던 메모가 있으면 데이터 손실 방지 위해 함께 저장.
  async function checkTodo(todoId: string) {
    if (savingRef.current.has(todoId)) return
    savingRef.current.add(todoId)
    try {
      const content = (memoInputs[todoId] ?? '').trim()
      if (content) await supabase.from('todo_memos').insert({ todo_id: todoId, content })
      // 체크를 거쳤음을 기록 → 나중에 완료를 해제하면 메모 유무와 무관하게 checked 로 복귀
      await setTodoStatus(todoId, 'checked', new Date().toISOString())
      setMemoInputs((m) => ({ ...m, [todoId]: '' }))
      void refresh()
    } finally {
      savingRef.current.delete(todoId)
    }
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
  async function completeTodo(todoId: string) {
    // checked_at 은 그대로 둔다 — 완료를 해제하면 다시 checked 로 돌아가야 하므로
    await setTodoStatus(todoId, 'done')
    void refresh()
  }
  async function uncheckTodo(todoId: string) {
    // 체크 해제 → 미진행(published) 복귀. 체크 이력도 지운다(메모 이력·배포 상태는 유지)
    await setTodoStatus(todoId, 'published', null)
    void refresh()
  }

  // 그룹의 대표 날짜: 최신순이면 그룹 내 최대 날짜, 오래된순이면 최소 날짜
  function groupDate(todos: { taskDate: string }[]): string {
    return todos.reduce((acc, t) => {
      const d = t.taskDate ?? ''
      if (!acc) return d
      if (sortOrder === 'oldest') return d && d < acc ? d : acc
      return d > acc ? d : acc
    }, '')
  }
  // 그룹·그룹 내 Todo를 Task 작성일로 정렬 ('미지정'은 항상 맨 아래)
  function sortGroups(groups: Group[]): Group[] {
    const dir = sortOrder === 'oldest' ? 1 : -1
    return groups
      .map((g) => ({
        ...g,
        todos: [...g.todos].sort((a, b) => dir * (a.taskDate ?? '').localeCompare(b.taskDate ?? '')),
      }))
      .sort((a, b) => {
        if (a.pinLast !== b.pinLast) return a.pinLast ? 1 : -1
        return dir * a.sortDate.localeCompare(b.sortDate)
      })
  }

  function buildGroups(section: Section): Group[] {
    // 미진행 구간 = draft(내 담당만 로드됨) + published, 체크됨 구간 = checked
    const inSection = (s: ShownStatus) => (section === 'checked' ? s === 'checked' : s !== 'checked')
    const filtered = items.filter(
      (it) => inSection(it.status) && (filter === 'all' || it.divisionId === filter),
    )
    const status = section
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

  const unchecked = buildGroups('open')
  const checked = buildGroups('checked')

  // 사이드바에서 점프해 오면: 그룹 펼치기 → 스크롤 → 잠시 강조
  useEffect(() => {
    if (!focusTodoId || loading) return
    const target = items.find((it) => it.id === focusTodoId)
    if (!target) return
    // 해당 Todo가 들어 있는 그룹을 펼친다 (접힘 상태를 명시적으로 해제)
    const keys = [...unchecked, ...checked]
      .filter((g) => g.todos.some((t) => t.id === focusTodoId))
      .map((g) => g.key)
    if (keys.length) {
      setCollapsed((c) => {
        const next = { ...c }
        keys.forEach((k) => delete next[k])
        return next
      })
    }
    setHighlightId(focusTodoId)
    onFocusDone?.()
    // 그룹을 방금 펼친 경우 DOM 반영이 한 박자 늦으므로 몇 번 재시도한다.
    // behavior:'smooth' 는 탭이 화면에 없거나 렌더가 멈춘 상황에서 스크롤이 아예 일어나지 않아 쓰지 않는다.
    const tries = [0, 60, 180, 400].map((ms) =>
      setTimeout(() => todoRefs.current[focusTodoId]?.scrollIntoView({ block: 'center' }), ms),
    )
    const timer = setTimeout(() => setHighlightId(null), 2600)
    return () => {
      tries.forEach(clearTimeout)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTodoId, loading, items])
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
          {/* 상단: [보기 기준] → [정렬 드롭박스] → [구분 드롭박스] (좌→우) */}
          <div className="mb-5 flex items-center gap-3">
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
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-[7px]">
              <span style={ctrlLabel}>정렬</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                style={selectStyle}
                title="Task 작성일 기준"
              >
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
              </select>
            </div>
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
                                padding: '11px 9px 9px',
                                margin: '0 -9px',
                              }
                            : null),
                        }}
                      >
                        <div className="mb-[7px] flex items-center justify-between gap-2.5">
                          <span style={{ minWidth: 0, fontSize: '12.5px', color: '#1F1E1B' }} className="flex min-w-0 flex-1 items-center gap-2">
                            <StatusBadge status={td.status} />
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
                          <div className="flex justify-end">
                            <button
                              onClick={() => checkTodo(td.id)}
                              style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #185FA5', background: '#185FA5', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '6px 18px' }}
                            >
                              체크
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

          <div style={{ borderTop: '1px solid #E2E0DB', marginBottom: 18 }} />

          {/* 체크됨 */}
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#1F1E1B', marginBottom: 10 }}>
            체크됨 <span style={{ fontWeight: 400, color: '#B4B1A9' }}>(진행 중)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checked.length === 0 && (
              <div style={{ fontSize: '12px', color: '#B4B1A9', padding: '6px 2px' }}>체크된 Todo가 없습니다.</div>
            )}
            {checked.map((g) => (
              <div key={g.key} style={{ border: '1px solid #E2E0DB', borderRadius: 10, overflow: 'hidden' }}>
                <button
                  onClick={() => toggle(g.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    background: '#F5F4F0',
                    border: 0,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    padding: '10px 13px',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ minWidth: 0, fontSize: '13px', color: '#1F1E1B' }}>
                    <span style={{ display: 'inline-block', width: 14, marginRight: 4, color: '#55534E' }}>
                      {isOpen(g.key) ? '▾' : '▸'}
                    </span>
                    <span style={{ fontWeight: 600 }}>{g.name}</span>{' '}
                    <span style={{ color: '#8A877F' }}>{g.metaLine}</span>
                  </span>
                  <span style={{ flex: '0 0 auto', fontSize: '11.5px', color: '#8A877F', whiteSpace: 'nowrap' }}>
                    체크 {g.count}건
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
                                padding: '11px 9px 9px',
                                margin: '0 -9px',
                              }
                            : null),
                        }}
                      >
                        <div className="mb-[7px] flex items-center justify-between gap-2.5">
                          <span style={{ minWidth: 0, fontSize: '12.5px', color: '#1F1E1B' }} className="flex min-w-0 flex-1 items-center gap-2">
                            <StatusBadge status={td.status} />
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
                        <div className="flex items-center gap-2 pl-[22px]">
                          <span style={{ flex: 1, minWidth: 0, background: '#F5F4F0', borderRadius: 8, padding: '7px 10px', fontSize: '12px', color: '#55534E' }}>
                            {td.latestMemo ? (
                              <>
                                <span style={{ color: '#8A877F' }}>{td.latestMemo.date}</span> — {td.latestMemo.content}
                              </>
                            ) : (
                              <span style={{ color: '#8A877F' }}>메모 없음</span>
                            )}
                          </span>
                          <button
                            onClick={() => uncheckTodo(td.id)}
                            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #CFCDC7', background: '#fff', color: '#55534E', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '6px 12px' }}
                          >
                            체크 해제
                          </button>
                          <button
                            onClick={() => completeTodo(td.id)}
                            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #9CC9B8', background: '#fff', color: '#085041', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '6px 12px' }}
                          >
                            ✓ 완료로 변경
                          </button>
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
    </div>
  )
}
