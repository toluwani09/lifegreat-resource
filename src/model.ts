export const audiences = ['Adults', 'Children'] as const
export const topics = ['Christian', 'Education'] as const
export const levels = ['Read together', 'Developing reader', 'Independent reader'] as const
export const reasons = ['Broken link', 'File quality', 'Audience suitability', 'Copyright'] as const
export type Audience = typeof audiences[number]
export type Topic = typeof topics[number]
export type Level = typeof levels[number]
export type BookStatus = 'draft' | 'published' | 'unpublished'
export type EventStatus = 'draft' | 'published' | 'cancelled' | 'unpublished'

export interface Book {
  publication_year?: number | null
  subject?: string | null
  publisher?: string | null
  scholarly_level?: string | null
  attribution?: string | null
  rights_url?: string | null
  id: string
  slug: string
  title: string
  author: string
  description: string
  audience: Audience
  topic: Topic
  language: string
  reading_level: Level | null
  source_name: string
  source_url: string | null
  edition: string
  rights: string
  download_url: string | null
  file_path: string | null
  format: 'PDF' | 'EPUB' | null
  file_size: number | null
  status: BookStatus
}

export interface Fellowship {
  id: string
  theme: string
  description: string
  host: string
  starts_at: string
  duration_minutes: number
  meet_url: string | null
  status: EventStatus
}
export interface Review { rating: number; body: string; updated_at: string }
export interface OwnReview extends Review { status: 'pending' | 'approved' | 'hidden' }

export interface BookFilters {
  audience?: Audience; query?: string; topic?: string; level?: string; language?: string
  year?: number; subject?: string; format?: string
}

export function filterBooks(books: Book[], filters: BookFilters) {
  const tokens = filters.query?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? []
  return books.filter(book =>
    book.status === 'published' &&
    (!filters.audience || book.audience === filters.audience) &&
    (!filters.topic || book.topic === filters.topic) &&
    (!filters.level || book.reading_level === filters.level || book.scholarly_level === filters.level) &&
    (!filters.language || book.language.toLowerCase() === filters.language.toLowerCase()) &&
    (!filters.year || book.publication_year === filters.year) &&
    (!filters.subject || book.subject?.toLowerCase().includes(filters.subject.toLowerCase())) &&
    (!filters.format || book.format === filters.format) &&
    tokens.every(token => `${book.title} ${book.author}`.toLocaleLowerCase().includes(token)),
  )
}

const lagos = 'Africa/Lagos'
const lagosFields = new Intl.DateTimeFormat('sv-SE', {
  timeZone: lagos, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

export function eventInputs(value: string) {
  const parts = Object.fromEntries(lagosFields.formatToParts(new Date(value)).map(part => [part.type, part.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function lagosToIso(date: string, time: string) {
  const parsed = new Date(`${date}T${time}:00+01:00`)
  if (!Number.isFinite(parsed.getTime())) throw new Error('Enter a valid fellowship date and time.')
  const fields = eventInputs(parsed.toISOString())
  if (fields.date !== date || fields.time !== time) throw new Error('Enter a valid fellowship date and time.')
  return parsed.toISOString()
}

export function formatEventDate(value: string) {
  const date = new Date(value)
  const day = new Intl.DateTimeFormat('en-NG', { timeZone: lagos, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  const time = new Intl.DateTimeFormat('en-NG', { timeZone: lagos, hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
  return `${day} · ${time} WAT`
}

export function eventEnd(event: Fellowship) {
  return new Date(new Date(event.starts_at).getTime() + event.duration_minutes * 60_000)
}

export function upcomingFellowships(events: Fellowship[], now = Date.now()) {
  return events.filter(event => ['published','cancelled'].includes(event.status) && eventEnd(event).getTime() > now)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
}

export function calendarText(event: Fellowship, now = new Date()) {
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeGreat Resource//Fellowship//EN',
    'BEGIN:VEVENT', `UID:${event.id}@lifegreat-resource`, `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(new Date(event.starts_at))}`, `DTEND:${stamp(eventEnd(event))}`,
    `SUMMARY:${escape(event.theme)}`, `DESCRIPTION:${escape(event.description)}`,
    `LOCATION:${escape(event.meet_url ?? '')}`, 'END:VEVENT', 'END:VCALENDAR',
  ]
  const encoder = new TextEncoder()
  return lines.map(line => {
    let result = '', length = 0
    for (const char of line) {
      const size = encoder.encode(char).length
      if (length + size > 75) { result += '\r\n '; length = 1 }
      result += char
      length += size
    }
    return result
  }).join('\r\n') + '\r\n'
}

export function httpsUrl(value: string) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Enter a valid HTTPS link.')
  return parsed.href
}

export function ebookKind(file: File) {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error('Choose a file up to 20 MB.')
  if (/\.pdf$/i.test(file.name)) return { format: 'PDF', mime: 'application/pdf' } as const
  if (/\.epub$/i.test(file.name)) return { format: 'EPUB', mime: 'application/epub+zip' } as const
  throw new Error('Choose a PDF or EPUB file.')
}
