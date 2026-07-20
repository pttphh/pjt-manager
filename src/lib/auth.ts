const KEY = 'authenticated'

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(KEY) === 'true'
}

export function login(password: string): boolean {
  // 배포 환경변수에 공백/줄바꿈이 섞여 들어가도 동작하도록 방어
  const expected = (import.meta.env.VITE_APP_PASSWORD ?? '').trim()
  if (password && password === expected) {
    sessionStorage.setItem(KEY, 'true')
    return true
  }
  return false
}

export function logout() {
  sessionStorage.removeItem(KEY)
}
