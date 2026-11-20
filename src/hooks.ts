import { useEffect, useState } from 'react'
import { errorMessage } from './data'

export function useLoad<T>(loader: () => Promise<T>, refresh = false) {
  const [state, set] = useState<{ data?: T; error?: string; loading: boolean; loader?: typeof loader }>({loading: true})
  useEffect(() => {
    let active = true
    let sequence = 0
    async function load() {
      const version = ++sequence
      try {
        const data = await loader()
        if (active && version === sequence) set({ data, loading: false, loader })
      } catch (error) {
        if (active && version === sequence) set({ error: errorMessage(error), loading: false, loader })
      }
    }
    void load()
    const onFocus = () => { void load() }
    const timer = refresh ? window.setInterval(onFocus, 60_000) : undefined
    if (refresh) window.addEventListener('focus', onFocus)
    return () => {
      active = false
      if (timer !== undefined) window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [loader, refresh])
  return state.loader === loader ? state : {loading:true}
}
