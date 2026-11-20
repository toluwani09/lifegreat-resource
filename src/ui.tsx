import { useState, type ReactNode } from 'react'
import { AlertTriangle, BookOpen, CalendarDays, ChevronDown, ExternalLink, Leaf, Search, Video } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { eventEnd, calendarText, formatEventDate, type Fellowship } from './model'
import { SignIn, useAuth } from './auth'
import { backend, errorMessage, type BookCardData } from './data'

export function Brand() {
  return <Link to="/" className="brand" aria-label="LifeGreat Resource home">
    <span className="brand-icon"><BookOpen size={25} /></span><span>LifeGreat <span>Resource</span></span>
  </Link>
}

export function Header() {
  const { user, admin, busy } = useAuth()
  const [error, setError] = useState('')
  async function signOut() {
    setError('')
    try {
      const { error } = await backend().auth.signOut()
      if (error) throw error
    } catch (error) { setError(errorMessage(error)) }
  }
  return <header className="site-header">
    <div className="container header-inner">
      <Brand />
      <nav aria-label="Main navigation">
        <NavLink to="/" end>Home</NavLink><NavLink to="/adults">Adults</NavLink>
        <NavLink to="/children">Children</NavLink><NavLink to="/fellowship">Fellowship</NavLink>
      </nav>
      <div className="account">
        {!busy && (user
          ? <>{admin && <Link className="admin-link" to="/admin">Admin</Link>}<button className="button button-light" onClick={() => void signOut()}>Sign out</button></>
          : <Link className="button button-light" to="/account">Sign in</Link>)}
        {error && <span className="inline-error" role="alert">{error}</span>}
      </div>
    </div>
  </header>
}

export function Footer() {
  return <footer className="site-footer"><div className="container footer-inner">
    <Brand />
    <nav aria-label="Footer"><Link to="/adults">Adults</Link><Link to="/children">Children</Link><Link to="/fellowship">Fellowship</Link></nav>
  </div></footer>
}

export function Status({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={error ? 'status error' : 'status'} role={error ? 'alert' : 'status'}>
    {error && <AlertTriangle size={20} />}<span>{children}</span>
  </div>
}

export function SearchForm({ query = '', action = '/books' }: {query?: string; action?: string}) {
  const navigate = useNavigate()
  return <form className="search" role="search" onSubmit={event => {
    event.preventDefault()
    const value = String(new FormData(event.currentTarget).get('query') ?? '').trim()
    const params = action === window.location.pathname ? new URLSearchParams(window.location.search) : new URLSearchParams()
    params.delete('page')
    if (value) params.set('q', value)
    else params.delete('q')
    void navigate(params.size ? `${action}?${params}` : action)
  }}>
    <Search size={20} aria-hidden="true" />
    <input key={query} name="query" defaultValue={query} aria-label="Search books or authors" placeholder="Search books or authors" type="search" maxLength={120} />
    <button className="button button-primary" type="submit">Search</button>
  </form>
}

export function BookCover({ book }: {book: BookCardData}) {
  const hue = Array.from(book.slug).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6
  return <div aria-hidden="true" className={`cover cover-${hue} ${book.audience === 'Children' ? 'cover-child' : ''}`}>
    <div className="cover-border">
      {book.topic === 'Christian' ? <BookOpen /> : <Leaf />}
      <span className="cover-title">{book.title}</span><span className="cover-rule" /><small>{book.author}</small>
    </div>
  </div>
}

export function BookCard({ book, labelAudience = false }: {book: BookCardData; labelAudience?: boolean}) {
  return <article className="book-card">
    <Link to={`/books/${book.slug}`}>
      <BookCover book={book} />
      <h3>{book.title}</h3>
    </Link>
    <p>{book.author}</p>
    <span className="pill">{labelAudience ? book.audience : book.reading_level ?? book.topic}</span>
  </article>
}

export function Select({ label, name, children, defaultValue, onChange }: {
  label: string; name: string; children: ReactNode; defaultValue?: string; onChange?: (value: string) => void
}) {
  return <label className="field"><span>{label}</span><span className="select-wrap">
    <select name={name} defaultValue={defaultValue} onChange={onChange ? event => onChange(event.target.value) : undefined}>{children}</select>
    <ChevronDown size={15} aria-hidden="true" />
  </span></label>
}

export function EventActions({ event }: {event: Fellowship}) {
  if (event.status !== 'published' || !event.meet_url || eventEnd(event).getTime() <= Date.now()) return null
  function addToCalendar() {
    const url = URL.createObjectURL(new Blob([calendarText(event)], {type:'text/calendar;charset=utf-8'}))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'lifegreat-fellowship.ics'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }
  return <div className="actions">
    <a className="button button-primary" target="_blank" rel="noopener noreferrer" href={event.meet_url}><Video size={19} /> Join fellowship <ExternalLink size={15} aria-hidden="true" /></a>
    <button className="button button-outline" onClick={addToCalendar}><CalendarDays size={18} /> Add to calendar</button>
  </div>
}

export function EventDate({ event }: {event: Fellowship}) {
  return <span className="event-date"><CalendarDays size={19} aria-hidden="true" />
    <time dateTime={event.starts_at}>{formatEventDate(event.starts_at)}</time></span>
}

export function AccountPage() {
  const { user, admin, busy } = useAuth()
  return <section className="container content-panel narrow">
    <h1>Reader account</h1>
    {busy ? <Status>Checking your account…</Status> : user
      ? <><p>You’re signed in.</p>{admin && <Link className="button button-primary" to="/admin">Open admin dashboard</Link>}</>
      : <><p>Adult readers can sign in to write and edit book reviews.</p><SignIn /></>}
  </section>
}
