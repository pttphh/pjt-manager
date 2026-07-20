import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { DATA_CHANGED } from '../../lib/events'
import type { Division, Project } from '../../types'

const SIDEBAR_KEY = 'pm_sidebar_w'
const COLLAPSE_KEY = 'pm_sidebar_collapsed'
const MIN_W = 160
const MAX_W = 320

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: activePjtId } = useParams()
  const [width, setWidth] = useState(() => {
    const w = Number(localStorage.getItem(SIDEBAR_KEY))
    return w ? Math.min(MAX_W, Math.max(MIN_W, w)) : 208
  })
  const [divisions, setDivisions] = useState<Division[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [dragId, setDragId] = useState<string | null>(null) // 드래그 중인 PJT
  const [dropId, setDropId] = useState<string | null>(null) // 위에 올라간 대상 PJT
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}')
    } catch {
      return {}
    }
  })

  // 마운트·라우트 이동 시 로드 + 데이터 변경 이벤트 구독 (등록/편집/삭제·상태변경 즉시 반영)
  useEffect(() => {
    void loadTree()
  }, [location.pathname])

  useEffect(() => {
    const onChange = () => void loadTree()
    window.addEventListener(DATA_CHANGED, onChange)
    return () => window.removeEventListener(DATA_CHANGED, onChange)
  }, [])

  async function loadTree() {
    // 구분과 프로젝트 로드를 분리한다. 프로젝트가 없거나 로드에 실패하더라도
    // '구분'은 항상 사이드바에 떠 있어야 하므로 서로의 실패에 영향받지 않게 한다.
    const [divRes, pjtRes] = await Promise.allSettled([
      supabase.from('divisions').select('*').order('sort_order'),
      // select('*') 로 받아 migrations/004(sidebar_sort) 미적용이어도 깨지지 않게 한다.
      supabase.from('projects').select('*').neq('status', 'done'),
    ])
    if (divRes.status === 'fulfilled') {
      setDivisions((divRes.value.data as Division[]) ?? [])
    } else {
      console.error('[Sidebar] 구분 로드 실패', divRes.reason)
    }
    if (pjtRes.status === 'fulfilled') {
      setProjects((pjtRes.value.data as Project[]) ?? [])
    } else {
      console.error('[Sidebar] 프로젝트 로드 실패', pjtRes.reason)
    }
  }

  const toggle = (divId: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [divId]: !prev[divId] }
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next))
      return next
    })
  }

  // 구분 내 PJT 목록 (사이드바 정렬값 → 이름 순)
  const pjtsOf = (divId: string) =>
    projects
      .filter((p) => p.division_id === divId)
      .sort(
        (a, b) =>
          (a.sidebar_sort ?? 0) - (b.sidebar_sort ?? 0) || a.name.localeCompare(b.name, 'ko'),
      )

  // ---- 드래그 정렬 (같은 구분 내에서만) ----
  async function handleDrop(divId: string, targetId: string) {
    const from = dragId
    setDragId(null)
    setDropId(null)
    if (!from || from === targetId) return
    // 대상이 같은 구분인지 확인
    const target = projects.find((p) => p.id === targetId)
    const moving = projects.find((p) => p.id === from)
    if (!target || !moving || target.division_id !== divId || moving.division_id !== divId) return

    const ordered = pjtsOf(divId)
    const fromIdx = ordered.findIndex((p) => p.id === from)
    const toIdx = ordered.findIndex((p) => p.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const arr = [...ordered]
    const [m] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, m)

    // 로컬 상태에 sidebar_sort 재부여 (즉시 반영)
    const rank = new Map(arr.map((p, i) => [p.id, i]))
    setProjects((prev) =>
      prev.map((p) => (rank.has(p.id) ? { ...p, sidebar_sort: rank.get(p.id)! } : p)),
    )

    // DB 저장
    try {
      const results = await Promise.all(
        arr.map((p, i) => supabase.from('projects').update({ sidebar_sort: i }).eq('id', p.id)),
      )
      const err = results.find((r) => r.error)?.error as { code?: string; message?: string } | undefined
      if (err && (err.code === '42703' || err.code === 'PGRST204' || /sidebar_sort/.test(err.message ?? ''))) {
        alert('정렬 순서를 저장하지 못했습니다.\nmigrations/004-sidebar-sort.sql 을 적용하세요.')
        void loadTree()
      }
    } catch (e) {
      console.error('[Sidebar] 정렬 저장 실패', e)
    }
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
        <nav className="flex flex-col gap-0.5 px-2.5">
          <button
            onClick={() => navigate('/main')}
            className="flex items-center gap-[7px] rounded-[7px] bg-primary-light px-[9px] py-[7px] text-left text-[12.5px] font-semibold text-primary-text"
          >
            <span className="inline-block h-[5px] w-[5px] rounded-full bg-primary" />
            전체
          </button>
        </nav>

        <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-ink-3">
          구분
        </div>
        <nav className="flex flex-col gap-px px-2.5 pb-3.5">
          {divisions.map((div) => {
            const pjts = pjtsOf(div.id)
            const open = !collapsed[div.id]
            return (
              <div key={div.id}>
                <button
                  onClick={() => toggle(div.id)}
                  className="flex w-full items-center justify-between rounded-[7px] px-[9px] py-[7px] text-left text-sm font-bold text-[#2A2825] hover:bg-hover-bg"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 text-[10px] text-ink-3">{open ? '▾' : '▸'}</span>
                    {div.name}
                  </span>
                  <span className="text-[10px] font-medium text-ink-4">{pjts.length}</span>
                </button>
                {open && pjts.length > 0 && (
                  <div className="flex flex-col gap-px py-[1px] pb-[3px]">
                    {pjts.map((p) => (
                      <button
                        key={p.id}
                        draggable
                        onDragStart={() => setDragId(p.id)}
                        onDragEnd={() => {
                          setDragId(null)
                          setDropId(null)
                        }}
                        onDragOver={(e) => {
                          if (dragId && dragId !== p.id) {
                            e.preventDefault()
                            if (dropId !== p.id) setDropId(p.id)
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          void handleDrop(div.id, p.id)
                        }}
                        onClick={() => {
                          if (!dragId) navigate(`/project/${p.id}`)
                        }}
                        title="클릭: 세부화면 · 드래그: 순서 변경"
                        className={`flex items-center gap-1.5 rounded-md py-[5px] pl-6 pr-[9px] text-left text-[12.5px] hover:bg-hover-bg hover:text-primary ${
                          activePjtId === p.id ? 'bg-hover-bg font-semibold text-primary' : 'text-ink-1'
                        } ${dragId === p.id ? 'opacity-40' : ''} ${
                          dropId === p.id && dragId !== p.id ? 'border-t-2 border-primary' : 'border-t-2 border-transparent'
                        }`}
                      >
                        <span className="h-1 w-1 flex-shrink-0 rounded-[1px] bg-ink-4" />
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
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
