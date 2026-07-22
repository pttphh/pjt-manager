import { useState } from 'react'
import Layout from '../components/layout/Layout'
import Button from '../components/ui/Button'
import TodoCheckTab from '../tabs/TodoCheckTab'
import TaskDeployTab from '../tabs/TaskDeployTab'
import ProjectManageTab from '../tabs/ProjectManageTab'
import ProjectFormModal from '../components/project/ProjectFormModal'

type TabKey = 'todo' | 'deploy' | 'pjt'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'todo', label: 'Todo 체크' },
  { key: 'deploy', label: '배포' },
  { key: 'pjt', label: 'PJT 관리' },
]

export default function MainPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('pjt')
  const [showForm, setShowForm] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <Layout>
      <header className="flex flex-shrink-0 items-end justify-between border-b border-line px-7 pt-3.5">
        <div className="flex gap-0.5">
          {TABS.map((t) => {
            const on = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
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
        {activeTab === 'pjt' && (
          <Button variant="primary" className="mb-2 whitespace-nowrap" onClick={() => setShowForm(true)}>
            <span className="text-[15px] font-normal leading-none">+</span>PJT 등록
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'todo' && <TodoCheckTab />}
        {activeTab === 'deploy' && <TaskDeployTab />}
        {activeTab === 'pjt' && <ProjectManageTab key={reloadKey} />}
      </div>

      <ProjectFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => {
          setShowForm(false)
          setReloadKey((k) => k + 1)
        }}
      />
    </Layout>
  )
}
