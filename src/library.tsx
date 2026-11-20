import { useCallback, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowDownToLine, BookOpen, CalendarDays, Flag, GraduationCap, Heart, LibraryBig, Star } from 'lucide-react'
import { backend, client, errorMessage, getBook, getBooks, getFellowships, hostedDownload, unwrap } from './data'
import { SignIn, useAuth } from './auth'
import { useLoad } from './hooks'
import { filterBooks, levels, reasons, topics, type Audience, type Book, type OwnReview, type Review } from './model'
import { BookCard, BookCover, EventActions, EventDate, SearchForm, Select, Status } from './ui'

function CuratedCollections() {
  return <section className="container collections" aria-labelledby="collections">
    <h2 id="collections">Curated collections</h2>
    <div className="collection-grid">
      <Link to="/adults?topic=Christian"><Heart /><span><strong>Growing in Faith</strong><small>Christian books for adults</small></span></Link>
      <Link to="/adults?topic=Education"><GraduationCap /><span><strong>Learning &amp; Skills</strong><small>Books for lifelong learning</small></span></Link>
      <Link to="/children?topic=Christian"><BookOpen /><span><strong>Stories of Faith</strong><small>Christian books for children</small></span></Link>
      <Link to="/children?topic=Education"><LibraryBig /><span><strong>Curious Readers</strong><small>Learning books for children</small></span></Link>
    </div>
  </section>
}

export function Home() {
  const { data: books, error, loading } = useLoad(getBooks)
  const schedule = useLoad(getFellowships, true)
  const next = schedule.data?.[0]
  const featured = [filterBooks(books ?? [], {audience:'Adults'}).slice(0,2),
    filterBooks(books ?? [], {audience:'Children'}).slice(0,2)].flat()
  return <>
    <section className="hero">
      <div className="container hero-inner">
        <div className="hero-copy">
          <h1>Books for faith<br />and learning</h1>
          <span className="gold-rule" />
          <p>A curated library of free Christian and educational e-books for adults and children.</p>
          <SearchForm />
          <div className="actions">
            <Link className="button button-green" to="/adults"><BookOpen size={19} /> Browse Adults</Link>
            <Link className="button button-primary" to="/children"><BookOpen size={19} /> Browse Children</Link>
          </div>
        </div>
        <img className="hero-photo" src="/images/reading.webp" alt="A mother and daughter sharing a book by a window" width="773" height="334" fetchPriority="high" />
      </div>
    </section>
    <CuratedCollections />
    <section className="fellowship-strip" aria-labelledby="next-fellowship">
      <div className="container fellowship-strip-inner">
        <div><CalendarDays /><h2 id="next-fellowship">Next Fellowship</h2></div>
        {schedule.loading ? <span>Checking the schedule…</span>
          : schedule.error ? <span>The schedule is temporarily unavailable.</span>
          : next ? <span>{next.status === 'cancelled' && <strong>Cancelled · </strong>}<strong>{next.theme}</strong><EventDate event={next} /></span>
          : <span>No upcoming fellowship has been published.</span>}
        <Link className="button button-primary" to="/fellowship">View Fellowship</Link>
      </div>
    </section>
    <section className="container featured" aria-labelledby="featured">
      <h2 id="featured">From the library</h2>
      {loading && <Status>Loading books…</Status>}
      {error && <Status error>We couldn’t load books. Refresh and try again.</Status>}
      {featured.length > 0 && <div className="book-grid featured-grid">{featured.map(book => <BookCard key={book.id} book={book} labelAudience />)}</div>}
      {!loading && !error && featured.length === 0 && <Status>No books have been published yet.</Status>}
    </section>
  </>
}

export function Library({ audience }: {audience?: Audience}) {
  const [params, setParams] = useSearchParams()
  const { data: all = [], error, loading } = useLoad(getBooks)
  const query = params.get('q') ?? ''
  const topic = params.get('topic') ?? ''
  const child = audience === 'Children'
  const level = child ? params.get('level') ?? '' : ''
  const language = child ? params.get('language') ?? '' : ''
  const matching = filterBooks(all, { audience, topic, query, level, language })
  const languages = Array.from(new Set(filterBooks(all,{audience:'Children'}).map(book => book.language))).sort()
  const limit = 16
  const [shown, setShown] = useState(limit)
  function change(key: string, value: string) {
    setShown(limit)
    const update = new URLSearchParams(params)
    if (value) update.set(key, value)
    else update.delete(key)
    setParams(update)
  }
  const action = audience ? `/${audience.toLowerCase()}` : '/books'
  return <section className="container library content-panel">
    <div className="library-heading">
      <h1>{child ? 'Children’s Library' : audience ? 'Adult Library' : 'Browse books'}</h1>
      <p>{child ? 'Christian and educational books for young readers.' : audience ? 'Explore Christian classics and books for lifelong learning.' : 'Find Christian and educational books by title or author.'}</p>
      <SearchForm query={query} action={action} />
    </div>
    <div className="library-layout">
      <aside className="filters" aria-label="Book filters">
        <h2>Filter books</h2>
        <Select key={`topic-${topic}`} name="topic" label="Topic" defaultValue={topic} onChange={value => change('topic',value)}>
          <option value="">All topics</option>{topics.map(option => <option key={option}>{option}</option>)}
        </Select>
        {child && <>
          <Select key={`level-${level}`} name="level" label="Reading level" defaultValue={level} onChange={value => change('level',value)}>
            <option value="">All reading levels</option>{levels.map(option => <option key={option}>{option}</option>)}
          </Select>
          <Select key={`language-${language}`} name="language" label="Language" defaultValue={language} onChange={value => change('language',value)}>
            <option value="">All languages</option>{languages.map(option => <option key={option}>{option}</option>)}
          </Select>
        </>}
        {(query || topic || level || language) && <Link to={action}>Clear filters</Link>}
      </aside>
      <div className="results">
        {loading ? <Status>Loading books…</Status> : error ? <Status error>We couldn’t load the catalogue. Refresh and try again.</Status> : <>
          <p className="result-count" role="status">{matching.length} {matching.length === 1 ? 'book' : 'books'}{query && <> matching “{query}”</>}</p>
          {matching.length ? <div className="book-grid">{matching.slice(0, shown).map(book => <BookCard key={book.id} book={book} labelAudience={!audience} />)}</div>
            : <Status>No matching books. Try a different search or clear the filters.</Status>}
          {matching.length > shown && <button className="button button-outline more" onClick={() => setShown(shown + limit)}>Show more books</button>}
        </>}
      </div>
    </div>
  </section>
}

function ReaderFeedback({ book }: {book: Book}) {
  const { user } = useAuth()
  const [notice, setNotice] = useState('')
  const [submission, setSubmission] = useState('')
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [reported, setReported] = useState(false)
  const [reportError, setReportError] = useState('')
  const [reportPending, setReportPending] = useState(false)
  const [reviewRefresh, setReviewRefresh] = useState(0)
  const userId = user?.id
  const loadReviews = useCallback(async () => {
    void reviewRefresh
    if (!client) return {reviews: [] as Review[], own: null as OwnReview | null}
    const [publicResult, ownResult] = await Promise.all([
      client.rpc('public_reviews',{target:book.id}),
      userId ? client.from('reviews').select('rating,body,status,updated_at').eq('user_id',userId).eq('book_id',book.id).maybeSingle() : null,
    ])
    return { reviews: unwrap(publicResult) as Review[], own: ownResult ? unwrap(ownResult) as OwnReview | null : null }
    // The save counter refreshes the public list and the signed-in reader’s review.
  }, [book.id,userId,reviewRefresh])
  const feedback = useLoad(loadReviews)
  const own = feedback.data?.own
  const destination = book.file_path ? hostedDownload(book) : book.download_url ?? book.source_url
  const direct = Boolean(book.file_path || book.download_url)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setFailure('')
    setSubmission('')
    const form = new FormData(event.currentTarget)
    try {
      unwrap(await backend().rpc('save_review',{
        target:book.id, stars:Number(form.get('stars')), comment:String(form.get('review') ?? ''), adult_confirmed:form.has('adult'),
      }))
      setSubmission('Your review was saved and is awaiting moderation.')
      setReviewRefresh(value => value + 1)
    } catch (error) { setFailure(errorMessage(error)) } finally { setPending(false) }
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setReportPending(true)
    setReportError('')
    try {
      unwrap(await backend().rpc('submit_report',{target:book.id,issue:String(form.get('reason')),message:String(form.get('details') ?? '')}))
      setReported(true)
      setReporting(false)
    } catch (error) { setReportError(errorMessage(error)) } finally { setReportPending(false) }
  }

  return <>
    <div className="actions detail-actions">
      {destination && <a className="button button-primary" href={destination} target="_blank" rel="noopener noreferrer"
        onClick={() => setNotice(direct ? 'Download started. If the file doesn’t open, try the source page or report an issue.' : 'Source opened in a new tab.')}>
        <ArrowDownToLine size={19} /> {direct ? `Download ${book.format}` : 'Get book from source'}
      </a>}
      <button className="button button-outline" aria-expanded={reporting} aria-controls="report-form" onClick={() => {setReported(false);setReporting(!reporting)}}>
        <Flag size={17} /> Report an issue
      </button>
    </div>
    {notice && <Status>{notice}</Status>}
    {reported && <Status>Report sent. Thank you for letting us know.</Status>}
    {reporting && <form id="report-form" onSubmit={event => void report(event)} className="form-card">
      <h2>Report an issue</h2>
      <Select name="reason" label="Issue">{reasons.map(reason => <option key={reason}>{reason}</option>)}</Select>
      <label className="field"><span>Details (optional)</span><textarea name="details" maxLength={1500} rows={3} /></label>
      {reportError && <Status error>{reportError}</Status>}
      <button className="button button-green" disabled={reportPending}>Send report</button>
    </form>}
    <section className="reviews" aria-labelledby="reviews-title">
      <h2 id="reviews-title">Reader reviews</h2>
      {user ? <form className="form-card" key={`${book.id}-${user.id}-${own?.updated_at ?? ''}`} onSubmit={event => void save(event)}>
        <h3>{own ? 'Edit your review' : 'Rate this book'}</h3>
        <fieldset className="stars"><legend>Rating</legend>{[1,2,3,4,5].map(star => <label key={star}>
          <input type="radio" name="stars" value={star} defaultChecked={own?.rating === star} required /> <Star size={16} aria-hidden="true" /> {star}
        </label>)}</fieldset>
        <label className="field"><span>Your review (optional)</span><textarea name="review" defaultValue={own?.body} maxLength={1500} rows={3} /></label>
        <label className="check"><input name="adult" type="checkbox" required /> I confirm I’m an adult.</label>
        <button className="button button-green" disabled={pending}>Save review</button>
      </form> : <div className="form-card"><p>Sign in as an adult reader to rate this book or leave a review.</p><SignIn /></div>}
      {submission && <Status>{submission}</Status>}{failure && <Status error>{failure}</Status>}
      {feedback.loading && <Status>Loading reviews…</Status>}
      {feedback.error && <Status error>Reviews are temporarily unavailable.</Status>}
      {!feedback.loading && !feedback.error && !feedback.data?.reviews.length && <p>No published reviews yet.</p>}
      {feedback.data?.reviews.map((review, index) => <article className="review" key={`${review.updated_at}-${index}`}>
        <strong>{review.rating} out of 5 stars</strong>{review.body && <p>{review.body}</p>}
      </article>)}
    </section>
  </>
}

export function BookPage() {
  const { slug = '' } = useParams()
  const loader = useCallback(() => getBook(slug), [slug])
  const { data: book, loading, error } = useLoad(loader)
  if (loading) return <div className="container content-panel"><Status>Loading book…</Status></div>
  if (error || !book || book.slug !== slug) return <div className="container content-panel"><Status error>{error ? 'We couldn’t load this book. Refresh and try again.' : 'This book is unavailable.'}</Status><Link to="/books">Browse the library</Link></div>
  return <article className="container content-panel detail">
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to={`/${book.audience.toLowerCase()}`}>{book.audience}</Link><span>/</span><span>Book details</span></nav>
    <div className="detail-layout">
      <BookCover book={book} />
      <div className="detail-main">
        <div className="tags"><span className="pill">{book.topic}</span><span className="pill">{book.audience}</span>{book.reading_level && <span className="pill">{book.reading_level}</span>}</div>
        <h1>{book.title}</h1><p className="byline">By {book.author}</p>
        <h2>Overview</h2><p>{book.description}</p>
        <dl className="metadata">
          <dt>Source</dt><dd>{book.source_url && <a href={book.source_url} target="_blank" rel="noopener noreferrer">{book.source_name}</a>}</dd>
          <dt>Edition</dt><dd>{book.edition}</dd>
          <dt>Format</dt><dd>{book.format ?? 'See source'}{book.file_size ? ` · ${(book.file_size / 1024 / 1024).toFixed(2)} MB` : ''}</dd>
          <dt>Language</dt><dd>{book.language}</dd>
        </dl>
        <ReaderFeedback key={book.id} book={book} />
      </div>
    </div>
  </article>
}

export function FellowshipPage() {
  const { data, error, loading } = useLoad(getFellowships,true)
  return <section className="container content-panel fellowship">
    <div className="fellowship-heading">
      <div><h1>Monthly Fellowship</h1><span className="gold-rule" /><p>Join us online for prayer, conversation, and encouragement.</p></div>
      <img src="/images/fellowship.webp" alt="Readers gathered for a fellowship discussion" width="505" height="298" />
    </div>
    {loading && <Status>Checking the fellowship schedule…</Status>}
    {error && <Status error>We couldn’t load the fellowship schedule. Refresh and try again.</Status>}
    {!loading && !error && !data?.length && <Status>No upcoming fellowship has been published. Check back for the next date.</Status>}
    {data?.map(event => <article className="event-card" key={event.id}>
      {event.status === 'cancelled' && <span className="pill cancelled">Cancelled</span>}
      <h2>{event.theme}</h2><EventDate event={event} />
      <p>{event.duration_minutes} minutes · Hosted by {event.host}</p>
      {event.description && <p>{event.description}</p>}
      <EventActions event={event} />
    </article>)}
  </section>
}
