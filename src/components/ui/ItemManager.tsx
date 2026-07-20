import { useState } from 'react'
import Button from './Button'
import { supabase } from '../../lib/supabase'
import { emitDataChanged } from '../../lib/events'
import { GUARDS } from '../../lib/deleteGuards'

export interface ManagedItem {
  id: string
  name: string
  sort_order?: number | null
}

export type ManagedTable = 'divisions' | 'tags' | 'people'

interface ItemManagerProps {
  table: ManagedTable
  items: ManagedItem[]
  onChanged: () => void
  addPlaceholder?: string
  /** 컴팩트 모드(⚙ 인라인 팝업용) */
  dense?: boolean
}

/**
 * 항목 목록 + 수정/삭제 + 하단 추가 입력 — 구분·태그·멤버 공용.
 * ProjectFormModal 의 ⚙ 인라인 팝업(InlineManage)과 설정 화면이 이 컴포넌트를 함께 사용한다.
 * 삭제는 테이블별 사용처 가드(lib/deleteGuards)를 거친 뒤 확인창을 띄운다.
 */
export default function ItemManager({
  table,
  items,
  onChanged,
  addPlaceholder = '새 이름',
  dense = false,
}: ItemManagerProps) {
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  // people 테이블에는 sort_order 컬럼이 없다 (schema-v2.sql)
  const useSortOrder = table !== 'people'
  const textSize = dense ? 'text-[12px]' : 'text-[13px]'

  async function add() {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    const payload: Record<string, unknown> = { name }
    if (useSortOrder) {
      const max = items.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0)
      payload.sort_order = max + 1
    }
    const { error } = await supabase.from(table).insert(payload)
    setBusy(false)
    if (error) {
      alert(`추가에 실패했습니다: ${error.message}`)
      return
    }
    setNewName('')
    emitDataChanged()
    onChanged()
  }

  async function saveEdit(id: string) {
    const name = editName.trim()
    if (!name) return
    const { error } = await supabase.from(table).update({ name }).eq('id', id)
    if (error) {
      alert(`수정에 실패했습니다: ${error.message}`)
      return
    }
    setEditId(null)
    emitDataChanged()
    onChanged()
  }

  async function remove(item: ManagedItem) {
    const guard = await GUARDS[table]({ id: item.id, name: item.name })
    if (guard.block) {
      alert(guard.block)
      return
    }
    if (!confirm(guard.confirm ?? `'${item.name}'을(를) 삭제하시겠습니까?`)) return
    const { error } = await supabase.from(table).delete().eq('id', item.id)
    if (error) {
      alert(`삭제에 실패했습니다: ${error.message}`)
      return
    }
    emitDataChanged()
    onChanged()
  }

  const ghostBtn =
    'flex-shrink-0 rounded-md px-1.5 py-1 text-[12px] leading-none text-ink-3 hover:bg-hover-bg'

  return (
    <div>
      <div className="flex flex-col">
        {items.length === 0 && (
          <p className={`py-3 ${textSize} text-ink-3`}>항목이 없습니다. 아래에서 추가하세요.</p>
        )}
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-center justify-between gap-2 border-b border-line py-2 last:border-b-0"
          >
            {editId === it.id ? (
              <input
                value={editName}
                autoFocus
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveEdit(it.id)
                  if (e.key === 'Escape') setEditId(null)
                }}
                className={`min-w-0 flex-1 rounded-lg border border-line-strong px-2.5 py-1.5 ${textSize} outline-none focus:border-primary`}
              />
            ) : (
              <span className={`min-w-0 flex-1 truncate ${textSize} text-ink-1`}>{it.name}</span>
            )}
            <span className="flex flex-shrink-0 items-center gap-1">
              {editId === it.id ? (
                <>
                  <button onClick={() => void saveEdit(it.id)} className={`${ghostBtn} font-semibold text-primary`}>
                    저장
                  </button>
                  <button onClick={() => setEditId(null)} className={ghostBtn}>
                    취소
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setEditId(it.id)
                    setEditName(it.name)
                  }}
                  title="이름 수정"
                  className={`${ghostBtn} hover:text-primary`}
                >
                  ✎
                </button>
              )}
              <button onClick={() => void remove(it)} title="삭제" className={`${ghostBtn} hover:text-danger`}>
                🗑
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-1.5">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder={addPlaceholder}
          className={`min-w-0 flex-1 rounded-lg border border-line-strong px-2.5 py-1.5 ${textSize} outline-none focus:border-primary`}
        />
        <Button onClick={() => void add()} disabled={busy} className="flex-shrink-0">
          추가
        </Button>
      </div>
    </div>
  )
}
