import console from 'node:console'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { parseCatalogue } from '../src/catalogue-import.ts'

const filename = process.argv[2]
if (!filename) {
  console.error('Usage: node scripts/catalogue-dry-run.mjs FILE.csv|FILE.json')
  process.exitCode = 1
} else {
  try {
    const { editions, duplicates } = parseCatalogue(readFileSync(filename,'utf8'),filename)
    console.log(JSON.stringify({valid_unique_editions:editions.length,duplicates,batches:Math.ceil(editions.length/200)},null,2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
