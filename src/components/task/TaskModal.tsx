import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button'
import TagInput from '../ui/TagInput'
import { supabase } from '../../lib/supabase'
import type { Person } from '../../types'

interface TaskModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  projectId: string
  projectName: string
  divisionId: string
  /** 있으면 기존 Task 편집, 없으면 신규. */
  taskId?: string | null
}

interface TodoRow {
  key: string
  id?: string
  title: string
  assigneeIds: string[]
  projectId: string
}
interface PjtOpt {
  id: string
  name: string
}

const todayStr = () => new Date().toISOString().slice(0, 10)

// 변경 감지용 스냅샷 (닫을 때 dirty 여부 판단)
function snapshotOf(
  title: string,
  taskDate: string,
  decisions: string,
  links: string[],
  members: Person[],
  todos: TodoRow[],
): string {
  return JSON.stringify({
    title: title.trim(),
    taskDate,
    decisions,
    links: links.map((l) => l.trim()).filter(Boolean),
    members: members.map((m) => m.id).sort(),
    todos: todos.map((t) => ({
      id: t.id ?? null,
      title: t.title.trim(),
      projectId: t.projectId,
      a: [...t.assigneeIds].sort(),
    })),
  })
}

export default function TaskModal({
  open,
  onClose,
  onSaved,
  projectId,
  projectName,
  divisionId,
  taskId,
}: TaskModalProps) {
  const isEdit = !!taskId
  const [title, setTitle] = useState('')
  const [taskDate, setTaskDate] = useState(todayStr())
  const [decisions, setDecisions] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [members, setMembers] = useState<Person[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [isMisc, setIsMisc] = useState(false)
  const [pjtOptions, setPjtOptions] = useState<PjtOpt[]>([])
  const [assigneeOpen, setAssigneeOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const originalTodoIds = useRef<string[]>([])
  const initialSnapRef = useRef('') // 로드 직후 상태 스냅샷
  const decisionsRef = useRef<HTMLTextAreaElement>(null)
  const pendingSel = useRef<[number, number] | null>(null) // Ctrl+B 후 복원할 선택 범위

  useEffect(() => {
    if (open) void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId])

  async function init() {
    setAssigneeOpen(null)
    // Todo의 PJT 드롭박스 후보: 동일 구분 + pending/active (+ 현재 PJT)
    const { data: opts } = await supabase
      .from('projects')
      .select('id, name, status')
      .eq('division_id', divisionId)
      .in('status', ['pending', 'active'])
      .order('name')
    let list = (opts as PjtOpt[]) ?? []
    if (!list.some((o) => o.id === projectId)) list = [{ id: projectId, name: projectName }, ...list]
    setPjtOptions(list)

    if (isEdit) {
      const { data } = await supabase
        .from('tasks')
        .select(
          '*, task_members(people(id,name)), todos(id,title,project_id,sort_order,todo_assignees(person_id))',
        )
        .eq('id', taskId)
        .single()
      if (data) {
        const mem = (data.task_members ?? [])
          .map((m: { people: Person }) => m.people)
          .filter(Boolean) as Person[]
        const rows: TodoRow[] = (data.todos ?? [])
          .slice()
          .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order)
          .map((t: { id: string; title: string; project_id: string; todo_assignees: { person_id: string }[] }) => ({
            key: t.id,
            id: t.id,
            title: t.title,
            projectId: t.project_id,
            assigneeIds: (t.todo_assignees ?? []).map((x) => x.person_id),
          }))
        const dt = data.task_date ?? todayStr()
        const dec = data.decisions ?? ''
        const lks = (data.link_urls as string[] | null) ?? []
        setTitle(data.title ?? '')
        setTaskDate(dt)
        setDecisions(dec)
        setLinks(lks)
        setIsMisc(!!data.is_misc)
        setMembers(mem)
        setTodos(rows)
        originalTodoIds.current = rows.map((r) => r.id!).filter(Boolean)
        initialSnapRef.current = snapshotOf(data.title ?? '', dt, dec, lks, mem, rows)
      }
    } else {
      const { data: pm } = await supabase
        .from('project_members')
        .select('people(id,name)')
        .eq('project_id', projectId)
      const mem = ((pm as unknown as { people: Person }[] | null) ?? [])
        .map((m) => m.people)
        .filter(Boolean)
      const today = todayStr()
      setTitle('')
      setTaskDate(today)
      setDecisions('')
      setLinks([])
      setIsMisc(false)
      setMembers(mem)
      setTodos([])
      originalTodoIds.current = []
      initialSnapRef.current = snapshotOf('', today, '', [], mem, [])
    }
  }

  // ---- 닫기(가드) / ESC / Ctrl+B ----
  const isDirty = () =>
    snapshotOf(title, taskDate, decisions, links, members, todos) !== initialSnapRef.current

  function requestClose() {
    if (isDirty() && !confirm('작성 중인 내용이 있습니다. 저장하지 않고 닫을까요?')) return
    onClose()
  }

  // 선택 영역을 **볼드**로 토글 (마크다운). 리치 에디터 미도입.
  function handleDecisionsKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return
    e.preventDefault()
    const ta = e.currentTarget
    const s = ta.selectionStart
    const en = ta.selectionEnd
    const v = decisions
    if (s === en) {
      const nv = v.slice(0, s) + '****' + v.slice(s)
      pendingSel.current = [s + 2, s + 2]
      setDecisions(nv)
      return
    }
    const sel = v.slice(s, en)
    if (sel.length >= 4 && sel.startsWith('**') && sel.endsWith('**')) {
      const inner = sel.slice(2, -2)
      pendingSel.current = [s, s + inner.length]
      setDecisions(v.slice(0, s) + inner + v.slice(en))
      return
    }
    if (v.slice(s - 2, s) === '**' && v.slice(en, en + 2) === '**') {
      pendingSel.current = [s - 2, s - 2 + sel.length]
      setDecisions(v.slice(0, s - 2) + sel + v.slice(en + 2))
      return
    }
    pendingSel.current = [s + 2, s + 2 + sel.length]
    setDecisions(v.slice(0, s) + '**' + sel + '**' + v.slice(en))
  }

  // Ctrl+B 처리 후 선택 범위 복원
  useEffect(() => {
    if (pendingSel.current && decisionsRef.current) {
      const [a, b] = pendingSel.current
      decisionsRef.current.focus()
      decisionsRef.current.setSelectionRange(a, b)
      pendingSel.current = null
    }
  }, [decisions])

  // ESC → 가드 닫기
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title, taskDate, decisions, links, members, todos])

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? '?'
  const addTodo = () =>
    setTodos((ts) => [...ts, { key: crypto.randomUUID(), title: '', assigneeIds: [], projectId }])
  const patchTodo = (key: string, patch: Partial<TodoRow>) =>
    setTodos((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  async function removeTodo(key: string) {
    const row = todos.find((t) => t.key === key)
    // 이미 저장된 Todo면 확인 후 DB에서 즉시 삭제 (todo_assignees·todo_memos 는 FK on delete cascade)
    if (row?.id) {
      if (!confirm('저장된 Todo입니다. 삭제하시겠습니까?\n담당자·메모도 함께 삭제됩니다.')) return
      await supabase.from('todos').delete().eq('id', row.id)
      originalTodoIds.current = originalTodoIds.current.filter((id) => id !== row.id)
    }
    // 새로 추가한(미저장) 행이면 그냥 목록에서 제거
    setTodos((ts) => ts.filter((t) => t.key !== key))
  }
  const toggleAssignee = (key: string, pid: string) =>
    setTodos((ts) =>
      ts.map((t) =>
        t.key === key
          ? {
              ...t,
              assigneeIds: t.assigneeIds.includes(pid)
                ? t.assigneeIds.filter((x) => x !== pid)
                : [...t.assigneeIds, pid],
            }
          : t,
      ),
    )

  async function persist() {
    if (!title.trim()) {
      alert('Task명을 입력하세요.')
      return
    }
    setSaving(true)
    try {
      let tid = taskId as string | undefined
      // Task는 배포 상태를 갖지 않는다 (배포는 배포 탭에서 Todo 단위로 처리)
      const base = {
        project_id: projectId,
        title: title.trim(),
        task_date: taskDate,
        decisions: decisions.trim() || null,
      }
      const payload = { ...base, link_urls: links.map((l) => l.trim()).filter(Boolean) }
      // migrations/009(link_urls) 미적용 시에도 저장이 깨지지 않도록 폴백 (PGRST204=schema cache에 컬럼 없음)
      const missingCol = (e: { code?: string } | null) =>
        !!e && (e.code === 'PGRST204' || e.code === '42703')

      if (isEdit) {
        let { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
        if (missingCol(error)) {
          ;({ error } = await supabase.from('tasks').update(base).eq('id', taskId))
          alert('링크가 저장되지 않았습니다. 최신 마이그레이션(009)을 적용하세요.')
        }
        if (error) throw error
      } else {
        let res = await supabase
          .from('tasks')
          .insert({ ...payload, is_misc: false })
          .select()
          .single()
        if (missingCol(res.error)) {
          res = await supabase
            .from('tasks')
            .insert({ ...base, is_misc: false })
            .select()
            .single()
          alert('링크가 저장되지 않았습니다. 최신 마이그레이션(009)을 적용하세요.')
        }
        if (res.error || !res.data) throw res.error
        tid = res.data.id
      }

      // Task 멤버 교체
      await supabase.from('task_members').delete().eq('task_id', tid)
      if (members.length)
        await supabase.from('task_members').insert(members.map((m) => ({ task_id: tid, person_id: m.id })))

      // Todo diff (기존 상태·메모 보존: 삭제된 것만 지우고 나머지는 update/insert)
      const memberIds = new Set(members.map((m) => m.id))
      const keptIds = todos.filter((t) => t.id).map((t) => t.id!)
      const removed = originalTodoIds.current.filter((id) => !keptIds.includes(id))
      if (removed.length) await supabase.from('todos').delete().in('id', removed)

      for (let i = 0; i < todos.length; i++) {
        const t = todos[i]
        const asg = t.assigneeIds.filter((id) => memberIds.has(id))
        if (t.id) {
          await supabase
            .from('todos')
            .update({ title: t.title.trim(), project_id: t.projectId, sort_order: i })
            .eq('id', t.id)
          await supabase.from('todo_assignees').delete().eq('todo_id', t.id)
          if (asg.length)
            await supabase
              .from('todo_assignees')
              .insert(asg.map((pid) => ({ todo_id: t.id, person_id: pid })))
        } else {
          if (!t.title.trim()) continue
          const { data: nt } = await supabase
            .from('todos')
            .insert({ task_id: tid, project_id: t.projectId, title: t.title.trim(), status: 'draft', sort_order: i })
            .select()
            .single()
          if (nt && asg.length)
            await supabase
              .from('todo_assignees')
              .insert(asg.map((pid) => ({ todo_id: nt.id, person_id: pid })))
        }
      }
      onSaved()
    } catch (e) {
      console.error('[TaskModal] 저장 실패', e)
      alert('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function del() {
    if (!taskId) return
    if (!confirm('이 Task를 삭제하시겠습니까? 하위 Todo·메모가 함께 삭제됩니다.')) return
    await supabase.from('tasks').delete().eq('id', taskId)
    onSaved()
  }

  const labelCls = 'mb-1 text-[11.5px] font-semibold text-ink-2'
  const inputCls =
    'w-full rounded-lg border border-line-strong px-2.5 py-2 text-[13px] outline-none focus:border-primary'

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* 배경: 클릭해도 닫히지 않음(작성 중 내용 보호) */}
      <div className="animate-overlay-in absolute inset-0 bg-[rgba(31,30,27,0.4)]" />

      {/* 우측 사이드 패널 */}
      <div className="animate-drawer-in absolute inset-y-0 right-0 flex w-[680px] max-w-[94vw] flex-col bg-white shadow-[-8px_0_28px_rgba(0,0,0,0.14)]">
        {/* 헤더 (고정) */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-line px-[22px] py-3.5">
          <div>
            <div className="text-[15px] font-bold">Task 작성</div>
            <p className="text-[11.5px] text-ink-3">
              소속 PJT: <span className="text-ink-2">{projectName}</span> (고정)
            </p>
          </div>
          <button
            onClick={requestClose}
            title="닫기"
            className="-mr-1 rounded-md px-2 py-1 text-[18px] leading-none text-ink-3 hover:bg-hover-bg hover:text-ink-1"
          >
            ✕
          </button>
        </div>

        {/* 본문 (스크롤) */}
        <div className="flex-1 overflow-y-auto px-[22px] py-4">
      <div className="mb-3 grid grid-cols-[2fr_1fr] gap-2.5">
        <div>
          <div className={labelCls}>Task명</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </div>
        <div>
          <div className={labelCls}>
            날짜 <span className="text-[10px] text-ink-3">기본: 작성일</span>
          </div>
          <input type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className={labelCls}>
        멤버 <span className="text-[10px] text-ink-3">— 기본: PJT 멤버 전원</span>
      </div>
      <div className="mb-3">
        <TagInput value={members} onChange={setMembers} />
      </div>

      <div className={labelCls}>
        결정 &amp; 전달 사항 <span className="text-[10px] font-normal text-ink-3">— Ctrl+B로 굵게(**볼드**)</span>
      </div>
      <textarea
        ref={decisionsRef}
        value={decisions}
        onChange={(e) => setDecisions(e.target.value)}
        onKeyDown={handleDecisionsKey}
        placeholder="선택 후 Ctrl+B → **굵게**"
        className={`${inputCls} mb-3 h-20 resize-none`}
      />

      <div className={labelCls}>
        링크 <span className="text-[10px] font-normal text-ink-3">— 선택, 여러 개 가능 · 새 창으로 열림</span>
      </div>
      <div className="mb-3 flex flex-col gap-1.5">
        {links.map((l, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              type="url"
              value={l}
              onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="https://example.com/…"
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
              title="링크 삭제"
              className="flex-shrink-0 rounded-lg border border-line-strong px-2.5 text-ink-3 hover:text-danger"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => setLinks((prev) => [...prev, ''])}
          className="rounded-lg border border-dashed border-line-strong py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-sidebar-bg"
        >
          + 링크 추가
        </button>
      </div>

      <div className={labelCls}>
        Todo <span className="text-[10px] text-ink-3">— 상태 표기·변경 없음</span>
      </div>
      <div className="mb-3.5 rounded-lg border border-line p-2.5">
        <div className="mb-1 grid grid-cols-[minmax(0,3fr)_140px_160px_30px] gap-2 px-0.5 text-[10px] text-ink-3">
          <span>내용</span>
          <span>담당자 (멤버 중 복수)</span>
          <span>PJT</span>
          <span />
        </div>
        {todos.map((t) => (
          <div key={t.key} className="mb-1.5 grid grid-cols-[minmax(0,3fr)_140px_160px_30px] items-center gap-2">
            <input
              value={t.title}
              onChange={(e) => patchTodo(t.key, { title: e.target.value })}
              placeholder="할 일 내용"
              className="min-w-0 rounded-lg border border-line-strong px-2 py-1.5 text-[12px] outline-none focus:border-primary"
            />
            <div className="relative">
              <button
                onClick={() => setAssigneeOpen((k) => (k === t.key ? null : t.key))}
                className="flex w-full items-center justify-between rounded-lg border border-line-strong px-2 py-1.5 text-left text-[12px] hover:bg-sidebar-bg"
              >
                <span className="truncate">
                  {t.assigneeIds.length ? t.assigneeIds.map(memberName).join(', ') : <span className="text-ink-3">담당자</span>}
                </span>
                <span className="text-ink-3">▾</span>
              </button>
              {assigneeOpen === t.key && (
                <div className="absolute left-0 top-full z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                  {members.length === 0 && (
                    <div className="px-2.5 py-1.5 text-[11px] text-ink-3">멤버를 먼저 추가하세요</div>
                  )}
                  {members.map((m) => (
                    <label
                      key={m.id}
                      className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-sidebar-bg"
                    >
                      <input
                        type="checkbox"
                        checked={t.assigneeIds.includes(m.id)}
                        onChange={() => toggleAssignee(t.key, m.id)}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <select
              value={t.projectId}
              onChange={(e) => patchTodo(t.key, { projectId: e.target.value })}
              className="rounded-lg border border-line-strong px-2 py-1.5 text-[12px] outline-none focus:border-primary"
            >
              {pjtOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => void removeTodo(t.key)}
              title="Todo 삭제"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] text-ink-3 hover:bg-danger-light hover:text-danger"
            >
              🗑
            </button>
          </div>
        ))}
        <button
          onClick={addTodo}
          className="mt-1 w-full rounded-lg border border-dashed border-line-strong py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-sidebar-bg"
        >
          + Todo 추가
        </button>
        <p className="mt-2 text-[10px] text-ink-3">PJT 드롭박스: 동일 구분 내 '미진행·진행중' PJT만 선택 가능</p>
      </div>
        </div>

        {/* 푸터 (고정) */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-line px-[22px] py-3">
          {/* "기타" 상설 Task는 삭제 불가 */}
          {isEdit && !isMisc ? (
            <Button variant="danger" onClick={del}>
              삭제
            </Button>
          ) : isMisc ? (
            <span className="text-[10px] text-ink-3">상설 Task(기타)는 삭제 불가</span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={requestClose}>취소</Button>
            {/* 배포는 배포 탭에서 Todo 단위/Task 일괄로 처리 */}
            <Button variant="primary" onClick={() => void persist()} disabled={saving}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
