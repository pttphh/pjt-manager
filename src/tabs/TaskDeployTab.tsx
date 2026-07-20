import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import TaskModal from '../components/task/TaskModal'
import type { TaskStatus, TodoStatus } from '../types'

interface DeployTask {
  id: string
  title: string
  task_date: string
  status: TaskStatus
  deployed_at: string | null
  projectId: string
  projectName: string
  divisionId: string
  total: number
  done: number
}
interface RawDeploy {
  id: string
  title: string
  task_date: string
  status: TaskStatus
  deployed_at: string | null
  project_id: string
  projects: { name: string; division_id: string } | null
  todos: { status: TodoStatus }[] | null
}

// 'YYYY-MM-DD...' → 'M/D' (선행 0 제거)
const md = (d: string | null) => {
  if (!d) return ''
  const [, m, day] = d.slice(0, 10).split('-')
  return `${+m}/${+day}`
}

export default function TaskDeployTab() {
  const [tasks, setTasks] = useState<DeployTask[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{
    open: boolean
    taskId: string
    projectId: string
    projectName: string
    divisionId: string
  } | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('tasks')
        .select('id, title, task_date, status, deployed_at, project_id, projects(name, division_id), todos(status)')
      const rows = ((data as unknown as RawDeploy[]) ?? []).map((t) => ({
        id: t.id,
        title: t.title,
        task_date: t.task_date,
        status: t.status,
        deployed_at: t.deployed_at,
        projectId: t.project_id,
        projectName: t.projects?.name ?? '(프로젝트 없음)',
        divisionId: t.projects?.division_id ?? '',
        total: (t.todos ?? []).length,
        done: (t.todos ?? []).filter((x) => x.status === 'done').length,
      }))
      setTasks(rows)
    } catch (e) {
      console.error('[TaskDeployTab] 로드 실패', e)
    } finally {
      setLoading(false)
    }
  }

  const drafts = tasks
    .filter((t) => t.status === 'draft')
    .sort((a, b) => (b.task_date ?? '').localeCompare(a.task_date ?? ''))
  // 배포됨: 진행 중 Task만 (전 Todo 완료 시 제거 = 미완료 Todo가 하나라도 있어야 노출)
  const deployed = tasks
    .filter((t) => t.status === 'published' && t.done < t.total)
    .sort((a, b) => (b.deployed_at ?? '').localeCompare(a.deployed_at ?? ''))

  const openTask = (t: DeployTask) =>
    setModal({
      open: true,
      taskId: t.id,
      projectId: t.projectId,
      projectName: t.projectName,
      divisionId: t.divisionId,
    })

  const draftBtn: React.CSSProperties = {
    border: '1px solid #D9BE93',
    background: '#fff',
    color: '#633806',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: 7,
    padding: '5px 12px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  }
  const deployBtn: React.CSSProperties = {
    border: '1px solid #CFCDC7',
    background: '#fff',
    color: '#55534E',
    fontSize: '12px',
    fontWeight: 600,
    borderRadius: 7,
    padding: '5px 12px',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  }

  return (
    <div style={{ padding: '20px 28px 32px' }}>
      {loading ? (
        <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
      ) : (
        <>
          {/* 미배포 (작성중) */}
          <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#633806', marginBottom: 10 }}>
            미배포 <span style={{ fontWeight: 400, color: '#8A877F' }}>(작성중)</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {drafts.length === 0 && <p className="text-[12px] text-ink-3">미배포 Task 없음</p>}
            {drafts.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid #E0C9A6',
                  background: '#FAEEDA',
                  borderRadius: 10,
                  padding: '11px 14px',
                }}
              >
                <span className="min-w-0 truncate text-[13px]">
                  <span style={{ fontWeight: 600, color: '#633806' }}>{t.title}</span>
                  <span style={{ opacity: 0.75 }}>
                    {' '}
                    (작성 {md(t.task_date)}) — {t.projectName}
                  </span>
                </span>
                <button style={draftBtn} onClick={() => openTask(t)}>
                  내용보기
                </button>
              </div>
            ))}
          </div>

          {/* 구분선 */}
          <div style={{ borderTop: '1px solid #E2E0DB', margin: '20px 0' }} />

          {/* 배포됨 */}
          <p style={{ fontSize: '12.5px', fontWeight: 700, color: '#1F1E1B', marginBottom: 10 }}>
            배포됨{' '}
            <span style={{ fontWeight: 400, color: '#B4B1A9' }}>
              — 진행 중 Task만 · 전 Todo 완료 시 제거
            </span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {deployed.length === 0 && <p className="text-[12px] text-ink-3">배포된 진행 중 Task 없음</p>}
            {deployed.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid #E2E0DB',
                  background: '#fff',
                  borderRadius: 10,
                  padding: '11px 14px',
                }}
              >
                <span className="min-w-0 truncate text-[13px]">
                  <span style={{ fontWeight: 600, color: '#1F1E1B' }}>{t.title}</span>
                  <span style={{ color: '#8A877F' }}>
                    {' '}
                    (배포 {md(t.deployed_at)}) — {t.projectName}
                  </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontSize: '11.5px', color: '#8A877F' }}>
                    Todo {t.done}/{t.total} 완료
                  </span>
                  <button style={deployBtn} onClick={() => openTask(t)}>
                    내용보기
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {modal && (
        <TaskModal
          open={modal.open}
          taskId={modal.taskId}
          projectId={modal.projectId}
          projectName={modal.projectName}
          divisionId={modal.divisionId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            void load()
          }}
        />
      )}
    </div>
  )
}
