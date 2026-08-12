import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DATA_CHANGED } from '../../lib/events'
import { MY_NAME } from '../../lib/config'

const SIDEBAR_KEY = 'pm_sidebar_w'
const MIN_W = 220
const MAX_W = 400

/** 사이드바 = '나의 할 일(미진행)' 전용. 담당자에 MY_NAME 이 포함된 draft·published Todo만.
 *  체크됨·완료는 Todo 체크 탭에서 관리하므로 여기 뜨지 않는다. */
interface MyTodo {
  id: string
  title: string
  status: 'draft' | 'published'
  taskDate: string
  projectName: string
}
interface RawTodo {
  id: string
  title: string
  status: string
  projects: { name: string } | null
  tasks: { task_date: string } | null
  todo_assignees: { people: { name: string } | null }[] | null
}

const md = (d: string | null) => {
  if (!d) return ''
  const [, m, day] = d.slice(0, 10).split('-')
  return `${+m}/${+day}`
}

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [width, setWidth] = useState(() => {
    const w = Number(localStorage.getItem(SIDEBAR_KEY))
    return w ? Math.min(MAX_W, Math.max(MIN_W, w)) : 268
  })
  const [todos, setTodos] = useState<MyTodo[]>([])

  useEffect(() => {
    void loadMyTodos()
  }, [location.pathname])

  useEffect(() => {
    const onChange = () => void loadMyTodos()
    window.addEventListener(DATA_CHANGED, onChange)
    return () => window.removeEventListener(DATA_CHANGED, onChange)
  }, [])

  async function loadMyTodos() {
    const { data, error } = await supabase
      .from('todos')
      .select('id, title, status, projects(name), tasks(task_date), todo_assignees(people(name))')
      .in('status', ['draft', 'published'])
    if (error) {
      console.error('[Sidebar] 나의 할 일 로드 실패', error)
      return
    }
    const rows: MyTodo[] = []
    for (const t of (data as unknown as RawTodo[]) ?? []) {
      const mine = (t.todo_assignees ?? []).some((a) => a.people?.name === MY_NAME)
      if (!mine) continue
      rows.push({
        id: t.id,
        title: t.title,
        status: t.status === 'draft' ? 'draft' : 'published',
        taskDate: t.tasks?.task_date ?? '',
        projectName: t.projects?.name ?? '(프로젝트 없음)',
      })
    }
    // Task 작성일 오래된순 — 묵힌 일이 위로
    rows.sort((a, b) => (a.taskDate || '9999').localeCompare(b.taskDate || '9999'))
    setTodos(rows)
  }

  // Todo 체크 탭으로 점프 → 해당 Task 그룹이 펼쳐지고 그 Todo가 강조된다
  const jump = (todoId: string) => navigate('/main', { state: { focusTodoId: todoId } })

  // ---- 드래그 리사이즈 ----
  const startW = useRef(0)
  const startX = useRef(0)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startW.current = width
      startX.current = e.clientX
      const move = (ev: MouseEvent) => {
        const w = Math.min(MAX_W, Math.max(MIN_W, startW.current + ev.clientX - startX.current))
        setWidth(w)
      }
      const up = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        setWidth((w) => {
          localStorage.setItem(SIDEBAR_KEY, String(w))
          return w
        })
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    },
    [width],
  )

  return (
    <>
      <aside
        style={{ width }}
        className="flex flex-shrink-0 flex-col overflow-y-auto border-r border-line bg-sidebar-bg"
      >
        <button
          onClick={() => navigate('/main')}
          title="첫 화면으로"
          className="px-4 pb-3 pt-4 text-left text-sm font-bold tracking-[-0.01em] text-ink-1 hover:text-primary"
        >
          프로젝트 관리 툴
        </button>

        <div className="flex items-center gap-1.5 px-4 pb-2">
          <span className="text-[12.5px] font-bold text-ink-1">나의 할 일</span>
          <span className="rounded-full bg-primary-light px-[7px] py-px text-[10.5px] font-semibold text-primary">
            {todos.length}
          </span>
        </div>

        <nav className="flex flex-col gap-1.5 px-2.5 pb-3">
          {todos.length === 0 && (
            <div className="px-1.5 py-2 text-[11.5px] leading-relaxed text-ink-3">
              미진행 할 일이 없습니다.
            </div>
          )}
          {todos.map((t) => (
            <button
              key={t.id}
              onClick={() => jump(t.id)}
              title="클릭: Todo 체크 탭에서 열기"
              className="rounded-lg border border-line bg-white px-[9px] py-2 text-left hover:border-primary hover:bg-primary-light"
            >
              {/* 내 Todo는 이제 생성 즉시 배포되므로 '배포' 뱃지는 표시하지 않는다.
                  아직 남아 있는 미배포 건만 눈에 띄게 '미배포'로 표시. */}
              <div className="mb-[3px] flex items-start gap-1.5">
                {t.status === 'draft' && (
                  <span className="mt-px flex-shrink-0 rounded border border-line-strong bg-sidebar-bg px-[5px] py-px text-[10px] font-semibold text-ink-2">
                    미배포
                  </span>
                )}
                <span className="min-w-0 text-[12px] leading-snug text-ink-1">{t.title}</span>
              </div>
              <div className="truncate pl-[3px] text-[10.5px] text-ink-3">
                {t.projectName}
                {t.taskDate && ` · ${md(t.taskDate)}`}
              </div>
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-line p-2">
          <button
            onClick={() => navigate('/settings')}
            className="flex w-full items-center gap-[9px] rounded-lg px-[11px] py-[9px] text-left text-[13px] font-semibold text-ink-2 hover:bg-hover-bg hover:text-ink-1"
          >
            <span className="text-base leading-none">⚙</span>설정
          </button>
        </div>
      </aside>

      <div
        onMouseDown={onMouseDown}
        className="relative z-[5] -ml-[3px] flex-shrink-0 basis-[5px] cursor-col-resize hover:bg-[rgba(24,95,165,0.12)]"
      />
    </>
  )
}
