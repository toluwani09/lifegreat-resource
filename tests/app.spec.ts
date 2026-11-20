import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { type Book, type Fellowship } from '../src/model'

const starter = JSON.parse(readFileSync(new URL('../src/starter-catalogue.json', import.meta.url), 'utf8')) as Book[]

const base = 'https://lifegreat-test.supabase.co'
const userId = '11111111-1111-4111-8111-111111111111'
const session = {
  access_token:'test-access-token',refresh_token:'test-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,
  user:{ id:userId,role:'authenticated',aud:'authenticated',app_metadata:{provider:'google'},user_metadata:{} },
}

async function mockApi(page: Page, role: 'guest' | 'reader' | 'admin' = 'guest') {
  const events: Fellowship[] = []
  let review = null as null | {rating:number; body:string; status:string; updated_at:string}
  let report: unknown
  if (role !== 'guest') {
    await page.addInitScript(state => localStorage.setItem('sb-lifegreat-test-auth-token',JSON.stringify(state)),session)
  }
  await page.route(`${base}/**`, async route => {
    const req = route.request()
    const url = new URL(req.url())
    const endpoint = url.pathname.split('/').pop()
    const object = req.headers().accept?.includes('vnd.pgrst.object')
    const reply = async (value: unknown) => route.fulfill({ json:value,headers:{'access-control-allow-origin':'*'} })
    const method = req.method()
    if (method === 'OPTIONS') return route.fulfill({status:204,headers:{
      'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers':req.headers()['access-control-request-headers'] ?? '*',
    }})
    if (endpoint === 'books') {
      const slug = url.searchParams.get('slug')?.slice(3)
      return reply(slug ? (starter.find(book => book.slug === slug) ?? null) : starter)
    }
    if (endpoint === 'user') return reply(session.user)
    if (endpoint === 'is_admin') return reply(role === 'admin')
    if (endpoint === 'fellowships') {
      if (method === 'POST') { events.push(req.postDataJSON());return reply({}) }
      if (method === 'PATCH') {
        const entry = events.find(event => `eq.${event.id}` === url.searchParams.get('id'))
        Object.assign(entry!,req.postDataJSON())
        return reply(object ? {id:entry!.id} : [entry])
      }
      return reply(url.searchParams.has('status') ? events.filter(event => ['published','cancelled'].includes(event.status)) : events)
    }
    if (endpoint === 'public_reviews') return reply([])
    if (endpoint === 'reviews') return reply(review)
    if (endpoint === 'save_review') {
      const data = req.postDataJSON()
      review = {rating:data.stars,body:data.comment,status:'pending',updated_at:new Date().toISOString()}
      return reply(null)
    }
    if (endpoint === 'submit_report') { report = req.postDataJSON();return reply(null) }
    return route.fulfill({status:500,json:{message:`Unexpected test endpoint: ${url.pathname}`}})
  })
  return {events,review:() => review,report:() => report}
}

test('guest browses, searches and starts a book download using only the keyboard', async ({page,context}) => {
  await mockApi(page)
  await context.route('https://gutenberg.pglaf.org/**', route => route.fulfill({
    status:200,contentType:'application/epub+zip',headers:{'Content-Disposition':'attachment; filename="book.epub"'},body:'EPUB transfer fixture',
  }))
  await page.goto('/')
  await page.keyboard.press('Tab')
  await expect(page.getByText('Skip to content')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('main')).toBeFocused()
  const search = page.getByRole('searchbox')
  await search.fill('Pilgrim')
  await search.press('Enter')
  await expect(page).toHaveURL(/\/books\?q=Pilgrim$/)
  const result = page.getByRole('link',{name:'The Pilgrim’s Progress',exact:true})
  await result.focus()
  await expect(result).toBeFocused()
  await result.press('Enter')
  await expect(page).toHaveURL(/\/books\/gutenberg-131$/)
  await expect(page.getByRole('heading',{name:'The Pilgrim’s Progress',level:1,exact:true})).toBeVisible()
  const link = page.getByRole('link',{name:'Download EPUB'})
  await expect(link).toHaveAttribute('href',/gutenberg\.pglaf\.org/)
  await link.focus()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({hasText:'Download started'})).toBeVisible()
  expect((await download).suggestedFilename()).toBe('book.epub')
})

test('responsive libraries separate audiences and filter children’s books',async ({page}) => {
  await mockApi(page)
  for (const width of [390,1366]) {
    await page.setViewportSize({width,height:820})
    for (const path of ['/','/adults','/children','/books/gutenberg-131','/fellowship']) {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
  }
  await page.goto('/children?q=Bunyan')
  await expect(page.getByText('No matching books.')).toBeVisible()
  await page.getByRole('link',{name:'Clear filters'}).click()
  await expect(page).toHaveURL(/\/children$/)
  await expect(page.getByRole('searchbox')).toHaveValue('')
  await page.getByLabel('Topic').selectOption('Education')
  await expect(page).toHaveURL(/topic=Education/)
  await page.getByLabel('Reading level').selectOption('Developing reader')
  await expect(page.getByRole('link',{name:'The Burgess Bird Book for Children'})).toBeVisible()
  await expect(page.getByRole('link',{name:'The Pilgrim’s Progress'})).toHaveCount(0)
})

test('signed-in reader can save a review and report a book, with admin access restricted',async ({page}) => {
  const api = await mockApi(page,'reader')
  await page.goto('/books/gutenberg-131')
  await page.getByRole('radio',{name:'4',exact:true}).check()
  await page.getByLabel('Your review').fill('Helpful edition')
  await page.getByLabel('I confirm I’m an adult.').check()
  await page.getByRole('button',{name:'Save review'}).click()
  await expect(page.getByText('Your review was saved and is awaiting moderation.')).toBeVisible()
  expect(api.review()).toMatchObject({rating:4,body:'Helpful edition',status:'pending'})
  await page.getByRole('button',{name:'Report an issue'}).click()
  await page.getByRole('combobox',{name:'Issue',exact:true}).selectOption('File quality')
  await page.getByRole('button',{name:'Send report'}).click()
  await expect(page.getByText('Report sent.',{exact:false})).toBeVisible()
  expect(api.report()).toMatchObject({issue:'File quality'})
  await page.goto('/admin')
  await expect(page.getByText('Administrator access is required.')).toBeVisible()
})

test('admin draft, publication, reschedule and cancellation update both public pages', async ({page}) => {
  const api = await mockApi(page,'admin')
  const tomorrow = new Date(Date.now()+86_400_000).toISOString().slice(0,10)
  const nextDay = new Date(Date.now()+2*86_400_000).toISOString().slice(0,10)
  await page.goto('/admin/fellowship')
  await page.getByRole('button',{name:'Schedule fellowship'}).click()
  await page.getByLabel('Theme').fill('Faith in everyday life')
  await page.getByLabel('Host').fill('Fellowship team')
  await page.getByLabel('Date (WAT)').fill(tomorrow)
  await page.getByLabel('Start time (WAT)').fill('16:00')
  await page.getByLabel('Google Meet link').fill('https://meet.google.com/abc-defg-hij')
  await page.getByRole('button',{name:'Preview',exact:true}).click()
  await expect(page.getByText('Preview',{exact:true}).last()).toBeVisible()
  await page.getByRole('button',{name:'Save draft'}).click()
  await expect(page.getByText('Draft',{exact:false}).first()).toBeVisible()
  await page.goto('/')
  await expect(page.getByText('No upcoming fellowship has been published.')).toBeVisible()
  await page.goto('/admin/fellowship')
  await page.getByRole('button',{name:'Edit',exact:true}).click()
  await page.getByRole('button',{name:'Publish',exact:true}).click()
  await expect(page.getByText('Fellowship published.')).toBeVisible()
  for (const path of ['/','/fellowship']) {
    await page.goto(path)
    await expect(page.getByText('Faith in everyday life',{exact:true})).toBeVisible()
    await expect(page.locator('time')).toHaveAttribute('datetime',`${tomorrow}T15:00:00.000Z`)
  }
  await expect(page.getByRole('link',{name:'Join fellowship'})).toHaveAttribute('href','https://meet.google.com/abc-defg-hij')
  await page.goto('/admin/fellowship')
  await page.getByRole('button',{name:'Edit / reschedule'}).click()
  await page.getByLabel('Date (WAT)').fill(nextDay)
  await page.getByRole('button',{name:'Save / reschedule'}).click()
  await expect(page.getByText('Fellowship updated.',{exact:false})).toBeVisible()
  for (const path of ['/','/fellowship']) {
    await page.goto(path)
    await expect(page.locator('time')).toHaveAttribute('datetime',`${nextDay}T15:00:00.000Z`)
  }
  await page.goto('/admin/fellowship')
  await page.getByRole('button',{name:'Cancel event'}).click()
  await page.getByRole('button',{name:'Confirm cancellation'}).click()
  await expect(page.getByText('Fellowship cancelled.')).toBeVisible()
  expect(api.events[0]).toMatchObject({status:'cancelled',meet_url:null})
  for (const path of ['/','/fellowship']) {
    await page.goto(path)
    await expect(page.getByText(/Cancelled/)).toBeVisible()
    await expect(page.getByRole('link',{name:'Join fellowship'})).toHaveCount(0)
  }
})

test('unavailable book and backend error show clear messages', async ({page}) => {
  await mockApi(page)
  await page.goto('/books/unavailable')
  await expect(page.getByRole('alert')).toHaveText('This book is unavailable.')
  await page.route(`${base}/rest/v1/books?*`,route => route.fulfill({status:400,json:{message:'Unavailable'}, headers:{'access-control-allow-origin':'*'}}))
  await page.goto('/adults')
  await expect(page.getByRole('alert')).toHaveText(/couldn’t load the catalogue/)
})
