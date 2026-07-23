import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { MY_NAME } from '../lib/config'
import type { Division } from '../types'

type ViewMode = 'task' | 'mine' | 'person'
// 이 탭에 노출되는 Todo 상태: published(미진행 구간) | checked(체크됨 구간). draft 미노출, done 제거.
type ShownStatus = 'published' | 'checked'

interface TodoItem {
  id: string
  title: string
  status: ShownStatus
  taskId: string
  taskTitle: string
  taskDate: string
  taskProjectName: string
  todoProjectName: string
  divisionId: string
  assignees: string[]
  latestMemo: { content: string; date: string } | null
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
        projects: { name: string; division_id: string } | null
        todo_assignees: { people: { name: string } | null }[] | null
        todo_memos: { content: string; created_at: string }[] | null
      }[]
    | null
}

interface Group {
  key: string
  name: string
  metaLine: string
  count: number
  todos: (TodoItem & { metaLabel: string; metaValue: string })[]
}

const md = (d: string | null) => {
  if (!d) return ''
  const [, m, day] = d.slice(0, 10).split('-')
  return `${+m}/${+day}`
}

// 단일 상태 뱃지 (Todo 자체 상태 기준): 배포(published) → 체크(checked)
function StatusBadge({ status }: { status: ShownStatus }) {
  const s =
    status === 'checked'
      ? { bg: '#E6F1FB', fg: '#0C447C', bd: '#B8D4EF', label: '체크' }
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

export default function TodoCheckTab() {
  const [items, setItems] = useState<TodoItem[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all') // division id | 'all'
  const [view, setView] = useState<ViewMode>('task')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [memoInputs, setMemoInputs] = useState<Record<string, string>>({})
  const savingRef = useRef<Set<string>>(new Set()) // 저장&체크 연타 방지

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [{ data: divData }, { data: taskData }] = await Promise.all([
        supabase.from('divisions').select('*').order('sort_order'),
        // 노출 기준: todos.status in ('published','checked') — draft 미노출, done 제거
        supabase
          .from('tasks')
          .select(
            'id, title, task_date, projects(name), todos(id, title, status, projects(name, division_id), todo_assignees(people(name)), todo_memos(content, created_at))',
          ),
      ])
      setDivisions((divData as Division[]) ?? [])

      const flat: TodoItem[] = []
      for (const t of (taskData as unknown as RawTask[]) ?? []) {
        for (const td of t.todos ?? []) {
          if (td.status !== 'published' && td.status !== 'checked') continue
          const memos = (td.todo_memos ?? [])
            .slice()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
          flat.push({
            id: td.id,
            title: td.title,
            status: td.status,
            taskId: t.id,
            taskTitle: t.title,
            taskDate: t.task_date,
            taskProjectName: t.projects?.name ?? '(프로젝트 없음)',
            todoProjectName: td.projects?.name ?? '(프로젝트 없음)',
            divisionId: td.projects?.division_id ?? '',
            assignees: (td.todo_assignees ?? []).map((a) => a.people?.name).filter(Boolean) as string[],
            latestMemo: memos[0] ? { content: memos[0].content, date: md(memos[0].created_at) } : null,
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

  async function saveMemo(todoId: string) {
    // 연타로 메모가 중복 저장되는 것 방지
    if (savingRef.current.has(todoId)) return
    savingRef.current.add(todoId)
    try {
      // 메모는 선택 — 비어 있어도 '저장 & 체크'만으로 체크로 이동 (배포/미배포 무관)
      const content = (memoInputs[todoId] ?? '').trim()
      if (content) await supabase.from('todo_memos').insert({ todo_id: todoId, content })
      await supabase.from('todos').update({ status: 'checked' }).eq('id', todoId)
      setMemoInputs((m) => ({ ...m, [todoId]: '' }))
      void load()
    } finally {
      savingRef.current.delete(todoId)
    }
  }
  async function completeTodo(todoId: string) {
    await supabase.from('todos').update({ status: 'done' }).eq('id', todoId)
    void load()
  }
  async function uncheckTodo(todoId: string) {
    // 체크 해제 → 미진행(published) 복귀 (메모 이력은 유지, 배포 상태는 그대로)
    await supabase.from('todos').update({ status: 'published' }).eq('id', todoId)
    void load()
  }

  function buildGroups(status: ShownStatus): Group[] {
    let filtered = items.filter(
      (it) => it.status === status && (filter === 'all' || it.divisionId === filter),
    )
    // '나의 할 일': 담당자에 MY_NAME 이 포함된 Todo만 (그 외엔 Task별 그룹핑과 동일)
    if (view === 'mine') filtered = filtered.filter((it) => it.assignees.includes(MY_NAME))
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
          todos: unassigned.map((it) => ({ ...it, metaLabel: 'PJT', metaValue: it.todoProjectName })),
        })
      }
      return groups
    }
    // task view
    const order: string[] = []
    filtered.forEach((it) => !order.includes(it.taskId) && order.push(it.taskId))
    return order.map((tid) => {
      const todos = filtered.filter((it) => it.taskId === tid)
      const first = todos[0]
      return {
        key: `t:${status}:${tid}`,
        name: first.taskTitle,
        metaLine: `(작성 ${md(first.taskDate)}) — ${first.taskProjectName}`,
        count: todos.length,
        todos: todos.map((it) => ({
          ...it,
          metaLabel: '담당',
          metaValue: it.assignees.join(', ') || '—',
        })),
      }
    })
  }

  const unchecked = buildGroups('published')
  const checked = buildGroups('checked')
  const isOpen = (key: string) => !collapsed[key]
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))

  const chip = (active: boolean): React.CSSProperties => ({
    fontFamily: 'inherit',
    fontSize: '11.5px',
    borderRadius: 999,
    padding: '5px 12px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    background: active ? '#185FA5' : '#fff',
    color: active ? '#fff' : '#55534E',
    border: `1px solid ${active ? '#185FA5' : '#CFCDC7'}`,
  })
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
          {/* 상단: [보기 기준 선택] → [구분 필터 칩] (좌→우) */}
          <div className="mb-5 flex items-center gap-3">
            <div className="flex flex-shrink-0 items-center gap-[7px]">
              <span style={{ fontSize: '11px', color: '#8A877F', whiteSpace: 'nowrap' }}>보기 기준</span>
              <div style={{ display: 'flex', border: '1px solid #CFCDC7', borderRadius: 8, overflow: 'hidden' }}>
                <button style={seg(view === 'task', false)} onClick={() => setView('task')}>
                  Task별
                </button>
                <button style={seg(view === 'mine', true)} onClick={() => setView('mine')}>
                  나의 할 일
                </button>
                <button style={seg(view === 'person', true)} onClick={() => setView('person')}>
                  담당자별
                </button>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <button style={chip(filter === 'all')} onClick={() => setFilter('all')}>
                전체
              </button>
              {divisions.map((d) => (
                <button key={d.id} style={chip(filter === d.id)} onClick={() => setFilter(d.id)}>
                  {d.name}
                </button>
              ))}
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
                      <div key={td.id} style={{ paddingTop: 11 }}>
                        <div className="mb-[7px] flex items-center justify-between gap-2.5">
                          <span style={{ minWidth: 0, fontSize: '12.5px', color: '#1F1E1B' }} className="flex items-center gap-2">
                            <StatusBadge status={td.status} />
                            {td.title}
                          </span>
                          <span style={{ flex: '0 0 auto', fontSize: '11px', color: '#8A877F', whiteSpace: 'nowrap' }}>
                            {td.metaLabel}: {td.metaValue}
                          </span>
                        </div>
                        <div className="flex gap-1.5 pl-[22px]">
                          <input
                            value={memoInputs[td.id] ?? ''}
                            onChange={(e) => setMemoInputs((m) => ({ ...m, [td.id]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && saveMemo(td.id)}
                            placeholder="진행사항 메모 입력…"
                            style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', border: '1px solid #CFCDC7', borderRadius: 8, padding: '7px 10px', fontSize: '12.5px', fontFamily: 'inherit', color: '#1F1E1B' }}
                          />
                          <button
                            onClick={() => saveMemo(td.id)}
                            style={{ flex: '0 0 auto', whiteSpace: 'nowrap', border: '1px solid #CFCDC7', background: '#fff', color: '#55534E', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, borderRadius: 8, padding: '0 14px' }}
                          >
                            저장 &amp; 체크
                          </button>
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
                      <div key={td.id} style={{ paddingTop: 11 }}>
                        <div className="mb-[7px] flex items-center justify-between gap-2.5">
                          <span style={{ minWidth: 0, fontSize: '12.5px', color: '#1F1E1B' }} className="flex items-center gap-2">
                            <StatusBadge status={td.status} />
                            {td.title}
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
