import ItemManager from './ItemManager'
import type { ManagedItem, ManagedTable } from './ItemManager'

interface InlineManageProps {
  title: string
  table: ManagedTable
  items: ManagedItem[]
  onChanged: () => void
  onClose: () => void
}

/**
 * ProjectFormModal 안의 ⚙ 인라인 구분·태그 관리 팝업.
 * 목록/수정/삭제/추가 로직은 ItemManager 로 공용화되어 설정 화면과 동일하게 동작한다.
 */
export default function InlineManage({ title, table, items, onChanged, onClose }: InlineManageProps) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(31,30,27,0.4)] p-7"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[260px] rounded-2xl border border-line bg-white p-[18px] shadow-[0_8px_24px_rgba(0,0,0,0.15)]"
      >
        <div className="mb-2.5 text-[13px] font-bold">{title}</div>
        <ItemManager table={table} items={items} onChanged={onChanged} dense />
      </div>
    </div>
  )
}
