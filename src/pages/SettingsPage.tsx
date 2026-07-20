import { useEffect, useState } from 'react'
import Layout from '../components/layout/Layout'
import ItemManager from '../components/ui/ItemManager'
import type { ManagedItem, ManagedTable } from '../components/ui/ItemManager'
import { supabase } from '../lib/supabase'

const TABS: { key: ManagedTable; label: string; desc: string; placeholder: string }[] = [
  {
    key: 'divisions',
    label: '구분',
    desc: 'PJT의 구분(필수, 1개)을 관리합니다. 해당 구분을 쓰는 PJT가 있으면 삭제할 수 없습니다.',
    placeholder: '새 구분명',
  },
  {
    key: 'tags',
    label: '태그',
    desc: 'PJT 태그(선택, 복수)를 관리합니다. 사용 중인 태그를 삭제하면 PJT의 태그 연결도 함께 제거됩니다.',
    placeholder: '새 태그명',
  },
  {
    key: 'people',
    label: '멤버',
    desc: '담당자·멤버 명단을 관리합니다. 사용 중인 멤버를 삭제하면 PJT/Task 멤버·Todo 담당자 배정도 함께 제거됩니다.',
    placeholder: '새 멤버 이름',
  },
]

export default function SettingsPage() {
  const [tab, setTab] = useState<ManagedTable>('divisions')
  const [divisions, setDivisions] = useState<ManagedItem[]>([])
  const [tags, setTags] = useState<ManagedItem[]>([])
  const [people, setPeople] = useState<ManagedItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const [d, t, p] = await Promise.all([
        supabase.from('divisions').select('*').order('sort_order'),
        supabase.from('tags').select('*').order('sort_order'),
        supabase.from('people').select('*').order('name'),
      ])
      setDivisions((d.data as ManagedItem[]) ?? [])
      setTags((t.data as ManagedItem[]) ?? [])
      setPeople((p.data as ManagedItem[]) ?? [])
    } catch (e) {
      console.error('[SettingsPage] 로드 실패', e)
    } finally {
      setLoading(false)
    }
  }

  const items = tab === 'divisions' ? divisions : tab === 'tags' ? tags : people
  const meta = TABS.find((t) => t.key === tab)!

  return (
    <Layout>
      <header className="flex flex-shrink-0 items-end justify-between border-b border-line px-7 pt-3.5">
        <div className="flex gap-0.5">
          {TABS.map((t) => {
            const on = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`border-b-2 px-3.5 py-[9px] text-[13.5px] transition-colors hover:text-ink-1 ${
                  on
                    ? 'border-primary font-semibold text-ink-1'
                    : 'border-transparent font-normal text-ink-3'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <span className="mb-2.5 text-[12px] font-semibold text-ink-2">설정</span>
      </header>

      <div className="flex-1 overflow-y-auto px-7 pb-8 pt-5">
        {loading ? (
          <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
        ) : (
          <section
            className="max-w-[560px] rounded-xl"
            style={{ border: '1px solid #E2E0DB', background: '#FBFBFA', padding: '14px 15px' }}
          >
            <p
              className="text-[13px] font-bold text-ink-1"
              style={{ paddingBottom: 10, marginBottom: 11, borderBottom: '1px solid #E2E0DB' }}
            >
              {meta.label} 관리{' '}
              <span className="text-[11px] font-normal text-ink-4">— {items.length}개</span>
            </p>
            <p className="mb-3 text-[11.5px] leading-[1.6] text-ink-3">{meta.desc}</p>
            <ItemManager
              table={tab}
              items={items}
              onChanged={load}
              addPlaceholder={meta.placeholder}
            />
          </section>
        )}
      </div>
    </Layout>
  )
}
