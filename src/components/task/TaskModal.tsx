import { useEffect, useRef, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import TagInput from '../ui/TagInput'
import { supabase } from '../../lib/supabase'
import type { Person, TaskStatus } from '../../types'

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
  const [members, setMembers] = useState<Person[]>([])
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [status, setStatus] = useState<TaskStatus>('draft')
  const [isMisc, setIsMisc] = useState(false)
  const [pjtOptions, setPjtOptions] = useState<PjtOpt[]>([])
  const [assigneeOpen, setAssigneeOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const originalTodoIds = useRef<string[]>([])

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
        setTitle(data.title ?? '')
        setTaskDate(data.task_date ?? todayStr())
        setDecisions(data.decisions ?? '')
        setStatus(data.status)
        setIsMisc(!!data.is_misc)
        setMembers(
          (data.task_members ?? []).map((m: { people: Person }) => m.people).filter(Boolean),
        )
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
        setTodos(rows)
        originalTodoIds.current = rows.map((r) => r.id!).filter(Boolean)
      }
    } else {
      setTitle('')
      setTaskDate(todayStr())
      setDecisions('')
      setStatus('draft')
      setIsMisc(false)
      const { data: pm } = await supabase
        .from('project_members')
        .select('people(id,name)')
        .eq('project_id', projectId)
      setMembers(
        ((pm as unknown as { people: Person }[] | null) ?? []).map((m) => m.people).filter(Boolean),
      )
      setTodos([])
      originalTodoIds.current = []
    }
  }

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? '?'
  const addTodo = () =>
    setTodos((ts) => [...ts, { key: crypto.randomUUID(), title: '', assigneeIds: [], projectId }])
  const patchTodo = (key: string, patch: Partial<TodoRow>) =>
    setTodos((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch } : t)))
  const removeTodo = (key: string) => setTodos((ts) => ts.filter((t) => t.key !== key))
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

  async function persist(newStatus: TaskStatus) {
    if (!title.trim()) {
      alert('Task명을 입력하세요.')
      return
    }
    setSaving(true)
    try {
      let tid = taskId as string | undefined
      const payload = {
        project_id: projectId,
        title: title.trim(),
        task_date: taskDate,
        decisions: decisions.trim() || null,
        status: newStatus,
        deployed_at: newStatus === 'published' ? new Date().toISOString() : null,
      }
      if (isEdit) {
        await supabase.from('tasks').update(payload).eq('id', taskId)
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .insert({ ...payload, is_misc: false })
          .select()
          .single()
        if (error || !data) throw error
        tid = data.id
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
            .insert({ task_id: tid, project_id: t.projectId, title: t.title.trim(), status: 'pending', sort_order: i })
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

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div className="mb-0.5 text-[15px] font-bold">Task 작성</div>
      <p className="mb-3.5 text-[11.5px] text-ink-3">
        소속 PJT: <span className="text-ink-2">{projectName}</span> (고정)
      </p>

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

      <div className={labelCls}>결정 &amp; 전달 사항</div>
      <textarea
        value={decisions}
        onChange={(e) => setDecisions(e.target.value)}
        className={`${inputCls} mb-3 h-16 resize-none`}
      />

      <div className={labelCls}>
        Todo <span className="text-[10px] text-ink-3">— 상태 표기·변경 없음</span>
      </div>
      <div className="mb-3.5 rounded-lg border border-line p-2.5">
        <div className="mb-1 grid grid-cols-[3fr_130px_150px_24px] gap-2 px-0.5 text-[10px] text-ink-3">
          <span>내용</span>
          <span>담당자 (멤버 중 복수)</span>
          <span>PJT</span>
          <span />
        </div>
        {todos.map((t) => (
          <div key={t.key} className="mb-1.5 grid grid-cols-[3fr_130px_150px_24px] items-center gap-2">
            <input
              value={t.title}
              onChange={(e) => patchTodo(t.key, { title: e.target.value })}
              placeholder="할 일 내용"
              className="rounded-lg border border-line-strong px-2 py-1.5 text-[12px] outline-none focus:border-primary"
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
            <button onClick={() => removeTodo(t.key)} className="text-ink-3 hover:text-danger" title="삭제">
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

      <div className="flex items-center justify-between border-t border-line pt-3.5">
        {/* "기타" 상설 Task는 삭제 불가 (규칙 8) */}
        {isEdit && !isMisc ? (
          <Button variant="danger" onClick={del}>
            삭제
          </Button>
        ) : isMisc ? (
          <span className="text-[10px] text-ink-3">상설 Task(기타)는 항상 배포 상태이며 삭제할 수 없습니다.</span>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {/* "기타"는 배포 토글 없음 (항상 published 유지) */}
          {!isMisc && (
            <Button onClick={() => persist(status === 'draft' ? 'published' : 'draft')} disabled={saving}>
              {status === 'draft' ? '배포 완료' : '미배포로 되돌리기'}
            </Button>
          )}
          <Button variant="primary" onClick={() => persist(status)} disabled={saving}>
            저장
          </Button>
        </div>
      </div>
    </Modal>
  )
}
