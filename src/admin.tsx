import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { BookOpen, CalendarDays, Flag, Plus, X } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { SignIn, useAuth } from './auth'
import { backend, errorMessage, unwrap } from './data'
import { useLoad } from './hooks'
import { audiences, ebookKind, eventInputs, formatEventDate, httpsUrl, lagosToIso, levels, topics, type Book, type Fellowship, type OwnReview } from './model'
import { BookCover, EventDate, Select, Status } from './ui'

export function AdminLayout() {
  const { user, admin, busy, error } = useAuth()
  if (busy) return <div className="container content-panel"><Status>Checking admin access…</Status></div>
  if (!admin) return <div className="container content-panel narrow">
    <h1>Admin dashboard</h1>
    {user ? <Status error>{error ? 'Admin access is temporarily unavailable.' : 'Administrator access is required.'}</Status>
      : <><p>Sign in with your administrator account.</p><SignIn /></>}
    <p><Link to="/">Back to the library</Link></p>
  </div>
  return <div className="admin-layout">
    <nav className="admin-nav" aria-label="Admin navigation">
      <NavLink to="/admin" end><BookOpen size={20} /> Book catalogue</NavLink>
      <NavLink to="/admin/moderation"><Flag size={20} /> Reviews &amp; reports</NavLink>
      <NavLink to="/admin/fellowship"><CalendarDays size={20} /> Fellowship</NavLink>
      <Link to="/">View library</Link>
    </nav>
    <section className="admin-content"><Outlet /></section>
  </div>
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function Editor({ title, close, children }: {title: string; close: () => void; children: ReactNode}) {
  useEffect(() => { document.getElementById('editor-heading')?.focus() }, [])
  return <aside className="editor" aria-labelledby="editor-heading">
    <div className="section-header"><h2 id="editor-heading" tabIndex={-1}>{title}</h2><button className="icon-button" aria-label="Close editor" onClick={close}><X /></button></div>
    {children}
  </aside>
}

interface BookChanges {
  title: string; author: string; audience: string; topic: string; language: string; reading_level: string | null;
  description: string; source_name: string; source_url: string | null; edition: string; rights: string;
  download_url: string | null; format: string | null; file_path: string | null; file_size: number | null;
}

async function validateFile(file: File) {
  const kind = ebookKind(file)
  const bytes = new Uint8Array(await file.slice(0, 128).arrayBuffer())
  const header = new TextDecoder().decode(bytes)
  const pdf = kind.format === 'PDF' && header.startsWith('%PDF-')
  const epub = kind.format === 'EPUB' && bytes[0] === 80 && bytes[1] === 75 && bytes[2] === 3 && bytes[3] === 4 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[26] === 8 && bytes[27] === 0 && bytes[28] === 0 && bytes[29] === 0 &&
    header.slice(30,58) === 'mimetypeapplication/epub+zip'
  if (!pdf && !epub) throw new Error('This file’s contents do not match its PDF or EPUB extension.')
  return kind
}

function BookEditor({ book, close, saved }: {book: Book | null; close: () => void; saved: (text: string) => void}) {
  const [audience, setAudience] = useState(book?.audience ?? 'Adults')
  const [uploadMode, setUploadMode] = useState(Boolean(book?.file_path))
  const [preview, setPreview] = useState<Book | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'draft'
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    const file = form.get('file')
    const hasUpload = uploadMode && file instanceof File && file.size > 0
    setBusy(true)
    setError('')
    let uploaded: string | null = null
    let committed = false
    try {
      const kind = hasUpload ? await validateFile(file) : null
      const changes: BookChanges = {
        title:value('title'),author:value('author'),audience,topic:value('topic'),language:value('language'),
        reading_level:audience === 'Children' ? value('reading_level') : null, description:value('description'),
        source_name:value('source_name'),source_url:value('source_url') ? httpsUrl(value('source_url')) : null,
        edition:value('edition'),rights:value('rights'),
        download_url:!uploadMode && value('download_url') ? httpsUrl(value('download_url')) : null,
        format:kind?.format ?? (uploadMode ? book?.format ?? null : value('format') || null),
        file_path:uploadMode ? book?.file_path ?? null : null,
        file_size:uploadMode ? book?.file_size ?? null : null,
      }
      const status = action === 'publish' ? 'published' : book?.status ?? 'draft'
      const id = book?.id ?? crypto.randomUUID()
      const short = changes.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,85).replace(/-$/,'')
      const payload = { ...changes, id, status, slug:book?.slug ?? `${short || 'book'}-${id.slice(0,8)}` }
      if (!changes.title || !changes.author || !changes.language) throw new Error('Enter a title, author, and language.')
      if (action === 'preview') { setPreview(payload as Book); return }
      if (status === 'published' && (!changes.source_url || !changes.source_name || !changes.edition || !changes.rights || !changes.description)) {
        throw new Error('Publication requires a description, source name and URL, exact edition, and rights information.')
      }
      if (payload.download_url && !payload.format) throw new Error('Select a format for the direct download.')
      if (uploadMode && !hasUpload && !payload.file_path) throw new Error('Choose a file or switch to Official source link.')
      const sb = backend()
      if (kind && hasUpload) {
        const path = `${crypto.randomUUID()}.${kind.format.toLowerCase()}`
        unwrap(await sb.storage.from('book-files').upload(path,file,{contentType:kind.mime,cacheControl:'0'}))
        uploaded = path
        payload.file_path = path
        payload.file_size = file.size
      }
      if (book) unwrap(await sb.from('books').update(payload).eq('id',id).select('id').single())
      else unwrap(await sb.from('books').insert(payload))
      committed = true
      const obsolete = book?.file_path && book.file_path !== payload.file_path ? book.file_path : null
      if (obsolete) {
        const cleanup = await sb.storage.from('book-files').remove([obsolete])
        if (cleanup.error) {
          saved('Book saved. The previous private upload still needs storage cleanup.')
          return
        }
      }
      saved(action === 'publish' ? 'Book published.' : status === 'draft' ? 'Draft saved.' : 'Book updated.')
    } catch (error) {
      if (uploaded && !committed) await backend().storage.from('book-files').remove([uploaded])
      setError(errorMessage(error))
    } finally { setBusy(false) }
  }

  return <Editor title={book ? 'Edit book' : 'Add a book'} close={close}>
    <form className="editor-form" onSubmit={event => void submit(event)}>
      <div className="form-grid">
        <Field label="Title"><input name="title" defaultValue={book?.title} maxLength={250} required /></Field>
        <Field label="Author"><input name="author" defaultValue={book?.author} maxLength={200} required /></Field>
        <Select label="Audience" name="audience" defaultValue={audience} onChange={value => setAudience(value as Book['audience'])}>
          {audiences.map(option => <option key={option}>{option}</option>)}</Select>
        <Select label="Topic" name="topic" defaultValue={book?.topic}>{topics.map(option => <option key={option}>{option}</option>)}</Select>
        <Field label="Language"><input name="language" defaultValue={book?.language ?? 'English'} maxLength={80} required /></Field>
        {audience === 'Children' && <Select label="Reading level" name="reading_level" defaultValue={book?.reading_level ?? undefined}>
          {levels.map(option => <option key={option}>{option}</option>)}</Select>}
      </div>
      <Field label="Description"><textarea name="description" rows={3} maxLength={3000} defaultValue={book?.description} /></Field>
      <Field label="Source name"><input name="source_name" maxLength={150} defaultValue={book?.source_name} /></Field>
      <Field label="Official source URL"><input name="source_url" type="url" defaultValue={book?.source_url ?? ''} placeholder="https://" /></Field>
      <Field label="Exact edition"><input name="edition" maxLength={500} defaultValue={book?.edition} /></Field>
      <Field label="Rights or license"><textarea name="rights" rows={3} maxLength={2000} defaultValue={book?.rights} /></Field>
      <Select label="How readers get this book" name="mode" defaultValue={uploadMode ? 'upload' : 'source'} onChange={mode => setUploadMode(mode === 'upload')}>
        <option value="source">Official source link</option><option value="upload">Upload PDF / EPUB</option>
      </Select>
      {uploadMode ? <><Field label={book?.file_path ? 'Replace private file (optional)' : 'Approved PDF or EPUB (up to 20 MB)'}>
        <input type="file" name="file" accept=".pdf,.epub,application/pdf,application/epub+zip" /></Field>
        {book?.file_path && <p className="muted">Current file: {book.format}</p>}
      </> : <>
        <Field label="Official direct download URL (optional)"><input name="download_url" type="url" defaultValue={book?.download_url ?? ''} placeholder="https://" /></Field>
        <Select label="Download format" name="format" defaultValue={book?.format ?? ''}><option value="">See source</option><option>PDF</option><option>EPUB</option></Select>
      </>}
      {error && <Status error>{error}</Status>}
      <div className="actions">
        <button className="button button-outline" disabled={busy} value="preview">Preview</button>
        <button className="button button-outline" disabled={busy} value="draft">{book && book.status !== 'draft' ? 'Save changes' : 'Save draft'}</button>
        {book?.status !== 'published' && <button className="button button-primary" disabled={busy} value="publish">{book?.status === 'unpublished' ? 'Restore and publish' : 'Publish'}</button>}
      </div>
    </form>
    {preview && <div className="form-card preview-card"><span className="pill">Preview</span><BookCover book={preview} /><h3>{preview.title}</h3><p>By {preview.author}</p><p>{preview.description || 'No description yet.'}</p><p>{preview.audience} · {preview.topic} · {preview.format ?? 'See source'}</p></div>}
  </Editor>
}

export function AdminBooks() {
  const [version, reload] = useState(0)
  const [editing, setEditing] = useState<Book | null | undefined>()
  const [unpublishing, setUnpublishing] = useState<Book>()
  const [query, setQuery] = useState('')
  const [audience, setAudience] = useState('')
  const [status, setStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loader = useCallback(async () => {
    void version
    return unwrap(await backend().from('books').select('*').order('title')) as Book[]
  }, [version])
  const books = useLoad(loader)
  const rows = (books.data ?? []).filter(book => (!status || book.status === status) && (!audience || book.audience === audience)
    && `${book.title} ${book.author}`.toLowerCase().includes(query.trim().toLowerCase()))
  function saved(message: string) { setEditing(undefined); setUnpublishing(undefined); setNotice(message); reload(value => value + 1) }
  async function unpublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!unpublishing) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
    setBusy(true)
    setError('')
    try {
      unwrap(await backend().rpc('unpublish_book',{target:unpublishing.id,reason}))
      saved('Book unpublished.')
    } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }
  return <>
    <div className="section-header"><h1>Book catalogue</h1><button className="button button-primary" onClick={() => {setUnpublishing(undefined);setEditing(null)}}><Plus size={19} /> Add a book</button></div>
    {notice && <Status>{notice}</Status>}
    <div className="admin-columns">
      <div>
        <div className="admin-filters">
          <Field label="Search books"><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field>
          <Select label="Audience" name="audience" onChange={setAudience}><option value="">All audiences</option>{audiences.map(item => <option key={item}>{item}</option>)}</Select>
          <Select label="Status" name="status" onChange={setStatus}><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="unpublished">Unpublished</option></Select>
        </div>
        {books.loading && <Status>Loading books…</Status>}{books.error && <Status error>{books.error}</Status>}
        {!books.loading && !books.error && !rows.length && <Status>No books match these filters.</Status>}
        {rows.length > 0 && <div className="table-wrap"><table><thead><tr><th>Book</th><th>Audience</th><th>Topic</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{rows.map(book => <tr key={book.id}><td><strong>{book.title}</strong><br /><small>{book.author}</small></td><td>{book.audience}</td><td>{book.topic}</td><td><span className={`pill status-${book.status}`}>{book.status}</span></td><td>
            <button className="text-button" onClick={() => {setUnpublishing(undefined);setEditing(book)}}>Edit<span className="sr-only"> {book.title}</span></button>
            {book.status === 'published' && <button className="text-button danger" onClick={() => {setEditing(undefined);setError('');setUnpublishing(book)}}>Unpublish<span className="sr-only"> {book.title}</span></button>}
          </td></tr>)}</tbody></table></div>}
      </div>
      {editing !== undefined && <BookEditor key={editing?.id ?? 'new'} book={editing} close={() => setEditing(undefined)} saved={saved} />}
      {unpublishing && <Editor title="Unpublish book" close={() => setUnpublishing(undefined)}>
        <p>{unpublishing.title}</p><form className="editor-form" onSubmit={event => void unpublish(event)}>
          <Field label="Reason"><textarea name="reason" required maxLength={500} rows={3} /></Field>
          {error && <Status error>{error}</Status>}<button className="button button-danger" disabled={busy}>Confirm unpublish</button>
        </form>
      </Editor>}
    </div>
  </>
}

function FellowshipEditor({ event, close, saved }: {event: Fellowship | null; close: () => void; saved: (text: string) => void}) {
  const [preview, setPreview] = useState<Fellowship | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fields = event ? eventInputs(event.starts_at) : {date:'', time:''}

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    const action = ((formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'save'
    const form = new FormData(formEvent.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    setBusy(true)
    setError('')
    try {
      const startsAt = lagosToIso(value('date'),value('time'))
      const meet = value('meet')
      if (meet && !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(meet)) {
        throw new Error('Enter a Google Meet meeting link in the form https://meet.google.com/abc-defg-hij.')
      }
      const status = action === 'publish' || action === 'reschedule' ? 'published' : event?.status ?? 'draft'
      const payload: Fellowship = {
        id:event?.id ?? crypto.randomUUID(),theme:value('theme'),description:value('description'),host:value('host'),
        starts_at:startsAt,duration_minutes:Number(value('duration')),meet_url:meet || null,status,
      }
      if (!payload.theme || !payload.host) throw new Error('Enter a theme and host.')
      if (action === 'preview') { setPreview(payload); return }
      if (status === 'published' && !payload.meet_url) throw new Error('Add a Google Meet link before publishing.')
      if ((action === 'publish' || action === 'reschedule') && Date.parse(startsAt) <= Date.now()) throw new Error('Choose a future fellowship date and time.')
      if (payload.status === 'cancelled') payload.meet_url = null
      const sb = backend()
      if (event) unwrap(await sb.from('fellowships').update(payload).eq('id',event.id).eq('status',event.status).select('id').single())
      else unwrap(await sb.from('fellowships').insert(payload))
      saved(action === 'reschedule' ? 'Fellowship updated. The homepage and Fellowship page use the new schedule.' :
        action === 'publish' ? 'Fellowship published.' : 'Fellowship saved.')
    } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }

  return <Editor title={event ? 'Edit fellowship' : 'Schedule fellowship'} close={close}>
    <form className="editor-form" onSubmit={formEvent => void submit(formEvent)}>
      <Field label="Theme"><input name="theme" defaultValue={event?.theme} required maxLength={150} /></Field>
      <Field label="Description"><textarea name="description" rows={3} maxLength={2500} defaultValue={event?.description} /></Field>
      <Field label="Host"><input name="host" required maxLength={120} defaultValue={event?.host} /></Field>
      <div className="form-grid">
        <Field label="Date (WAT)"><input name="date" type="date" defaultValue={fields.date} required /></Field>
        <Field label="Start time (WAT)"><input name="time" type="time" defaultValue={fields.time} required /></Field>
      </div>
      <Field label="Duration in minutes"><input name="duration" type="number" min={1} max={60} defaultValue={event?.duration_minutes ?? 45} required /></Field>
      <Field label="Google Meet link"><input name="meet" type="url" defaultValue={event?.meet_url ?? ''} placeholder="https://meet.google.com/abc-defg-hij" /></Field>
      {error && <Status error>{error}</Status>}
      <div className="actions">
        <button className="button button-outline" disabled={busy} value="preview">Preview</button>
        {event?.status === 'published'
          ? <button className="button button-primary" disabled={busy} value="reschedule">Save / reschedule</button>
          : <><button className="button button-outline" disabled={busy} value="save">{!event || event.status === 'draft' ? 'Save draft' : 'Save changes'}</button>
            <button className="button button-primary" disabled={busy} value="publish">Publish</button></>}
      </div>
    </form>
    {preview && <div className="form-card preview-card"><span className="pill">Preview</span><h3>{preview.theme}</h3><EventDate event={preview} /><p>{preview.duration_minutes} minutes · Hosted by {preview.host}</p><p>{preview.description}</p></div>}
  </Editor>
}

export function AdminFellowship() {
  const [version, reload] = useState(0)
  const [editing, setEditing] = useState<Fellowship | null | undefined>()
  const [confirming, setConfirming] = useState<{event: Fellowship; action:'cancelled' | 'unpublished'}>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const loader = useCallback(async () => {
    void version
    return unwrap(await backend().from('fellowships').select('*').order('starts_at',{ascending:false})) as Fellowship[]
  }, [version])
  const schedule = useLoad(loader)
  function saved(message: string) {setEditing(undefined);setConfirming(undefined);setNotice(message);reload(value => value + 1)}
  async function changeStatus() {
    if (!confirming) return
    const {event, action} = confirming
    setBusy(true)
    setError('')
    try {
      unwrap(await backend().from('fellowships').update({status:action,...(action === 'cancelled' ? {meet_url:null} : {})})
        .eq('id',event.id).eq('status',event.status).select('id').single())
      saved(action === 'cancelled' ? 'Fellowship cancelled.' : 'Fellowship unpublished.')
    } catch (error) { setError(errorMessage(error)) } finally {setBusy(false)}
  }
  return <>
    <div className="section-header"><h1>Fellowship schedule</h1><button className="button button-primary" onClick={() => {setConfirming(undefined);setEditing(null)}}><Plus size={19} /> Schedule fellowship</button></div>
    <p>Published events appear on the homepage and Fellowship page in WAT.</p>
    {notice && <Status>{notice}</Status>}{error && <Status error>{error}</Status>}
    <div className="admin-columns"><div>
      {schedule.loading && <Status>Loading fellowship schedule…</Status>}{schedule.error && <Status error>{schedule.error}</Status>}
      {!schedule.loading && !schedule.error && !schedule.data?.length && <Status>No fellowship events have been scheduled.</Status>}
      {schedule.data?.map(event => <article className="admin-event" key={event.id}>
        <div><span className={`pill status-${event.status}`}>{event.status}</span><h2>{event.theme}</h2><p>{formatEventDate(event.starts_at)}</p></div>
        <div className="actions">
          <button className="button button-outline" onClick={() => {setConfirming(undefined);setEditing(event)}}>{event.status === 'published' ? 'Edit / reschedule' : 'Edit'}</button>
          {event.status === 'published' && <button className="text-button danger" onClick={() => {setEditing(undefined);setConfirming({event,action:'cancelled'})}}>Cancel event</button>}
          {['published','cancelled'].includes(event.status) && <button className="text-button" onClick={() => {setEditing(undefined);setConfirming({event,action:'unpublished'})}}>Unpublish</button>}
        </div>
      </article>)}
    </div>
    {editing !== undefined && <FellowshipEditor key={editing?.id ?? 'new'} event={editing} close={() => setEditing(undefined)} saved={saved} />}
    {confirming && <Editor title={confirming.action === 'cancelled' ? 'Cancel fellowship' : 'Unpublish fellowship'} close={() => setConfirming(undefined)}>
      <p>{confirming.event.theme}</p>
      <p>{confirming.action === 'cancelled' ? 'Viewers will see that this event was cancelled. The join link will be removed.' : 'The event will be removed from the public schedule.'}</p>
      <button className="button button-danger" disabled={busy} onClick={() => void changeStatus()}>{confirming.action === 'cancelled' ? 'Confirm cancellation' : 'Confirm unpublish'}</button>
    </Editor>}
    </div>
  </>
}

type QueueReview = OwnReview & {book_id:string;user_id:string;books:{title:string} | null}
type QueueReport = {id:string;book_id:string;reason:string;details:string;resolved:boolean;books:{title:string} | null}

export function AdminModeration() {
  const [version, reload] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loader = useCallback(async () => {
    void version
    const sb = backend()
    const [reviews, reports] = await Promise.all([
      sb.from('reviews').select('*,books(title)').order('updated_at',{ascending:false}).limit(100),
      sb.from('reports').select('*,books(title)').eq('resolved',false).order('created_at',{ascending:false}).limit(100),
    ])
    return {reviews:unwrap(reviews) as unknown as QueueReview[],reports:unwrap(reports) as unknown as QueueReport[]}
  }, [version])
  const queue = useLoad(loader)
  async function moderate(action: 'moderate_review' | 'resolve_report', args: Record<string,string>) {
    setBusy(true); setError(''); setNotice('')
    try {
      unwrap(await backend().rpc(action,args))
      setNotice(action === 'resolve_report' ? 'Report resolved.' : 'Review updated.')
      reload(value => value + 1)
    } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) }
  }
  return <>
    <h1>Reviews &amp; reports</h1>
    {notice && <Status>{notice}</Status>}{error && <Status error>{error}</Status>}
    {queue.loading && <Status>Loading moderation queue…</Status>}{queue.error && <Status error>{queue.error}</Status>}
    {queue.data && <div className="moderation-grid">
      <section><h2>Book reviews</h2>
        {!queue.data.reviews.length && <Status>No reviews to moderate.</Status>}
        {queue.data.reviews.map(review => <article className="form-card" key={`${review.book_id}/${review.user_id}`}>
          <h3>{review.books?.title ?? 'Book review'}</h3><p>{review.rating} / 5 · {review.status}{review.rating <= 2 && ' · Low rating'}</p>
          {review.body && <p>{review.body}</p>}<div className="actions">
            {review.status !== 'approved' && <button disabled={busy} className="button button-green" onClick={() => void moderate('moderate_review',{target:review.book_id,reviewer:review.user_id,decision:'approved'})}>Approve</button>}
            {review.status !== 'hidden' && <button disabled={busy} className="button button-outline" onClick={() => void moderate('moderate_review',{target:review.book_id,reviewer:review.user_id,decision:'hidden'})}>Hide</button>}
          </div>
        </article>)}
      </section>
      <section><h2>Issue reports</h2>
        {!queue.data.reports.length && <Status>No open issue reports.</Status>}
        {queue.data.reports.map(report => <article className="form-card" key={report.id}>
          <h3>{report.books?.title ?? 'Book report'}</h3><p>{report.reason}</p>{report.details && <p>{report.details}</p>}
          <button disabled={busy} className="button button-outline" onClick={() => void moderate('resolve_report',{target:report.id})}>Mark resolved</button>
        </article>)}
      </section>
    </div>}
  </>
}
