function response(status: number) {
  return new Response(status === 404 ? 'This book is unavailable.' : 'Download unavailable. Try again shortly.', {
    status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function downloadBook(request: Request, base?: string, key?: string, requestUpstream = fetch) {
  if (request.method !== 'GET') return response(405)
  const slug = new URL(request.url).searchParams.get('book')
  if (!slug || slug.length > 150 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return response(404)

  try {
    if (!base || !key) return response(503)
    const headers = { apikey: key, Authorization: `Bearer ${key}` }
    const search = new URLSearchParams({ select: 'file_path,format', slug: `eq.${slug}`, status: 'eq.published', limit: '1' })
    const records = await requestUpstream(`${base}/rest/v1/books?${search}`, { headers, cache: 'no-store' })
    if (!records.ok) return response(503)
    const [book] = await records.json()
    if (!book?.file_path || !/^[0-9a-f-]{36}\.(pdf|epub)$/.test(book.file_path)) return response(404)
    const file = await requestUpstream(`${base}/storage/v1/object/authenticated/book-files/${book.file_path}`, { headers })
    if (!file.ok) return response(file.status === 404 ? 404 : 503)
    return new Response(file.body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': book.format === 'PDF' ? 'application/pdf' : 'application/epub+zip',
        'Content-Disposition': `attachment; filename="${slug}.${book.format === 'PDF' ? 'pdf' : 'epub'}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return response(503)
  }
}
