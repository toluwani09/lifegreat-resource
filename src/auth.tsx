import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { Link, useLocation, useNavigate } from 'react-router-dom'
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
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function signIn() {
    setBusy(true)
    setError('')
    try {
      const redirectTo = new URL('/account', window.location.origin).href
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

export function OAuthCallback() {
  const { search, hash } = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const exchange = useRef<{code: string; promise: Promise<unknown>} | null>(null)

  useEffect(() => {
    let active = true
    async function complete() {
      const params = new URLSearchParams(search)
      const fragment = new URLSearchParams(hash.slice(1))
      const code = params.get('code')
      if (!code || params.has('error') || fragment.has('error')) {
        throw new Error('Google sign-in was not completed. Please try again.')
      }
      if (exchange.current?.code !== code) {
        exchange.current = {code, promise: backend().auth.exchangeCodeForSession(code).then(result => {
          if (result.error || !result.data.session) throw new Error('We couldn’t finish Google sign-in. Please try again.')
        })}
      }
      await exchange.current.promise
      if (active) void navigate('/', { replace:true })
    }
    void complete().catch(error => { if (active) setError(errorMessage(error)) })
    return () => { active = false }
  }, [search, hash, navigate])

  return <section className="container content-panel narrow">
    <h1>Google sign-in</h1>
    {error ? <><p className="inline-error" role="alert">{error}</p><Link to="/account">Back to sign-in</Link></>
      : <p role="status">Finishing sign-in…</p>}
  </section>
}
