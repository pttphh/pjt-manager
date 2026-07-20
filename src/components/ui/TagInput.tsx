import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Person } from '../../types'

interface TagInputProps {
  value: Person[]
  onChange: (people: Person[]) => void
}

/** 멤버(people) 선택 입력. 기존 인원 선택 + 새 이름 입력 시 people 테이블에 생성. */
export default function TagInput({ value, onChange }: TagInputProps) {
  const [all, setAll] = useState<Person[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void supabase
      .from('people')
      .select('*')
      .order('name')
      .then(({ data }) => setAll((data as Person[]) ?? []))
  }, [])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selectedIds = new Set(value.map((p) => p.id))
  const candidates = all.filter(
    (p) => !selectedIds.has(p.id) && p.name.toLowerCase().includes(query.toLowerCase()),
  )
  const exactExists = all.some((p) => p.name === query.trim())

  const addPerson = (p: Person) => {
    onChange([...value, p])
    setQuery('')
    setOpen(false)
  }

  const createAndAdd = async () => {
    const name = query.trim()
    if (!name) return
    const { data } = await supabase.from('people').insert({ name }).select().single()
    if (data) {
      const p = data as Person
      setAll((prev) => [...prev, p])
      addPerson(p)
    }
  }

  const remove = (id: string) => onChange(value.filter((p) => p.id !== id))

  return (
    <div ref={boxRef} className="relative">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line-strong px-2 py-1.5">
        {value.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-sidebar-bg px-2 py-[1px] text-[11px]"
          >
            {p.name}
            <button className="text-ink-3 hover:text-danger" onClick={() => remove(p.id)}>
              ✕
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (candidates.length > 0) addPerson(candidates[0])
              else if (query.trim() && !exactExists) void createAndAdd()
            }
          }}
          placeholder={value.length ? '' : '+ 추가'}
          className="min-w-[70px] flex-1 bg-transparent py-0.5 text-[12px] outline-none placeholder:text-ink-3"
        />
      </div>
      {open && (query || candidates.length > 0) && (
        <div className="absolute left-0 top-full z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          {candidates.map((p) => (
            <button
              key={p.id}
              onClick={() => addPerson(p)}
              className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-sidebar-bg"
            >
              {p.name}
            </button>
          ))}
          {query.trim() && !exactExists && (
            <button
              onClick={createAndAdd}
              className="block w-full px-3 py-1.5 text-left text-[12px] text-primary hover:bg-sidebar-bg"
            >
              + "{query.trim()}" 새로 추가
            </button>
          )}
        </div>
      )}
    </div>
  )
}
