import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TAG_SWATCHES, tagSwatch } from '../lib/colors'
import { STATUS_CARD_STYLE, projectColor, priorityIcon } from '../types'
import type { ProjectStatus, Tag } from '../types'

interface TagLink {
  tagId: string
  sort: number
}
interface PjtRow {
  id: string
  name: string
  status: ProjectStatus
  division_id: string
  urgent: boolean
  important: boolean
  regular: boolean
  tags: TagLink[]
  sort: number // '태그 없음' 컬럼용 정렬값
}
interface RawProject {
  id: string
  name: string
  status: ProjectStatus
  division_id: string
  sort_order: number | null
  is_urgent?: boolean | null
  is_important?: boolean | null
  is_regular?: boolean | null
  project_tags: { tag_id: string; sort_order: number | null }[] | null
}

// 상태 필터(다중 선택). 기본은 완료를 제외한 3개.
const ALL_STATUSES: ProjectStatus[] = ['pending', 'active', 'hold', 'done']
const DEFAULT_STATUSES: ProjectStatus[] = ['pending', 'active', 'hold']
const LONG_PRESS = 170

// 컬럼 고정 폭: 화면에 ~4개만 보이고 나머지는 가로 스크롤 (gap 14px × 3 = 42px 보정)
const COL_STYLE = { flex: '0 0 calc((100% - 42px) / 4)' } as const

function tagColor(tag: Tag, index: number) {
  if (tag.color_bg && tag.color_fg && tag.color_bd) {
    return { bg: tag.color_bg, fg: tag.color_fg, bd: tag.color_bd }
  }
  return tagSwatch(index)
}

export default function ProjectManageTab() {
  const navigate = useNavigate()
  const [tags, setTags] = useState<Tag[]>([])
  const [projects, setProjects] = useState<PjtRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ProjectStatus[]>(DEFAULT_STATUSES)

  // 드래그 상태
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [dragCard, setDragCard] = useState<{ col: string; id: string } | null>(null)

  // 태그 편집 팝업 상태
  const [editing, setEditing] = useState<Tag | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(TAG_SWATCHES[0])

  // 비동기 저장 시 최신값을 읽기 위한 미러 ref
  const tagsRef = useRef<Tag[]>([])
  const projRef = useRef<PjtRow[]>([])
  const dragCardRef = useRef<{ col: string; id: string } | null>(null)
  tagsRef.current = tags
  projRef.current = projects
  dragCardRef.current = dragCard
  const holdTimer = useRef<ReturnType<typeof setTimeout>>()
  // 드래그(길게 누름)로 시작된 상호작용이면 뒤따르는 click 을 억제 (카드가 상세로 튀는 것 방지)
  const didDragRef = useRef(false)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [tagRes, pjtRes] = await Promise.all([
        supabase.from('tags').select('*').order('sort_order'),
        // 완료 PJT도 필터로 볼 수 있어야 하므로 전체 상태를 불러온다 (표시는 statusFilter로 제어)
        // select('*') 로 받아 migration 007(is_urgent/is_important) 미적용이어도 깨지지 않게 한다.
        supabase.from('projects').select('*, project_tags(tag_id, sort_order)'),
      ])
      setTags((tagRes.data as Tag[]) ?? [])
      if (pjtRes.error) {
        // 대개 migration 002 (sort_order/색 컬럼) 미적용
        console.error('[ProjectManageTab] 프로젝트 로드 실패', pjtRes.error)
        // 원인별 안내: 컬럼 없음(42703)일 때만 마이그레이션 안내, 그 외엔 실제 에러 메시지 표시
        setLoadError(
          pjtRes.error.code === '42703'
            ? 'PJT 데이터를 불러오지 못했습니다. migrations/002-tag-color-and-sort.sql 이 적용됐는지 확인하세요.'
            : `PJT 데이터를 불러오지 못했습니다: ${pjtRes.error.message ?? '알 수 없는 오류'} (환경변수·네트워크를 확인하세요)`,
        )
        setProjects([])
      } else {
        setProjects(
          ((pjtRes.data as RawProject[]) ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            division_id: p.division_id,
            urgent: !!p.is_urgent,
            important: !!p.is_important,
            regular: !!p.is_regular,
            sort: p.sort_order ?? 0,
            tags: (p.project_tags ?? []).map((t) => ({ tagId: t.tag_id, sort: t.sort_order ?? 0 })),
          })),
        )
      }
    } catch (e) {
      console.error('[ProjectManageTab] 데이터 로드 실패', e)
    } finally {
      setLoading(false)
    }
  }

  // ---- 컬럼별 카드 목록 (상태 필터 + 정렬 적용) ----
  const linkSort = (p: PjtRow, tagId: string) => p.tags.find((t) => t.tagId === tagId)?.sort ?? 0
  const inFilter = (p: PjtRow) => statusFilter.includes(p.status)
  const cardsForTag = (tagId: string) =>
    projects
      .filter((p) => inFilter(p) && p.tags.some((t) => t.tagId === tagId))
      .sort((a, b) => linkSort(a, tagId) - linkSort(b, tagId))
  const untagged = () =>
    projects.filter((p) => inFilter(p) && p.tags.length === 0).sort((a, b) => a.sort - b.sort)
  const toggleStatus = (s: ProjectStatus) =>
    setStatusFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  // ---- 컬럼(태그) 드래그: 길게 눌러 좌우 이동 ----
  const startColHold = (e: React.PointerEvent, tagId: string) => {
    e.preventDefault()
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      setDragColId(tagId)
      document.addEventListener('pointermove', onColMove)
      document.addEventListener('pointerup', endColDrag)
      document.body.style.userSelect = 'none'
    }, LONG_PRESS)
    document.addEventListener('pointerup', cancelHold, { once: true })
  }
  const onColMove = (e: PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const c = el?.closest('[data-col]')
    const over = c?.getAttribute('data-col')
    setDragColId((cur) => {
      if (!over || over === 'none' || !cur || over === cur) return cur
      setTags((prev) => {
        const from = prev.findIndex((t) => t.id === cur)
        const to = prev.findIndex((t) => t.id === over)
        if (from < 0 || to < 0) return prev
        const next = [...prev]
        const [m] = next.splice(from, 1)
        next.splice(to, 0, m)
        return next
      })
      return cur
    })
  }
  const endColDrag = () => {
    document.removeEventListener('pointermove', onColMove)
    document.removeEventListener('pointerup', endColDrag)
    document.body.style.userSelect = ''
    setDragColId(null)
    void persistColumnOrder()
  }

  // ---- 카드 드래그: 길게 눌러 컬럼 내 상하 이동 ----
  const startCardHold = (e: React.PointerEvent, col: string, id: string) => {
    e.preventDefault()
    didDragRef.current = false
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      didDragRef.current = true
      setDragCard({ col, id })
      document.addEventListener('pointermove', onCardMove)
      document.addEventListener('pointerup', endCardDrag)
      document.body.style.userSelect = 'none'
    }, LONG_PRESS)
    document.addEventListener('pointerup', cancelHold, { once: true })
  }
  const onCardMove = (e: PointerEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const c = el?.closest('[data-card-col]')
    if (!c) return
    const overCol = c.getAttribute('data-card-col')!
    const overId = c.getAttribute('data-card-id')!
    setDragCard((d) => {
      if (!d || overCol !== d.col || overId === d.id) return d
      reorderCard(d.col, d.id, overId)
      return d
    })
  }
  const endCardDrag = () => {
    document.removeEventListener('pointermove', onCardMove)
    document.removeEventListener('pointerup', endCardDrag)
    document.body.style.userSelect = ''
    // stale 클로저 방지: 최신 dragCard 를 ref 에서 읽는다
    const col = dragCardRef.current?.col
    setDragCard(null)
    if (col) void persistCardOrder(col)
  }

  const cancelHold = () => clearTimeout(holdTimer.current)

  // 컬럼 내에서 fromId 를 toId 자리로 이동 → sort 값 재부여 (로컬 상태)
  function reorderCard(col: string, fromId: string, toId: string) {
    setProjects((prev) => {
      const inCol =
        col === 'none'
          ? prev.filter((p) => p.tags.length === 0).sort((a, b) => a.sort - b.sort)
          : prev.filter((p) => p.tags.some((t) => t.tagId === col)).sort((a, b) => linkSort(a, col) - linkSort(b, col))
      const from = inCol.findIndex((p) => p.id === fromId)
      const to = inCol.findIndex((p) => p.id === toId)
      if (from < 0 || to < 0) return prev
      const arr = [...inCol]
      const [m] = arr.splice(from, 1)
      arr.splice(to, 0, m)
      const rank = new Map(arr.map((p, i) => [p.id, i]))
      return prev.map((p) => {
        if (!rank.has(p.id)) return p
        const i = rank.get(p.id)!
        if (col === 'none') return { ...p, sort: i }
        return { ...p, tags: p.tags.map((t) => (t.tagId === col ? { ...t, sort: i } : t)) }
      })
    })
  }

  async function persistColumnOrder() {
    try {
      await Promise.all(
        tagsRef.current.map((t, i) => supabase.from('tags').update({ sort_order: i }).eq('id', t.id)),
      )
    } catch (e) {
      console.error('[ProjectManageTab] 컬럼 순서 저장 실패', e)
    }
  }

  async function persistCardOrder(col: string) {
    try {
      const ps = projRef.current
      const inCol =
        col === 'none'
          ? ps.filter((p) => p.tags.length === 0).sort((a, b) => a.sort - b.sort)
          : ps.filter((p) => p.tags.some((t) => t.tagId === col)).sort((a, b) => linkSort(a, col) - linkSort(b, col))
      await Promise.all(
        inCol.map((p, i) =>
          col === 'none'
            ? supabase.from('projects').update({ sort_order: i }).eq('id', p.id)
            : supabase.from('project_tags').update({ sort_order: i }).eq('project_id', p.id).eq('tag_id', col),
        ),
      )
    } catch (e) {
      console.error('[ProjectManageTab] 카드 순서 저장 실패', e)
    }
  }

  // ---- 태그 편집 팝업 ----
  function openEdit(tag: Tag, index: number) {
    setEditing(tag)
    setEditName(tag.name)
    setEditColor(tagColor(tag, index))
  }
  async function saveEdit() {
    if (!editing || !editName.trim()) return
    const patch = {
      name: editName.trim(),
      color_bg: editColor.bg,
      color_fg: editColor.fg,
      color_bd: editColor.bd,
    }
    setTags((prev) => prev.map((t) => (t.id === editing.id ? { ...t, ...patch } : t)))
    setEditing(null)
    try {
      await supabase.from('tags').update(patch).eq('id', editing.id)
    } catch (e) {
      console.error('[ProjectManageTab] 태그 저장 실패', e)
      void load()
    }
  }

  function Card({ pjt, col }: { pjt: PjtRow; col: string }) {
    const s = projectColor(pjt.status, pjt.urgent)
    const dragging = dragCard?.col === col && dragCard?.id === pjt.id
    return (
      <button
        data-card-col={col}
        data-card-id={pjt.id}
        onPointerDown={(e) => startCardHold(e, col, pjt.id)}
        onClick={() => {
          if (didDragRef.current) {
            didDragRef.current = false
            return
          }
          navigate(`/project/${pjt.id}`)
        }}
        title="클릭: 세부화면 · 길게 눌러 위아래로 이동"
        style={{
          background: s.bg,
          borderColor: dragging ? '#185FA5' : s.bd,
          color: s.fg,
          outline: dragging ? '2px solid #185FA5' : undefined,
          outlineOffset: dragging ? -2 : undefined,
        }}
        className="cursor-grab select-none rounded-lg border px-[11px] py-2.5 text-left text-[13px] font-medium leading-[1.4] transition hover:brightness-[0.97] active:cursor-grabbing"
      >
        {(() => {
          const icon = priorityIcon(pjt.urgent, pjt.important, pjt.regular)
          return icon ? <span className="mr-1">{icon}</span> : null
        })()}
        {pjt.name}
      </button>
    )
  }

  return (
    <div className="px-7 pb-8 pt-5">
      {/* 상태 필터(다중 선택) — 칩 색이 곧 카드 색 범례 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[11.5px]">
        <span className="text-ink-3">상태</span>
        {ALL_STATUSES.map((status) => {
          const s = STATUS_CARD_STYLE[status]
          const on = statusFilter.includes(status)
          return (
            <button
              key={status}
              onClick={() => toggleStatus(status)}
              title={on ? '클릭하면 숨김' : '클릭하면 표시'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '11.5px',
                fontWeight: on ? 600 : 400,
                borderRadius: 999,
                padding: '5px 12px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: on ? s.bg : '#fff',
                color: on ? s.fg : '#B4B1A9',
                border: `1px solid ${on ? s.bd : '#E2E0DB'}`,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: on ? s.fg : '#E2E0DB',
                  opacity: on ? 0.55 : 1,
                }}
              />
              {s.label}
            </button>
          )
        })}
        <span className="text-ink-4">· 복수 태그 PJT는 각 컬럼에 중복 노출 · 길게 눌러 컬럼·카드 이동</span>
      </div>

      {loadError && (
        <div className="mb-4 rounded-lg border border-[#E0C9A6] bg-warning-light px-3 py-2 text-[12px] text-warning">
          ⚠ {loadError}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
      ) : (
        <div className="flex items-start gap-3.5 overflow-x-auto pb-2">
          {tags.map((tag, i) => {
            const c = tagColor(tag, i)
            const cards = cardsForTag(tag.id)
            return (
              <section
                key={tag.id}
                data-col={tag.id}
                style={{
                  ...COL_STYLE,
                  ...(dragColId === tag.id ? { outline: '2px solid #185FA5', outlineOffset: -2 } : {}),
                }}
                className="rounded-xl bg-sidebar-bg p-[11px]"
              >
                <div className="mb-[11px] flex items-center justify-between gap-1.5 px-0.5">
                  <div
                    onPointerDown={(e) => startColHold(e, tag.id)}
                    title="길게 눌러 좌우로 이동"
                    className="flex min-w-0 flex-1 cursor-grab select-none items-center gap-[7px] active:cursor-grabbing"
                  >
                    <span
                      className="truncate rounded-[5px] px-[9px] py-[2px] text-[11px] font-semibold leading-[1.35] [word-break:keep-all]"
                      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}
                    >
                      {tag.name}
                    </span>
                    <span className="flex-shrink-0 text-[11px] text-ink-4">{cards.length}</span>
                  </div>
                  <button
                    onClick={() => openEdit(tag, i)}
                    title="태그명·색상 변경"
                    className="flex-shrink-0 rounded-md px-1.5 py-[3px] text-[13px] leading-none text-ink-3 hover:bg-hover-bg hover:text-primary"
                  >
                    ✎
                  </button>
                </div>
                <div className="flex flex-col gap-[7px]">
                  {cards.map((p) => (
                    <Card key={`${tag.id}-${p.id}`} pjt={p} col={tag.id} />
                  ))}
                </div>
              </section>
            )
          })}

          {/* 태그 없음 컬럼 */}
          <section data-col="none" style={COL_STYLE} className="rounded-xl bg-sidebar-bg p-[11px]">
            <div className="mb-[11px] flex items-center gap-[7px] px-0.5">
              <span className="rounded-[5px] border border-line bg-white px-[9px] py-[2px] text-[11px] font-semibold leading-[1.35] text-ink-2 [word-break:keep-all]">
                태그 없음
              </span>
              <span className="text-[11px] text-ink-4">{untagged().length}</span>
            </div>
            <div className="flex flex-col gap-[7px]">
              {untagged().map((p) => (
                <Card key={`none-${p.id}`} pjt={p} col="none" />
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 태그 편집 팝업 */}
      {editing && (
        <div
          onClick={() => setEditing(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(31,30,27,0.4)] p-7"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-80 rounded-2xl border border-line bg-white p-[22px] shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
          >
            <div className="mb-4 text-[15px] font-bold">태그 편집</div>
            <div className="mb-1.5 text-[11.5px] font-semibold text-ink-2">태그명</div>
            <input
              value={editName}
              autoFocus
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
              className="mb-4 w-full rounded-lg border border-line-strong px-2.5 py-2 text-[13px] outline-none focus:border-primary"
            />
            <div className="mb-2 text-[11.5px] font-semibold text-ink-2">색상</div>
            <div className="mb-4 flex flex-wrap gap-2">
              {TAG_SWATCHES.map((sw, i) => (
                <button
                  key={i}
                  onClick={() => setEditColor(sw)}
                  style={{
                    background: sw.bg,
                    border: `2px solid ${editColor.bg === sw.bg ? '#185FA5' : '#E2E0DB'}`,
                  }}
                  className="h-7 w-7 rounded-lg"
                />
              ))}
            </div>
            <div className="mb-2 text-[11.5px] font-semibold text-ink-2">미리보기</div>
            <div className="mb-5">
              <span
                className="inline-block rounded-[5px] px-2.5 py-[3px] text-[11px] font-semibold"
                style={{ background: editColor.bg, color: editColor.fg, border: `1px solid ${editColor.bd}` }}
              >
                {editName || '태그'}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg border border-line-strong bg-white px-3.5 py-2 text-[12.5px] font-semibold text-ink-2 hover:bg-sidebar-bg"
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                className="rounded-lg border border-primary bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#124e88]"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
