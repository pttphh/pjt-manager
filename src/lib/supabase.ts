import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 개발 편의: 환경변수 누락 시 콘솔 경고 (앱은 계속 로드됨)
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.',
  )
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: { persistSession: false }, // Supabase Auth 미사용
})
