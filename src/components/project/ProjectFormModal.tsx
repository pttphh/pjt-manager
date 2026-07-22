import { useEffect, useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import TagInput from '../ui/TagInput'
import InlineManage from '../ui/InlineManage'
import { supabase } from '../../lib/supabase'
import { emitDataChanged } from '../../lib/events'
import { tagSwatch } from '../../lib/colors'
import type { Division, Person, Tag } from '../../types'

interface ProjectFormModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  /** 있으면 편집 모드. 없으면 신규 등록. */
  projectId?: string
}

export default function ProjectFormModal({ open, onClose, onSaved, projectId }: ProjectFormModalProps) {
  const isEdit = !!projectId
  const [divisions, setDivisions] = useState<Division[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [manage, setManage] = useState<null | 'divisions' | 'tags'>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [links, setLinks] = useState<string[]>([])
  const [urgent, setUrgent] = useState(false)
  const [important, setImportant] = useState(false)
  const [divisionId, setDivisionId] = useState('')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [members, setMembers] = useState<Person[]>([])
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) void loadRefs()
  }, [open])

  useEffect(() => {
    if (open && isEdit) void loadProject()
    if (open && !isEdit) resetForm()
  }, [open, projectId])

  async function loadRefs() {
    const [{ data: d }, { data: t }] = await Promise.all([
      supabase.from('divisions').select('*').order('sort_order'),
      supabase.from('tags').select('*').order('sort_order'),
    ])
    setDivisions((d as Division[]) ?? [])
    setTags((t as Tag[]) ?? [])
    if (!isEdit && !divisionId && d && d.length) setDivisionId((d as Division[])[0].id)
  }

  function resetForm() {
    setName('')
    setDescription('')
    setLinks([])
    setUrgent(false)
    setImportant(false)
    setTagIds([])
    setMembers([])
    setStartDate('')
    setDueDate('')
  }

  async function loadProject() {
    const { data } = await supabase
      .from('projects')
      .select('*, project_tags(tag_id), project_members(people(id, name))')
      .eq('id', projectId)
      .single()
    if (!data) return
    setName(data.name ?? '')
    setDescription(data.description ?? '')
    setLinks(
      (data.link_urls && data.link_urls.length ? data.link_urls : data.link_url ? [data.link_url] : []) as string[],
    )
    setUrgent(!!data.is_urgent)
    setImportant(!!data.is_important)
    setDivisionId(data.division_id ?? '')
    setStartDate(data.start_date ?? '')
    setDueDate(data.due_date ?? '')
    setTagIds((data.project_tags ?? []).map((t: { tag_id: string }) => t.tag_id))
    setMembers(
      (data.project_members ?? []).map((m: { people: Person }) => m.people).filter(Boolean),
    )
  }

  const toggleTag = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  async function save() {
    if (!name.trim() || !divisionId) {
      alert('PJT명과 구분은 필수입니다.')
      return
    }
    setSaving(true)
    try {
      let pid = projectId
      const base = {
        name: name.trim(),
        description: description.trim() || null,
        division_id: divisionId,
        start_date: startDate || null,
        due_date: dueDate || null,
      }
      const cleanLinks = links.map((l) => l.trim()).filter(Boolean)
      const withLink = { ...base, link_urls: cleanLinks, is_urgent: urgent, is_important: important }
      // migrations/006·007 미적용(추가 컬럼 없음) 시에도 저장이 깨지지 않도록 폴백.
      // 읽기는 42703, 쓰기는 PGRST204(schema cache에 컬럼 없음)로 서로 다른 코드가 온다 (컬럼 무관하게 감지).
      const missingCol = (e: { code?: string; message?: string } | null) =>
        !!e && (e.code === '42703' || e.code === 'PGRST204')
      const warnMigration = () =>
        alert('링크·긴급/중요 등 일부 항목이 저장되지 않았습니다.\n최신 마이그레이션(006·007)을 적용하세요.')

      if (isEdit) {
        let { error } = await supabase.from('projects').update(withLink).eq('id', projectId)
        if (missingCol(error)) {
          ;({ error } = await supabase.from('projects').update(base).eq('id', projectId))
          warnMigration()
        }
        if (error) throw error
        await supabase.from('project_tags').delete().eq('project_id', projectId)
        await supabase.from('project_members').delete().eq('project_id', projectId)
      } else {
        let res = await supabase
          .from('projects')
          .insert({ ...withLink, status: 'pending' })
          .select()
          .single()
        if (missingCol(res.error)) {
          res = await supabase
            .from('projects')
            .insert({ ...base, status: 'pending' })
            .select()
            .single()
          warnMigration()
        }
        if (res.error || !res.data) throw res.error
        pid = res.data.id
        // "기타" 상설 Task 자동 생성 (배포 상태 없음 — 배포는 Todo 단위)
        await supabase.from('tasks').insert({
          project_id: pid,
          title: '기타',
          is_misc: true,
        })
      }

      if (pid) {
        if (tagIds.length)
          await supabase
            .from('project_tags')
            .insert(tagIds.map((tag_id) => ({ project_id: pid, tag_id })))
        if (members.length)
          await supabase
            .from('project_members')
            .insert(members.map((m) => ({ project_id: pid, person_id: m.id })))
      }
      emitDataChanged()
      onSaved()
    } catch (e) {
      console.error(e)
      alert('저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!projectId) return
    if (!confirm('이 PJT를 삭제하시겠습니까? 하위 Task·Todo·메모가 모두 함께 삭제됩니다.')) return
    await supabase.from('projects').delete().eq('id', projectId)
    emitDataChanged()
    onSaved()
  }

  const labelCls = 'mb-1 text-[11.5px] font-semibold text-ink-2'
  const inputCls =
    'w-full rounded-lg border border-line-strong px-2.5 py-2 text-[13px] outline-none focus:border-primary'

  return (
    <Modal open={open} onClose={onClose} width={340}>
      <div className="mb-3.5 text-[15px] font-bold">{isEdit ? 'PJT 편집' : '새 프로젝트'}</div>

      <div className={labelCls}>PJT명</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="예: 원가 개선 PJT"
        className={`${inputCls} mb-2`}
      />

      <div className="mb-2.5 flex items-center gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-1">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          🚨 긴급
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-1">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
          💡 중요
        </label>
        {urgent && important && <span className="text-[11px] text-ink-3">→ ⭐ 로 표시</span>}
      </div>

      <div className={labelCls}>기초 사항</div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="자유 텍스트…"
        className={`${inputCls} mb-2.5 h-14 resize-none`}
      />

      <div className={labelCls}>
        링크 <span className="text-[10px] font-normal text-ink-3">— 선택, 여러 개 가능 · 새 창으로 열림</span>
      </div>
      <div className="mb-2.5 flex flex-col gap-1.5">
        {links.map((l, i) => (
          <div key={i} className="flex gap-1.5">
            <input
              type="url"
              value={l}
              onChange={(e) => setLinks((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="https://example.com/…"
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
              title="링크 삭제"
              className="flex-shrink-0 rounded-lg border border-line-strong px-2.5 text-ink-3 hover:text-danger"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => setLinks((prev) => [...prev, ''])}
          className="rounded-lg border border-dashed border-line-strong py-1.5 text-[12px] font-semibold text-ink-2 hover:bg-sidebar-bg"
        >
          + 링크 추가
        </button>
      </div>

      <div className={labelCls}>구분 (필수, 1개)</div>
      <div className="mb-2.5 flex gap-1.5">
        <select
          value={divisionId}
          onChange={(e) => setDivisionId(e.target.value)}
          className={`${inputCls} flex-1`}
        >
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button onClick={() => setManage('divisions')} className="px-3">⚙</Button>
      </div>

      <div className={labelCls}>태그 (선택, 복수)</div>
      <div className="mb-2.5 flex items-start gap-1.5">
        <div className="flex flex-1 flex-wrap gap-1 rounded-lg border border-line-strong p-2">
          {tags.length === 0 && <span className="text-[11px] text-ink-3">태그 없음</span>}
          {tags.map((t, i) => {
            const sw = tagSwatch(i)
            const on = tagIds.includes(t.id)
            return (
              <button
                key={t.id}
                onClick={() => toggleTag(t.id)}
                style={
                  on
                    ? { background: sw.bg, color: sw.fg, border: `1px solid ${sw.bd}` }
                    : undefined
                }
                className={`rounded-full px-2 py-[1px] text-[11px] font-semibold ${
                  on ? '' : 'border border-line text-ink-3 hover:bg-sidebar-bg'
                }`}
              >
                {t.name}
              </button>
            )
          })}
        </div>
        <Button
          onClick={() => setManage('tags')}
          className="border-primary px-3 text-primary"
        >
          ⚙
        </Button>
      </div>

      <div className={labelCls}>멤버</div>
      <div className="mb-2.5">
        <TagInput value={members} onChange={setMembers} />
      </div>

      <div className="mb-3.5 grid grid-cols-2 gap-2.5">
        <div>
          <div className={labelCls}>시작일</div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <div className={labelCls}>완료 예정일</div>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-3">
        {isEdit ? (
          <Button variant="danger" onClick={remove}>
            삭제
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            저장
          </Button>
        </div>
      </div>

      {!isEdit && (
        <p className="mt-2 text-right text-[10px] text-ink-3">
          저장 시 상태=미진행, "기타" Task 자동 생성(배포됨)
        </p>
      )}

      {manage === 'divisions' && (
        <InlineManage
          title="구분 관리"
          table="divisions"
          items={divisions}
          onChanged={loadRefs}
          onClose={() => setManage(null)}
        />
      )}
      {manage === 'tags' && (
        <InlineManage
          title="태그 관리"
          table="tags"
          items={tags}
          onChanged={loadRefs}
          onClose={() => setManage(null)}
        />
      )}
    </Modal>
  )
}
