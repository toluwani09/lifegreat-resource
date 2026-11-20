import process from 'node:process'
import { URL } from 'node:url'
import { readFileSync } from 'node:fs'

const books = JSON.parse(readFileSync(new URL('../src/starter-catalogue.json', import.meta.url), 'utf8'))
const fields = [
  'id', 'slug', 'title', 'author', 'description', 'audience', 'topic', 'language', 'reading_level',
  'source_name', 'source_url', 'edition', 'rights', 'download_url', 'file_path', 'format', 'file_size', 'status',
]
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + value.replaceAll("'", "''") + "'"
const values = books.map(book => '(' + fields.map(field => literal(book[field])).join(', ') + ')')
process.stdout.write(`begin;\ninsert into public.books (${fields.join(', ')}) values\n${values.join(',\n')}\non conflict (slug) do nothing;\ncommit;\n`)
