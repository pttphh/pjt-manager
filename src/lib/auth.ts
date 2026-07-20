const KEY = 'authenticated'

export function isAuthenticated(): boolean {
  return sessionStorage.getItem(KEY) === 'true'
}

export function login(password: string): boolean {
  const expected = import.meta.env.VITE_APP_PASSWORD
  if (password && password === expected) {
    sessionStorage.setItem(KEY, 'true')
    return true
  }
  return false
}

export function logout() {
  sessionStorage.removeItem(KEY)
}
