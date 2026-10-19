import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DATA_CHANGED } from '../../lib/events'
import { MY_NAME } from '../../lib/config'
import { hasUnreviewedUpdate, latestMemoTime, markReviewed } from '../../lib/updates'

const SIDEBAR_KEY = 'pm_sidebar_w'
const TAB_KEY = 'pm_sidebar_tab'
const MIN_W = 220
const MAX_W = 400

type SideTab = 'mine' | 'updates'

/** 사이드바는 두 목록을 버튼으로 전환한다 (규칙12).
 *  - 나의 할 일: 담당자에 MY_NAME 이 포함된 배포(published) Todo. 활동일 오래된순 — 방치된 일이 위로.
 *  - 업데이트:   확인하지 않은 새 진행사항이 달린 배포 Todo(담당자 무관). 최신 메모순.
 *               '확인'하면 빠지고, 그 뒤 새 메모가 달리면 다시 뜬다(판정 규칙은 lib/updates 한 곳). */
interface MyTodo {
  id: string
  title: string
  /** 정렬·표시 기준일 = 마지막 진행사항 메모 날짜, 없으면 Todo 등록일 */
  activityDate: string
  projectName: string
}
interface UpdateItem {
  id: string
  title: string
  projectName: string
  memo: string // 최신 메모 내용
  latestMemoAt: string // 확인 시 이 시각을 reviewed_at 으로 기록
}
interface RawTodo {
  id: string
  title: string
  created_at: string | null
  reviewed_at?: string | null // migrations/011 미적용이면 키 자체가 없다
  projects: { name: string } | null
  todo_assignees: { people: { name: string } | null }[] | null
  todo_memos: { content: string; created_at: string }[] | null
}

/** M/D 표기. timestamptz(UTC)는 로컬 날짜로 변환해야 오전 9시 이전 기록이 하루 전으로 밀리지 않는다.
 *  날짜만 있는 문자열(YYYY-MM-DD)은 그대로 파싱한다. */
const md = (d: string | null) => {
  if (!d) return ''
  if (!d.includes('T')) {
    const [, m, day] = d.slice(0, 10).split('-')
    return `${+m}/${+day}`
  }
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '' : `${dt.getMonth() + 1}/${dt.getDate()}`
}
const time = (d: string) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY)

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [width, setWidth] = useState(() => {
    const w = Number(localStorage.getItem(SIDEBAR_KEY))
    return w ? Math.min(MAX_W, Math.max(MIN_W, w)) : 268
  })
  const [tab, setTab] = useState<SideTab>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === 'updates' ? 'updates' : 'mine'
    } catch {
      return 'mine'
    }
  })
  const [todos, setTodos] = useState<MyTodo[]>([])
  const [updates, setUpdates] = useState<UpdateItem[]>([])
  // migrations/011(reviewed_at) 미적용이면 업데이트를 판정할 수 없다 — 전부 미확인으로 쏟아지지 않게 끈다
  const [updatesReady, setUpdatesReady] = useState(true)

  useEffect(() => {
    void load()
  }, [location.pathname])

  useEffect(() => {
    const onChange = () => void load()
    window.addEventListener(DATA_CHANGED, onChange)
    return () => window.removeEventListener(DATA_CHANGED, onChange)
  }, [])

  function switchTab(next: SideTab) {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      /* 저장 불가 환경이면 이번 세션만 유지 */
    }
  }

  // 두 목록 모두 '배포된 Todo'에서 나오므로 한 번에 읽는다. '*' 로 받아 reviewed_at 이 없어도 깨지지 않게.
  async function load() {
    const { data, error } = await supabase
      .from('todos')
      .select('*, projects(name), todo_assignees(people(name)), todo_memos(content, created_at)')
      .eq('status', 'published')
    if (error) {
      console.error('[Sidebar] 목록 로드 실패', error)
      return
    }
    const raw = (data as unknown as RawTodo[]) ?? []
    const ready = raw.length === 0 || 'reviewed_at' in raw[0]

    const mine: MyTodo[] = []
    const ups: UpdateItem[] = []
    for (const t of raw) {
      const projectName = t.projects?.name ?? '(프로젝트 없음)'
      const lastAt = latestMemoTime(t.todo_memos)

      if ((t.todo_assignees ?? []).some((a) => a.people?.name === MY_NAME)) {
        // 진행사항을 적으면 그 날짜로 갱신 → 손 안 댄 일만 위에 남는다
        mine.push({ id: t.id, title: t.title, activityDate: lastAt ?? t.created_at ?? '', projectName })
      }
      if (ready && lastAt && hasUnreviewedUpdate(lastAt, t.reviewed_at)) {
        const last = (t.todo_memos ?? []).find((m) => m.created_at === lastAt)
        ups.push({ id: t.id, title: t.title, projectName, memo: last?.content ?? '', latestMemoAt: lastAt })
      }
    }
    mine.sort((a, b) => time(a.activityDate) - time(b.activityDate)) // 오래된순 — 방치된 일이 위로
    ups.sort((a, b) => time(b.latestMemoAt) - time(a.latestMemoAt)) // 최신순 — 새 소식이 위로
    setTodos(mine)
    setUpdates(ups)
    setUpdatesReady(ready)
  }

  // Todo 체크 탭으로 점프 → 해당 그룹이 펼쳐지고 그 Todo가 강조된다
  const jump = (todoId: string) => navigate('/main', { state: { focusTodoId: todoId } })

  // 카드에서 바로 '확인' — 한 줄만 보면 되는 업데이트는 이동하지 않고 지운다
  async function review(e: React.MouseEvent, item: UpdateItem) {
    e.stopPropagation()
    setUpdates((list) => list.filter((u) => u.id !== item.id)) // 즉시 반영, 실패 시 다시 읽어 복구
    if (!(await markReviewed(item.id, item.latestMemoAt))) void load()
  }

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

  const tabBtn = (key: SideTab, label: string, count: number | null) => {
    const on = tab === key
    return (
      <button
        onClick={() => switchTab(key)}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-[6px] text-[12px] font-semibold transition-colors ${
          on ? 'bg-white text-ink-1 shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-ink-3 hover:text-ink-1'
        }`}
      >
        {label}
        {count !== null && (
          <span
            className={`rounded-full px-[6px] py-px text-[10.5px] ${
              on ? 'bg-primary-light text-primary' : 'bg-[#E8E6E1] text-ink-3'
            }`}
          >
            {count}
          </span>
        )}
      </button>
    )
  }

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

        <div className="mx-2.5 mb-2.5 flex gap-1 rounded-lg bg-[#ECEAE5] p-[3px]">
          {tabBtn('mine', '나의 할 일', todos.length)}
          {tabBtn('updates', '업데이트', updatesReady ? updates.length : null)}
        </div>

        {tab === 'mine' ? (
          <nav className="flex flex-col gap-1.5 px-2.5 pb-3">
            {todos.length === 0 && (
              <div className="px-1.5 py-2 text-[11.5px] leading-relaxed text-ink-3">미진행 할 일이 없습니다.</div>
            )}
            {todos.map((t) => (
              <button
                key={t.id}
                onClick={() => jump(t.id)}
                title="클릭: Todo 체크 탭에서 열기"
                className="rounded-lg border border-line bg-white px-[9px] py-2 text-left hover:border-primary hover:bg-primary-light"
              >
                <div className="mb-[3px] text-[12px] leading-snug text-ink-1">{t.title}</div>
                <div className="truncate pl-[3px] text-[10.5px] text-ink-3">
                  {t.projectName}
                  {t.activityDate && ` · ${md(t.activityDate)}`}
                </div>
              </button>
            ))}
          </nav>
        ) : (
          <nav className="flex flex-col gap-1.5 px-2.5 pb-3">
            {!updatesReady && (
              <div className="px-1.5 py-2 text-[11.5px] leading-relaxed text-ink-3">
                업데이트를 쓰려면 <b>migrations/011-todo-reviewed-at.sql</b> 을 적용하세요.
              </div>
            )}
            {updatesReady && updates.length === 0 && (
              <div className="px-1.5 py-2 text-[11.5px] leading-relaxed text-ink-3">새 업데이트가 없습니다.</div>
            )}
            {updates.map((u) => (
              // 카드 안에 '확인' 버튼이 있어 button 중첩을 피하려고 div 로 만든다
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => jump(u.id)}
                onKeyDown={(e) => e.key === 'Enter' && jump(u.id)}
                title="클릭: Todo 체크 탭에서 열기"
                className="cursor-pointer rounded-lg border border-line bg-white px-[9px] py-2 text-left hover:border-primary hover:bg-primary-light"
              >
                <div className="mb-1 text-[12px] font-semibold leading-snug text-ink-1">{u.title}</div>
                {u.memo && (
                  <div className="mb-1.5 line-clamp-2 border-l-2 border-[#B8D4EF] pl-1.5 text-[11.5px] leading-snug text-ink-2">
                    {u.memo}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[10.5px] text-ink-3">
                    {u.projectName} · {md(u.latestMemoAt)}
                  </span>
                  <button
                    onClick={(e) => review(e, u)}
                    title="확인 — 업데이트 목록에서 빠집니다 (새 메모가 달리면 다시 뜹니다)"
                    className="flex-shrink-0 rounded-md border border-primary bg-white px-2 py-[2px] text-[11px] font-semibold text-primary hover:bg-primary hover:text-white"
                  >
                    확인
                  </button>
                </div>
              </div>
            ))}
          </nav>
        )}

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
