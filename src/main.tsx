import { StrictMode, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { AdminBooks, AdminFellowship, AdminLayout, AdminModeration } from './admin'
import { AuthProvider, OAuthCallback } from './auth'
import { ManageAdmins } from './manage-admins'
import { BookPage, FellowshipPage, Home, Library } from './library'
import { AccountPage, Footer, Header } from './ui'
import './styles.css'

function App() {
  const { pathname, search, hash } = useLocation()
  const previousPath = useRef(pathname)
  useLayoutEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    window.scrollTo(0,0)
    document.getElementById('main')?.focus({preventScroll:true})
  }, [pathname])
  return <>
    <a href="#main" className="skip">Skip to content</a>
    <Header />
    <main id="main" tabIndex={-1}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/adults" element={<Library key="adults" audience="Adults" />} />
        <Route path="/children" element={<Library key="children" audience="Children" />} />
        <Route path="/books" element={<Library key="books" />} />
        <Route path="/books/:slug" element={<BookPage />} />
        <Route path="/fellowship" element={<FellowshipPage />} />
        <Route path="/account" element={new URLSearchParams(search).has("code") || new URLSearchParams(search).has("error") || hash.includes("error=") ? <OAuthCallback /> : <AccountPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminBooks />} />
          <Route path="manage-admins" element={<ManageAdmins />} />
          <Route path="moderation" element={<AdminModeration />} />
          <Route path="fellowship" element={<AdminFellowship />} />
        </Route>
        <Route path="*" element={<section className="container content-panel"><h1>Page not found</h1><Link to="/">Back to the library</Link></section>} />
      </Routes>
    </main>
    <Footer />
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></StrictMode>)
