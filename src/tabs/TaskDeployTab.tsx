import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TodoStatus } from '../types'

interface DeployTodo {
  id: string
  title: string
  status: TodoStatus
  sort_order: number
}
interface DeployTask {
  id: string
  title: string
  task_date: string
  decisions: string | null
  projectName: string
  todos: DeployTodo[]
}
interface RawDeploy {
  id: string
  title: string
  task_date: string
  decisions: string | null
  projects: { name: string } | null
  todos: { id: string; title: string; status: TodoStatus; sort_order: number }[] | null
}

// 'YYYY-MM-DD...' → 'M/D'
const md = (d: string | null) => {
  if (!d) return ''
  const [, m, day] = d.slice(0, 10).split('-')
  return `${+m}/${+day}`
}

const STATUS_LABEL: Record<Exclude<TodoStatus, 'draft'>, string> = {
  published: '배포됨',
  checked: '체크',
  done: '완료',
}

/**
 * 배포 탭 — 배포는 Todo 단위.
 * 미배포(draft) Todo가 하나라도 있는 Task만 묶음으로 표시하고,
 * Todo 개별 배포 / Task 전체 배포 / 배포 취소(미배포로 되돌리기)를 처리한다.
 */
export default function TaskDeployTab() {
  const [tasks, setTasks] = useState<DeployTask[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('tasks')
        .select('id, title, task_date, decisions, projects(name), todos(id, title, status, sort_order)')
      const rows: DeployTask[] = (((data as unknown as RawDeploy[]) ?? []) as RawDeploy[])
        .map((t) => ({
          id: t.id,
          title: t.title,
          task_date: t.task_date,
          decisions: t.decisions,
          projectName: t.projects?.name ?? '(프로젝트 없음)',
          todos: (t.todos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
        }))
        // 미배포(draft) 또는 배포됨(published) Todo가 있는 Task 표시.
        // 배포해도 회색으로 남아 되돌리기 가능하며, 모든 Todo가 체크/완료로 넘어가야 사라짐.
        .filter((t) => t.todos.some((td) => td.status === 'draft' || td.status === 'published'))
        .sort((a, b) => (b.task_date ?? '').localeCompare(a.task_date ?? ''))
      setTasks(rows)
    } catch (e) {
      console.error('[TaskDeployTab] 로드 실패', e)
    } finally {
      setLoading(false)
    }
  }

  async function deployTodo(todoId: string) {
    if (busy) return
    setBusy(true)
    try {
      await supabase
        .from('todos')
        .update({ status: 'published', deployed_at: new Date().toISOString() })
        .eq('id', todoId)
        .eq('status', 'draft')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function deployTask(taskId: string) {
    if (busy) return
    setBusy(true)
    try {
      await supabase
        .from('todos')
        .update({ status: 'published', deployed_at: new Date().toISOString() })
        .eq('task_id', taskId)
        .eq('status', 'draft')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function unpublishTodo(todoId: string) {
    if (busy) return
    setBusy(true)
    try {
      // published 만 되돌리기 가능 (checked/done 은 대상 아님)
      await supabase
        .from('todos')
        .update({ status: 'draft', deployed_at: null })
        .eq('id', todoId)
        .eq('status', 'published')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const smallBtn = (variant: 'deploy' | 'revert'): React.CSSProperties => ({
    border: `1px solid ${variant === 'deploy' ? '#185FA5' : '#CFCDC7'}`,
    background: variant === 'deploy' ? '#185FA5' : '#fff',
    color: variant === 'deploy' ? '#fff' : '#55534E',
    fontSize: '11.5px',
    fontWeight: 600,
    borderRadius: 7,
    padding: '3px 10px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    flex: '0 0 auto',
  })

  return (
    <div style={{ padding: '20px 28px 32px' }}>
      {loading ? (
        <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
      ) : (
        <>
          <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#1F1E1B', marginBottom: 10 }}>
            배포 관리{' '}
            <span style={{ fontWeight: 400, color: '#B4B1A9' }}>
              — Todo 단위로 배포/되돌리기 · 배포된 Todo는 회색으로 유지 · 체크 단계로 넘어가면 사라짐
            </span>
          </p>

          {tasks.length === 0 && (
            <p className="text-[12px] text-ink-3">배포 관리할 Todo가 없습니다. (Task 작성은 PJT 세부화면에서)</p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tasks.map((t) => {
              const draftCount = t.todos.filter((td) => td.status === 'draft').length
              const hasDraft = draftCount > 0
              const publishedCount = t.todos.filter((td) => td.status === 'published').length
              return (
                <div
                  key={t.id}
                  style={{
                    border: `1px solid ${hasDraft ? '#E0C9A6' : '#E2E0DB'}`,
                    borderRadius: 10,
                    overflow: 'hidden',
                  }}
                >
                  {/* Task 헤더 — draft 있으면 주황(미배포), 전부 배포됐으면 회색 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      background: hasDraft ? '#FAEEDA' : '#F5F4F0',
                      padding: '10px 13px',
                    }}
                  >
                    <span
                      className="min-w-0 truncate text-[13px]"
                      style={{ color: hasDraft ? '#633806' : '#1F1E1B' }}
                    >
                      <span style={{ fontWeight: 600 }}>{t.title}</span>
                      <span style={{ opacity: 0.75, color: hasDraft ? undefined : '#8A877F' }}>
                        {' '}
                        (작성 {md(t.task_date)}) — {t.projectName}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {hasDraft ? (
                        <>
                          <span style={{ fontSize: '11.5px', color: '#633806' }}>미배포 {draftCount}건</span>
                          <button style={smallBtn('deploy')} disabled={busy} onClick={() => deployTask(t.id)}>
                            이 Task 전체 배포
                          </button>
                        </>
                      ) : (
                        <span style={{ fontSize: '11.5px', color: '#8A877F' }}>
                          배포됨 {publishedCount}건 · 되돌리기 가능
                        </span>
                      )}
                    </span>
                  </div>

                  {/* 지시사항 미리보기 */}
                  {t.decisions && (
                    <div
                      className="truncate"
                      style={{
                        padding: '7px 13px',
                        fontSize: '11.5px',
                        color: '#8A877F',
                        borderBottom: '1px solid #F0EFEC',
                        background: '#fff',
                      }}
                      title={t.decisions}
                    >
                      {t.decisions}
                    </div>
                  )}

                  {/* Todo 목록: draft 정상 + 배포됨/체크/완료는 회색 */}
                  <div style={{ background: '#fff', padding: '4px 13px 10px' }}>
                    {t.todos.map((td) => {
                      const isDraft = td.status === 'draft'
                      return (
                        <div
                          key={td.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            paddingTop: 7,
                          }}
                        >
                          <span
                            className="min-w-0 truncate"
                            style={{
                              fontSize: '12.5px',
                              color: isDraft ? '#1F1E1B' : '#B4B1A9',
                            }}
                          >
                            {!isDraft && (
                              <span style={{ fontSize: '10px', marginRight: 6 }}>
                                [{STATUS_LABEL[td.status as Exclude<TodoStatus, 'draft'>]}]
                              </span>
                            )}
                            {td.title}
                          </span>
                          {isDraft ? (
                            <button style={smallBtn('deploy')} disabled={busy} onClick={() => deployTodo(td.id)}>
                              배포
                            </button>
                          ) : td.status === 'published' ? (
                            <button style={smallBtn('revert')} disabled={busy} onClick={() => unpublishTodo(td.id)}>
                              미배포로 되돌리기
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
