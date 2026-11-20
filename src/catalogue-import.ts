import Papa from 'papaparse'

const textFields = {
  slug:150,title:250,author:200,description:3000,edition:500,source_name:150,publisher:160,
  rights:2000,attribution:1000,subject:120,language:80,scholarly_level:80,
} as const

function validUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname !== '/' && !/\s/.test(value) }
  catch { return false }
}

export function parseCatalogue(text: string, filename: string) {
  let input: unknown
  if (filename.toLowerCase().endsWith('.csv')) {
    const parsed = Papa.parse(text,{header:true,skipEmptyLines:'greedy'})
    if (parsed.errors.length) throw new Error(parsed.errors[0].message)
    if (parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length) throw new Error('Duplicate CSV header.')
    input = parsed.data
  } else input = JSON.parse(text)
  if (!Array.isArray(input) || input.length === 0) throw new Error('Provide a non-empty array of editions.')
  if (input.length > 5000) throw new Error('A file can contain at most 5,000 editions.')

  let duplicates = 0
  const slugs = new Set<string>()
  const editionKeys = new Set<string>()
  const editions: Record<string,string | number | null>[] = []
  const today = new Date().toISOString().slice(0,10)
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')
  for (const [index,raw] of input.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Row ${index+1}: expected an edition object.`)
    const read = (name: string) => typeof raw[name] === 'string' ? raw[name].trim() : ''
    const fail = (field: string): never => { throw new Error(`Row ${index+1}: invalid or missing ${field}.`) }
    const values = Object.fromEntries(Object.entries(textFields).map(([field,max]) => {
      const value = read(field)
      if (!value || value.length > max) fail(field)
      return [field,value]
    }))
    const year = Number(raw.publication_year)
    const date = read('verified_on')
    const dateValue = new Date(date + 'T00:00:00Z')
    const audience = read('audience'), topic = read('topic'), format = read('format'), level = read('reading_level')
    const source = read('source_url'), rights = read('rights_url'), download = read('download_url')
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) fail('slug')
    if (!Number.isInteger(year) || year < 2020 || year > Number(today.slice(0,4))) fail('publication_year')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+dateValue) ||
      dateValue.toISOString().slice(0,10) !== date || date < `${year}-01-01` || date > today) fail('verified_on')
    if (!['Adults','Children'].includes(audience)) fail('audience')
    if (!['Christian','Education'].includes(topic)) fail('topic')
    if (!['PDF','EPUB'].includes(format)) fail('format')
    if (audience === 'Children' ? !['Read together','Developing reader','Independent reader'].includes(level) : Boolean(level)) fail('reading_level')
    if (!validUrl(source)) fail('source_url')
    if (!validUrl(rights)) fail('rights_url')
    if (download && !validUrl(download)) fail('download_url')

    const fingerprint = [values.title,values.author,values.edition].map(normalize).join('|') + `|${year}`
    if (slugs.has(values.slug) || editionKeys.has(fingerprint)) { duplicates++; continue }
    slugs.add(values.slug)
    editionKeys.add(fingerprint)
    editions.push({...values,publication_year:year,verified_on:date,audience,topic,format,reading_level:level || null,
      source_url:source,rights_url:rights,download_url:download || null})
  }
  return {editions,duplicates}
}
