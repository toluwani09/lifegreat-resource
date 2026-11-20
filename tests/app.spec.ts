import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { filterBooks, type Book, type Fellowship } from '../src/model'

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
    if (endpoint === 'search_catalogue') {
      const f = req.postDataJSON()
      const books = filterBooks(starter,{query:f.phrase,audience:f.audience_filter,topic:f.topic_filter,subject:f.subject_filter,
        language:f.language_filter,level:f.level_filter,year:f.year_filter,format:f.format_filter})
      return reply({books:books.slice(f.page_offset,f.page_offset+f.page_size),total:books.length})
    }
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
  await page.route(`${base}/rest/v1/rpc/search_catalogue`,route => route.fulfill({status:400,json:{message:'Unavailable'}, headers:{'access-control-allow-origin':'*'}}))
  await page.goto('/adults')
  await expect(page.getByRole('alert')).toHaveText(/couldn’t load the catalogue/)
})

for (const path of ['/account','/books/gutenberg-131','/admin']) {
  test(`Google sign-in from ${path} returns to the homepage after the exchange`, async ({page}) => {
    await mockApi(page)
    await page.route(`${base}/auth/v1/authorize?*`, async route => {
      const callback = new URL(route.request().url()).searchParams.get('redirect_to')
      expect(callback).toBe('http://localhost:4173/account')
      await route.fulfill({status:302,headers:{location:`${callback}?code=test-code`}})
    })
    let exchanges = 0
    await page.route(`${base}/auth/v1/token?*`, async route => {
      exchanges++
      expect(route.request().postDataJSON().auth_code).toBe('test-code')
      await route.fulfill({json:{...session,expires_in:3600},headers:{'access-control-allow-origin':'*'}})
    })
    await page.goto(path)
    await page.getByRole('button',{name:'Sign in with Google'}).click()
    await expect(page).toHaveURL('http://localhost:4173/')
    await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible()
    expect(exchanges).toBe(1)
  })
}

test('OAuth callback failure offers a clear retry path', async ({page}) => {
  await mockApi(page)
  await page.goto('/account?error=access_denied')
  await expect(page.getByRole('alert')).toHaveText(/Google sign-in was not completed/)
  await page.getByRole('link',{name:'Back to sign-in'}).click()
  await expect(page.getByRole('button',{name:'Sign in with Google'})).toBeVisible()
})

test('admin confirms a role grant and revocation for an exact email match', async ({page}) => {
  await mockApi(page,'admin')
  const target = '22222222-2222-4222-8222-222222222222'
  await page.route(`${base}/rest/v1/rpc/find_admin_account`, async route => {
    expect(route.request().postDataJSON()).toEqual({account_email:'reader@example.com'})
    await route.fulfill({json:[{user_id:target,email:'reader@example.com',is_admin:false}],headers:{'access-control-allow-origin':'*'}})
  })
  const changes: boolean[] = []
  await page.route(`${base}/rest/v1/rpc/set_admin_access`, async route => {
    const payload = route.request().postDataJSON()
    expect(payload.account_id).toBe(target)
    changes.push(payload.grant_access)
    await route.fulfill({json:true,headers:{'access-control-allow-origin':'*'}})
  })
  await page.goto('/admin')
  await page.getByRole('link',{name:'Manage Admins'}).click()
  await page.getByLabel('Account email').fill('reader@example.com')
  await page.getByRole('button',{name:'Find account'}).click()
  await expect(page.getByRole('heading',{name:'reader@example.com'})).toBeVisible()
  await page.getByRole('button',{name:'Grant admin access'}).click()
  await expect(page.getByText('Give this account full administrator access?')).toBeVisible()
  expect(changes).toEqual([])
  await page.getByRole('button',{name:'Confirm grant'}).click()
  await expect(page.getByText('Admin access granted.')).toBeVisible()
  await page.getByRole('button',{name:'Revoke admin access'}).click()
  await page.getByRole('button',{name:'Confirm revocation'}).click()
  await expect(page.getByText('Admin access revoked.')).toBeVisible()
  expect(changes).toEqual([true,false])
})

test('catalogue requests only the selected 16-book page at scale', async ({page}) => {
  await mockApi(page)
  const offsets: number[] = []
  await page.route(`${base}/rest/v1/rpc/search_catalogue`, async route => {
    const f = route.request().postDataJSON()
    expect(f.page_size).toBe(16)
    expect(f.audience_filter).toBe('Adults')
    offsets.push(f.page_offset)
    await route.fulfill({json:{books:Array.from({length:16},(_,i)=>({
      ...starter[0],id:`scale-${f.page_offset+i+1}`,slug:`scale-${f.page_offset+i+1}`,title:`Scale book ${f.page_offset+i+1}`,
    })),total:2000},headers:{'access-control-allow-origin':'*'}})
  })
  await page.goto('/adults')
  await expect(page.getByText('Page 1 of 125')).toBeVisible()
  await expect(page.getByRole('link',{name:'Scale book 17',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Next page'}).click()
  await expect(page.getByRole('link',{name:'Scale book 17',exact:true})).toBeVisible()
  await expect(page.getByText('Page 2 of 125')).toBeVisible()
  expect(offsets).toContain(0)
  expect(offsets).toContain(16)
})
