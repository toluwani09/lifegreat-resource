import { createClient } from '@supabase/supabase-js'
import starter from './starter-catalogue.json'
import { upcomingFellowships, type Book, type Fellowship } from './model'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const client = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null

export function backend() {
  if (!client) throw new Error('The library services haven’t been configured yet.')
  return client
}

export function unwrap<T>({ data, error }: { data: T; error: {message: string} | null }): T {
  if (error) throw new Error(error.message)
  return data
}

export async function getBooks(): Promise<Book[]> {
  if (!client) return starter as Book[]
  const books: Book[] = []
  const size = 100
  for (let offset = 0; ; offset += size) {
    const page = unwrap(await client.from('books').select('*').eq('status','published')
      .order('title').order('id').range(offset, offset + size - 1)) as Book[]
    books.push(...page)
    if (page.length < size) return books
  }
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
