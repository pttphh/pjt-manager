import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Layout from '../components/layout/Layout'
import ProjectFormModal from '../components/project/ProjectFormModal'
import TaskModal from '../components/task/TaskModal'
import { supabase } from '../lib/supabase'
import { emitDataChanged } from '../lib/events'
import { tagSwatch } from '../lib/colors'
import type { Person, ProjectStatus, Tag, Task, TodoStatus } from '../types'

const STATUS_META: Record<ProjectStatus, { label: string; bg: string; fg: string; bd: string }> = {
  pending: { label: '미진행', bg: '#FAEEDA', fg: '#633806', bd: '#E0C9A6' },
  active: { label: '진행중', bg: '#E6F1FB', fg: '#0C447C', bd: '#B8D4EF' },
  hold: { label: '보류', bg: '#FCEBEB', fg: '#791F1F', bd: '#EFCFCF' },
  done: { label: '완료', bg: '#E1F5EE', fg: '#085041', bd: '#B7E3D3' },
}
const DIVISION_BADGE = { bg: '#FAEEDA', fg: '#633806', bd: '#E0C9A6' }

interface DetailProject {
  id: string
  name: string
  description: string | null
  link_url?: string | null
  link_urls?: string[] | null
  division_id: string
  status: ProjectStatus
  start_date: string | null
  due_date: string | null
  divisions?: { id: string; name: string }
  project_tags?: { tags: Tag }[]
  project_members?: { people: Person }[]
}
interface DetailTodo {
  id: string
  title: string
  status: TodoStatus
  deployedAt: string | null
  sort_order: number
  assignees: string[]
  memoCount: number
  todoProjectId: string // 이 Todo가 담당(태그)된 PJT
  todoProjectName: string
}

const fmtDot = (d: string | null, short = false) => {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return short ? `${y.slice(2)}.${m}.${day}` : `${y}.${m}.${day}`
}
/** 프로토콜이 없으면 https:// 를 붙여 상대경로로 해석되는 걸 방지 */
const toHref = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)
const tagColorOf = (t: Tag) =>
  t.color_bg && t.color_fg && t.color_bd
    ? { bg: t.color_bg, fg: t.color_fg, bd: t.color_bd }
    : tagSwatch((t.sort_order ?? 1) - 1)

export default function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState<DetailProject | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [todos, setTodos] = useState<DetailTodo[]>([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [taskModal, setTaskModal] = useState<{ open: boolean; taskId: string | null }>({
    open: false,
    taskId: null,
  })
  const [newTodoOpen, setNewTodoOpen] = useState(false)
  const [newTodoTitle, setNewTodoTitle] = useState('')
  const [newTodoAssignees, setNewTodoAssignees] = useState<string[]>([])
  const [assigneeDropOpen, setAssigneeDropOpen] = useState(false)

  useEffect(() => {
    if (id) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function load() {
    setLoading(true)
    try {
      // Todo 노출 = 이 PJT에 담당(todo.project_id) OR 이 PJT의 Task 소속(task.project_id) 합집합
      const todoFields =
        'id,title,status,deployed_at,sort_order,project_id,projects(name),todo_assignees(people(name)),todo_memos(id)'
      const [{ data: proj }, { data: taskData }, { data: todoByProject }, { data: todoByTask }] =
        await Promise.all([
          supabase
            .from('projects')
            .select(
              '*, divisions(id,name), project_tags(tags(id,name,sort_order,color_bg,color_fg,color_bd)), project_members(people(id,name))',
            )
            .eq('id', id)
            .single(),
          supabase.from('tasks').select('*').eq('project_id', id),
          supabase.from('todos').select(todoFields).eq('project_id', id),
          supabase.from('todos').select(`${todoFields},tasks!inner(project_id)`).eq('tasks.project_id', id),
        ])

      if (!proj) {
        // 편집 팝업에서 삭제됐거나 없는 PJT → 목록으로
        navigate('/main', { replace: true })
        return
      }
      setProject(proj as DetailProject)

      const ts = (taskData as Task[]) ?? []
      ts.sort((a, b) => {
        if (a.is_misc !== b.is_misc) return a.is_misc ? 1 : -1 // 기타는 항상 맨 아래
        return (b.task_date ?? '').localeCompare(a.task_date ?? '')
      })
      setTasks(ts)

      // 두 결과 합치고 id로 중복 제거
      const byId = new Map<string, unknown>()
      for (const t of [...((todoByProject as unknown[]) ?? []), ...((todoByTask as unknown[]) ?? [])]) {
        byId.set((t as { id: string }).id, t)
      }
      setTodos(
        [...byId.values()]
          .map((raw) => {
            const t = raw as {
              id: string
              title: string
              status: TodoStatus
              deployed_at: string | null
              sort_order: number
              project_id: string
              projects: { name: string } | null
              todo_assignees: { people: { name: string } }[]
              todo_memos: { id: string }[]
            }
            return {
              id: t.id,
              title: t.title,
              status: t.status,
              deployedAt: t.deployed_at,
              sort_order: t.sort_order,
              assignees: (t.todo_assignees ?? []).map((a) => a.people?.name).filter(Boolean) as string[],
              memoCount: (t.todo_memos ?? []).length,
              todoProjectId: t.project_id,
              todoProjectName: t.projects?.name ?? '',
            }
          })
          .sort((a, b) => a.sort_order - b.sort_order),
      )
    } catch (e) {
      console.error('[ProjectDetailPage] 로드 실패', e)
    } finally {
      setLoading(false)
    }
  }

  async function changeStatus(next: ProjectStatus) {
    if (!project) return
    setProject({ ...project, status: next })
    await supabase
      .from('projects')
      .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
      .eq('id', project.id)
    emitDataChanged() // 완료 전환 등으로 사이드바 노출 여부 바뀜
  }

  async function deleteTodo(todo: DetailTodo) {
    if (!confirm(`'${todo.title}' Todo를 삭제하시겠습니까?\n담당자·메모도 함께 삭제됩니다.`)) return
    setTodos((ts) => ts.filter((t) => t.id !== todo.id))
    await supabase.from('todos').delete().eq('id', todo.id)
  }

  async function toggleTodo(todo: DetailTodo) {
    // 체크 → done. 해제 → 메모 있으면 checked, 없으면 배포됐으면 published, 미배포면 draft.
    const next: TodoStatus =
      todo.status === 'done'
        ? todo.memoCount > 0
          ? 'checked'
          : todo.deployedAt
            ? 'published'
            : 'draft'
        : 'done'
    setTodos((ts) => ts.map((t) => (t.id === todo.id ? { ...t, status: next } : t)))
    await supabase.from('todos').update({ status: next }).eq('id', todo.id)
  }

  // 우측 패널에서 단발성 Todo 등록 → 이 PJT의 "기타"(is_misc) Task에 붙인다.
  async function addNewTodo() {
    const title = newTodoTitle.trim()
    if (!title || !project) return
    let miscId = tasks.find((t) => t.is_misc)?.id
    if (!miscId) {
      // 방어적: 기타 Task가 없으면 생성
      const { data } = await supabase
        .from('tasks')
        .insert({ project_id: project.id, title: '기타', is_misc: true })
        .select()
        .single()
      miscId = data?.id
    }
    if (!miscId) return
    const maxSort = todos.reduce((m, t) => Math.max(m, t.sort_order), 0)
    const { data: newTodo } = await supabase
      .from('todos')
      .insert({ task_id: miscId, project_id: project.id, title, status: 'draft', sort_order: maxSort + 1 })
      .select()
      .single()
    if (newTodo && newTodoAssignees.length) {
      // 담당자는 Task 멤버여야 하므로 기타 Task 멤버로도 보장
      await supabase
        .from('task_members')
        .upsert(
          newTodoAssignees.map((pid) => ({ task_id: miscId, person_id: pid })),
          { onConflict: 'task_id,person_id', ignoreDuplicates: true },
        )
      await supabase
        .from('todo_assignees')
        .insert(newTodoAssignees.map((pid) => ({ todo_id: newTodo.id, person_id: pid })))
    }
    setNewTodoTitle('')
    setNewTodoAssignees([])
    setAssigneeDropOpen(false)
    setNewTodoOpen(false)
    void load()
  }

  if (loading || !project) {
    return (
      <Layout>
        <div className="flex h-full items-center justify-center text-sm text-ink-3">불러오는 중…</div>
      </Layout>
    )
  }

  const sm = STATUS_META[project.status]
  const tags = (project.project_tags ?? []).map((pt) => pt.tags).filter(Boolean)
  const members = (project.project_members ?? []).map((pm) => pm.people).filter(Boolean)
  const projectLinks =
    project.link_urls && project.link_urls.length
      ? project.link_urls
      : project.link_url
        ? [project.link_url]
        : []
  const openTodos = todos.filter((t) => t.status !== 'done')
  const doneTodos = todos.filter((t) => t.status === 'done')

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto px-7 pb-8 pt-4">
        <button onClick={() => navigate('/main')} className="mb-2.5 text-[12px] text-ink-3 hover:text-primary">
          ← PJT 관리로
        </button>

        {/* 정보 카드 */}
        <div className="rounded-xl bg-white p-3.5" style={{ border: '1px solid #D6D4CE', marginBottom: 22 }}>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <select
                value={project.status}
                onChange={(e) => changeStatus(e.target.value as ProjectStatus)}
                style={{ background: sm.bg, color: sm.fg, border: `1px solid ${sm.bd}` }}
                className="cursor-pointer rounded-md px-2.5 py-1 text-[12px] font-semibold outline-none"
              >
                {(Object.keys(STATUS_META) as ProjectStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
              <span className="text-[16px] font-semibold text-ink-1">{project.name}</span>
            </div>
            <button
              onClick={() => setEditOpen(true)}
              className="text-[12px] text-ink-2 hover:text-primary"
              title="편집 (삭제 포함)"
            >
              ✎ 편집
            </button>
          </div>
          <div className="space-y-1 text-[12px] text-ink-2">
            <div className="flex items-start gap-2">
              <span className="w-[72px] flex-shrink-0 text-ink-3">링크</span>
              {projectLinks.length > 0 ? (
                <span className="flex min-w-0 flex-col gap-0.5">
                  {projectLinks.map((u, i) => (
                    <a
                      key={i}
                      href={toHref(u)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="새 창으로 열기"
                      className="min-w-0 truncate text-primary hover:underline"
                    >
                      {u} ↗
                    </a>
                  ))}
                </span>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </div>
            <div className="flex items-start gap-2">
              <span className="w-[72px] flex-shrink-0 text-ink-3">구분 · 태그</span>
              <span className="flex flex-wrap gap-1.5">
                <span
                  className="rounded-[5px] px-[9px] py-[2px] text-[11px] font-semibold"
                  style={{ background: DIVISION_BADGE.bg, color: DIVISION_BADGE.fg, border: `1px solid ${DIVISION_BADGE.bd}` }}
                >
                  {project.divisions?.name ?? '—'}
                </span>
                {tags.map((t) => {
                  const c = tagColorOf(t)
                  return (
                    <span
                      key={t.id}
                      className="rounded-[5px] px-[9px] py-[2px] text-[11px] font-semibold"
                      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}
                    >
                      {t.name}
                    </span>
                  )
                })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[72px] flex-shrink-0 text-ink-3">기간</span>
              <span>
                시작 {fmtDot(project.start_date)} — 완료 예정 {fmtDot(project.due_date)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[72px] flex-shrink-0 text-ink-3">멤버</span>
              <span className="flex flex-wrap gap-1.5">
                {members.length === 0 && <span className="text-ink-3">—</span>}
                {members.map((m) => (
                  <span
                    key={m.id}
                    className="rounded-full border border-line bg-sidebar-bg px-2 py-[1px] text-[11px]"
                  >
                    {m.name}
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          {/* Tasks */}
          <section
            className="min-w-0 rounded-xl"
            style={{ flex: '1 1 0', border: '1px solid #E2E0DB', background: '#FBFBFA', padding: '14px 15px' }}
          >
            <p
              className="text-[13px] font-bold text-ink-1"
              style={{ paddingBottom: 10, marginBottom: 11, borderBottom: '1px solid #E2E0DB' }}
            >
              Tasks
            </p>
            <button
              onClick={() => setTaskModal({ open: true, taskId: null })}
              className="mb-1.5 w-full rounded-lg border border-dashed border-line-strong py-2 text-[12px] font-semibold text-ink-2 hover:bg-sidebar-bg"
            >
              + 신규 Task 등록
            </button>
            <div className="flex flex-col gap-1.5">
              {tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTaskModal({ open: true, taskId: t.id })}
                  className="rounded-lg border border-line-strong bg-white px-3 py-2 text-left text-[12.5px] hover:bg-sidebar-bg"
                >
                  <span className="text-ink-3">{fmtDot(t.task_date, true)}</span>{' '}
                  <span className="text-ink-1">{t.title}</span>
                  {t.is_misc && <span className="ml-1 text-[10px] text-ink-3">(상설)</span>}
                </button>
              ))}
            </div>
          </section>

          {/* Todo */}
          <section
            className="min-w-0 rounded-xl"
            style={{ flex: '1.55 1 0', border: '1px solid #E2E0DB', background: '#FBFBFA', padding: '14px 15px' }}
          >
            <p
              className="text-[13px] font-bold text-ink-1"
              style={{ paddingBottom: 10, marginBottom: 11, borderBottom: '1px solid #E2E0DB' }}
            >
              Todo
            </p>
            {newTodoOpen ? (
              <div className="mb-1.5 flex gap-1.5">
                <input
                  value={newTodoTitle}
                  autoFocus
                  onChange={(e) => setNewTodoTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addNewTodo()
                    if (e.key === 'Escape') {
                      setNewTodoOpen(false)
                      setNewTodoTitle('')
                      setNewTodoAssignees([])
                      setAssigneeDropOpen(false)
                    }
                  }}
                  placeholder="새 Todo 내용 (기타 Task에 추가)"
                  className="min-w-0 flex-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
                />
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setAssigneeDropOpen((o) => !o)}
                    className="flex max-w-[130px] items-center gap-1 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] hover:bg-sidebar-bg"
                  >
                    <span className="truncate">
                      {newTodoAssignees.length ? (
                        members.filter((m) => newTodoAssignees.includes(m.id)).map((m) => m.name).join(', ')
                      ) : (
                        <span className="text-ink-3">담당자</span>
                      )}
                    </span>
                    <span className="text-ink-3">▾</span>
                  </button>
                  {assigneeDropOpen && (
                    <div className="absolute right-0 top-full z-10 mt-1 max-h-44 w-40 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
                      {members.length === 0 && (
                        <div className="px-2.5 py-1.5 text-[11px] text-ink-3">PJT 멤버 없음</div>
                      )}
                      {members.map((m) => (
                        <label
                          key={m.id}
                          className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-sidebar-bg"
                        >
                          <input
                            type="checkbox"
                            checked={newTodoAssignees.includes(m.id)}
                            onChange={() =>
                              setNewTodoAssignees((a) =>
                                a.includes(m.id) ? a.filter((x) => x !== m.id) : [...a, m.id],
                              )
                            }
                          />
                          {m.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void addNewTodo()}
                  className="flex-shrink-0 rounded-lg border border-primary bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#124e88]"
                >
                  추가
                </button>
                <button
                  onClick={() => {
                    setNewTodoOpen(false)
                    setNewTodoTitle('')
                    setNewTodoAssignees([])
                    setAssigneeDropOpen(false)
                  }}
                  className="flex-shrink-0 rounded-lg border border-line-strong px-2.5 py-1.5 text-[12px] text-ink-2 hover:bg-sidebar-bg"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNewTodoOpen(true)}
                className="mb-1.5 w-full rounded-lg border border-dashed border-line-strong py-2 text-[12px] font-semibold text-ink-2 hover:bg-sidebar-bg"
              >
                + 신규 Todo 등록
              </button>
            )}
            <div>
              {todos.length === 0 && <p className="py-4 text-center text-[12px] text-ink-3">Todo 없음</p>}
              {openTodos.map((t) => {
                const elsewhere = !!t.todoProjectId && t.todoProjectId !== project.id
                return (
                  <div key={t.id} className="group mb-1.5 flex items-start justify-between gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-[12.5px]">
                      <input type="checkbox" checked={false} onChange={() => toggleTodo(t)} className="mt-0.5" />
                      <span className="min-w-0">
                        {t.title}
                        {t.assignees.length > 0 && (
                          <span className="text-[10px] text-ink-3"> — {t.assignees.join(', ')}</span>
                        )}
                        {elsewhere && (
                          <span className="ml-1 whitespace-nowrap rounded bg-primary-light px-1.5 py-[1px] text-[10px] text-primary-text">
                            → {t.todoProjectName}
                          </span>
                        )}
                      </span>
                    </label>
                    <button
                      onClick={() => deleteTodo(t)}
                      title="Todo 삭제"
                      className="mt-px flex-shrink-0 rounded px-1 text-[11px] text-ink-4 hover:text-danger"
                    >
                      🗑
                    </button>
                  </div>
                )
              })}
              {doneTodos.length > 0 && openTodos.length > 0 && (
                <div className="my-2 border-t border-line" />
              )}
              {doneTodos.map((t) => {
                const elsewhere = !!t.todoProjectId && t.todoProjectId !== project.id
                return (
                  <div key={t.id} className="mb-1.5 flex items-start justify-between gap-2 text-ink-3">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-[12.5px]">
                      <input type="checkbox" checked onChange={() => toggleTodo(t)} className="mt-0.5" />
                      <span className="min-w-0">
                        <s>{t.title}</s>
                        {t.assignees.length > 0 && <span className="text-[10px]"> — {t.assignees.join(', ')}</span>}
                        {elsewhere && <span className="ml-1 text-[10px]">→ {t.todoProjectName}</span>}
                      </span>
                    </label>
                    <button
                      onClick={() => deleteTodo(t)}
                      title="Todo 삭제"
                      className="mt-px flex-shrink-0 rounded px-1 text-[11px] text-ink-4 hover:text-danger"
                    >
                      🗑
                    </button>
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-[10px] text-ink-3">
              체크 → 완료 · 해제 → 메모 있으면 '체크', 없으면 '미진행' 복귀
            </p>
          </section>
        </div>
      </div>

      <ProjectFormModal
        open={editOpen}
        projectId={project.id}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false)
          void load()
        }}
      />
      <TaskModal
        open={taskModal.open}
        taskId={taskModal.taskId}
        projectId={project.id}
        projectName={project.name}
        divisionId={project.division_id}
        onClose={() => setTaskModal({ open: false, taskId: null })}
        onSaved={() => {
          setTaskModal({ open: false, taskId: null })
          void load()
        }}
      />
    </Layout>
  )
}
