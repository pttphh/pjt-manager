import { createClient } from '@supabase/supabase-js'

// 배포 환경변수 붙여넣기 실수 방어: 줄바꿈·공백·중복 붙여넣기가 섞여도 첫 토큰만 사용.
// (값에 개행이 들어가면 fetch 가 "invalid header"로 요청 자체를 못 보내는 사고 방지 — 2026-07 Vercel 배포에서 실제 발생)
const clean = (v: string | undefined) => (v ?? '').trim().split(/\s+/)[0] ?? ''

const url = clean(import.meta.env.VITE_SUPABASE_URL)
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

if (!url || !anonKey) {
  // 개발 편의: 환경변수 누락 시 콘솔 경고 (앱은 계속 로드됨)
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.',
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: false }, // Supabase Auth 미사용
})
