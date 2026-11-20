import { describe, expect, it } from 'vitest'
import starter from '../src/starter-catalogue.json'
import { calendarText, ebookKind, eventInputs, filterBooks, formatEventDate, httpsUrl, lagosToIso, upcomingFellowships, type Book, type Fellowship } from '../src/model'

const books = starter as Book[]
const event: Fellowship = {
  id:'example',theme:'Faith, work & life',description:'Prayer; discussion\nQuestions',host:'Host',
  starts_at:'2027-01-09T15:00:00.000Z',duration_minutes:45,meet_url:'https://meet.google.com/abc-defg-hij',status:'published',
}

describe('catalogue', () => {
  it('contains 40 unique eligible editions across audience and topic', () => {
    expect(new Set(books.map(book => book.slug)).size).toBe(40)
    for (const audience of ['Adults','Children'] as const) {
      for (const topic of ['Christian','Education'] as const) expect(filterBooks(books,{audience,topic})).toHaveLength(10)
    }
    expect(books.every(book => book.edition && book.rights && book.source_url && book.format === 'EPUB' && !book.file_path)).toBe(true)
  })
  it('scopes search to audience, publisher status, and filters', () => {
    expect(filterBooks(books,{audience:'Children',query:'Bunyan'})).toEqual([])
    expect(filterBooks(books,{query:'Bunyan'})).toHaveLength(4)
    expect(filterBooks(books,{audience:'Children',query:'burgess',language:'English',level:'Developing reader'})).toHaveLength(2)
    expect(filterBooks([{...books[0],status:'unpublished'}],{})).toEqual([])
  })
})

describe('fellowship scheduling', () => {
  it('round trips midnight and afternoon in WAT', () => {
    expect(lagosToIso('2027-01-09','16:00')).toBe(event.starts_at)
    expect(eventInputs(lagosToIso('2027-01-09','00:00'))).toEqual({date:'2027-01-09',time:'00:00'})
    expect(formatEventDate(event.starts_at)).toMatch(/4:00\s*pm WAT/i)
    expect(() => lagosToIso('2027-02-30','16:00')).toThrow()
  })
  it('shows upcoming cancellations without returning drafts or expired meetings', () => {
    const visible = upcomingFellowships([
      {...event,id:'draft',status:'draft'}, {...event,id:'cancelled',status:'cancelled',meet_url:null},
      {...event,id:'past',starts_at:'2027-01-01T09:00:00Z'}, event,
    ], Date.parse('2027-01-09T15:39:00Z'))
    expect(visible.map(item => item.id)).toEqual(['cancelled','example'])
    expect(upcomingFellowships([event],Date.parse('2027-01-09T15:45:00Z'))).toEqual([])
  })
  it('exports an escaped calendar invitation in UTC', () => {
    const value = calendarText(event,new Date('2027-01-01T00:00:00Z'))
    expect(value).toContain('DTSTART:20270109T150000Z\r\nDTEND:20270109T154500Z')
    expect(value).toContain('SUMMARY:Faith\\, work & life')
    expect(value).toContain('DESCRIPTION:Prayer\\; discussion\\nQuestions')
  })
})

it('restricts uploads and validates external HTTPS links', () => {
  expect(ebookKind(new File(['sample'],'book.epub')).mime).toBe('application/epub+zip')
  expect(() => ebookKind(new File(['test'],'book.exe'))).toThrow(/PDF or EPUB/)
  expect(() => httpsUrl('javascript:alert(1)')).toThrow()
  expect(() => httpsUrl('https://user:secret@example.com')).toThrow()
})

describe('private download gateway', () => {
  it('rechecks publication and streams a published PDF without redirecting to storage', async () => {
    const { downloadBook } = await import('../supabase/functions/book-download/handler')
    const { vi } = await import('vitest')
    const fake = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([{file_path:'20000000-0000-4000-8000-000000000001.pdf',format:'PDF'}]))
      .mockResolvedValueOnce(new Response('%PDF- file'))
      .mockResolvedValueOnce(Response.json([]))
    const request = new Request('https://app.example/book-download?book=book-slug')
    const file = await downloadBook(request,'https://api.example','secret',fake)
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('%PDF- file')
    expect(file.headers.get('Cache-Control')).toBe('no-store')
    expect(file.headers.get('Content-Disposition')).toBe('attachment; filename="book-slug.pdf"')
    expect(file.headers.has('Location')).toBe(false)
    expect(String(fake.mock.calls[0][0])).toContain('status=eq.published')
    expect((await downloadBook(request,'https://api.example','secret',fake)).status).toBe(404)
    expect(fake).toHaveBeenCalledTimes(3)
  })
})
