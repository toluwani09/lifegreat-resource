import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { useLocation } from 'react-router-dom'
import { backend, client, errorMessage, unwrap } from './data'

const AuthContext = createContext<{ user: User | null; admin: boolean; busy: boolean; error?: string }>({
  user: null, admin: false, busy: Boolean(client),
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [adminId, setAdminId] = useState<string | null>(null)
  const [initial, setInitial] = useState(Boolean(client))
  const [checked, setChecked] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const id = user?.id
  useEffect(() => {
    if (!client) return
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setInitial(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!id) return
    let active = true
    void (async () => {
      try {
        const allowed = unwrap(await backend().rpc('is_admin'))
        if (active) { setAdminId(allowed ? id : null); setError(undefined) }
      } catch (error) {
        if (active) { setAdminId(null); setError(errorMessage(error)) }
      } finally {
        if (active) setChecked(id)
      }
    })()
    return () => { active = false }
  }, [id])
  return <AuthContext.Provider value={{user, admin: Boolean(id && adminId === id), busy: initial || Boolean(id && checked !== id), error}}>
    {children}
  </AuthContext.Provider>
}

export function useAuth() { return useContext(AuthContext) }

export function SignIn({ className = 'button button-primary' }: {className?: string}) {
  const location = useLocation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signIn() {
    setBusy(true)
    setError('')
    try {
      const redirectTo = new URL(location.pathname + location.search, window.location.origin).href
      const { error } = await backend().auth.signInWithOAuth({provider:'google', options:{redirectTo}})
      if (error) throw error
    } catch (error) {
      setError(errorMessage(error))
      setBusy(false)
    }
  }
  return <span className="sign-in">
    <button className={className} disabled={busy} onClick={() => void signIn()}>Sign in with Google</button>
    {error && <span className="inline-error" role="alert">{error}</span>}
  </span>
}
