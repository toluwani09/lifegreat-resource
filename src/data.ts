import { createClient } from '@supabase/supabase-js'
import starter from './starter-catalogue.json'
import { filterBooks, upcomingFellowships, type Book, type BookFilters, type Fellowship } from './model'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const client = url && key ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: false } }) : null

export function backend() {
  if (!client) throw new Error('The library services haven’t been configured yet.')
  return client
}

export function unwrap<T>({ data, error }: { data: T; error: {message: string} | null }): T {
  if (error) throw new Error(error.message)
  return data
}

export type BookCardData = Pick<Book, 'id' | 'slug' | 'title' | 'author' | 'audience' | 'topic' | 'reading_level'>
export const cataloguePageSize = 16

export async function searchCatalogue(filters: BookFilters, page = 1, size = cataloguePageSize) {
  const offset = (page - 1) * size
  if (!client) {
    const matches = filterBooks(starter as Book[],filters)
    return {books:matches.slice(offset,offset+size) as BookCardData[],total:matches.length}
  }
  return unwrap(await client.rpc('search_catalogue', {
    phrase:filters.query ?? '', audience_filter:filters.audience ?? '', topic_filter:filters.topic ?? '',
    level_filter:filters.level ?? '', language_filter:filters.language ?? '', subject_filter:filters.subject ?? '',
    year_filter:filters.year ?? null, format_filter:filters.format ?? '', page_offset:offset,page_size:size,
  })) as {books:BookCardData[];total:number}
}

export async function getFeaturedBooks() {
  const pages = await Promise.all([searchCatalogue({audience:'Adults'},1,2),searchCatalogue({audience:'Children'},1,2)])
  return pages.flatMap(page => page.books)
}

export async function getBook(slug: string): Promise<Book | null> {
  if (!client) return (starter as Book[]).find(book => book.slug === slug) ?? null
  return unwrap(await client.from('books').select('*').eq('slug',slug).eq('status','published').maybeSingle()) as Book | null
}

export async function getFellowships() {
  if (!client) return []
  const earliest = new Date(Date.now() - 60 * 60_000).toISOString()
  const records = unwrap(await client.from('fellowships').select('*')
    .in('status',['published','cancelled']).gte('starts_at',earliest).order('starts_at')) as Fellowship[]
  return upcomingFellowships(records)
}

export function hostedDownload(book: Book) {
  return `${url}/functions/v1/book-download?book=${encodeURIComponent(book.slug)}`
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
