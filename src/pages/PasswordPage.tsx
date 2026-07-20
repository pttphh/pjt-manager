import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { login, isAuthenticated } from '../lib/auth'

export default function PasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  if (isAuthenticated()) {
    return <Navigate to="/main" replace />
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (login(password)) {
      navigate('/main', { replace: true })
    } else {
      setError(true)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#EDEBE6]">
      <form
        onSubmit={submit}
        className="flex w-[320px] flex-col items-center gap-3 rounded-xl border border-line bg-white px-8 py-12"
      >
        <div className="mb-1 text-[15px] font-semibold text-ink-1">프로젝트 관리 툴</div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(false)
          }}
          placeholder="비밀번호"
          className="w-[200px] rounded-lg border border-line-strong px-3 py-2 text-center text-sm outline-none focus:border-primary"
        />
        <button
          type="submit"
          className="w-[200px] rounded-lg bg-primary py-2 text-sm font-semibold text-white hover:bg-[#124e88]"
        >
          입장
        </button>
        {error && (
          <span className="text-xs text-danger">비밀번호가 올바르지 않습니다</span>
        )}
      </form>
    </div>
  )
}
