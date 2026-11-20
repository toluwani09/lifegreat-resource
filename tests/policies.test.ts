import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const db = new PGlite()
const admin = '00000000-0000-4000-8000-000000000001'
const reader = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000003'
const book = '10000000-0000-4000-8000-000000000001'
const path = '20000000-0000-4000-8000-000000000001.pdf'
const event = '30000000-0000-4000-8000-000000000001'
const migration = readFileSync(new URL('../supabase/migrations/20261120121939_library.sql',import.meta.url),'utf8')

async function run(role: 'anon' | 'authenticated', uid: string, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`)
    await tx.query('select set_config(\'request.jwt.claim.sub\',$1,true)', [uid])
    return (await tx.query(sql,params)).rows
  })
}
const guest = (query: string, params?: unknown[]) => run('anon','',query,params)
const as = (uid: string, query: string, params?: unknown[]) => run('authenticated',uid,query,params)

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,delete on storage.objects to anon,authenticated;
  `)
  await db.exec(migration)
  await db.exec(execFileSync(process.execPath,['scripts/catalogue-sql.mjs'],{encoding:'utf8'}))
  await db.exec(`insert into auth.users values ('${admin}'),('${reader}'),('${other}'); insert into public.admins values ('${admin}')`)
}, 30000)

afterAll(async () => { await db.close() })

describe('database access and publication', () => {
  it('imports the launch books and gives guests read-only access', async () => {
    expect(await guest('select audience, count(*)::int as count from public.books group by audience order by audience')).toEqual([
      {audience:'Adults',count:20},{audience:'Children',count:20},
    ])
    expect(await as(reader,'select public.is_admin() as admin')).toEqual([{admin:false}])
    await expect(as(reader,"insert into public.books(slug,title,author,audience,topic) values ('denied','Denied','Reader','Adults','Education')")).rejects.toThrow(/row-level security/)
    await expect(as(reader,'insert into public.admins values ($1)',[reader])).rejects.toThrow(/permission denied/)
  })

  it('keeps uploads private and audits book publication, removal and restoration', async () => {
    await as(admin,"insert into storage.objects (bucket_id,name) values ('book-files',$1)",[path])
    await as(admin,`insert into public.books(id,slug,title,author,description,audience,topic,source_name,source_url,edition,rights,file_path,format)
      values ($1,'test-book','Test book','Author','About the book','Adults','Christian','Source','https://example.com','First edition','Licensed',$2,'PDF')`,[book,path])
    expect(await guest('select id from public.books where id=$1',[book])).toEqual([])
    expect(await guest('select name from storage.objects')).toEqual([])
    expect(await as(reader,'select name from storage.objects')).toEqual([])
    await expect(as(reader,"insert into storage.objects(bucket_id,name) values ('book-files',$1)",[path])).rejects.toThrow(/row-level security/)
    await as(admin,"update public.books set status='published' where id=$1",[book])
    expect(await guest('select id from public.books where id=$1',[book])).toEqual([{id:book}])
    expect(await guest('select name from storage.objects')).toEqual([])
    await expect(as(admin,"update public.books set status='unpublished' where id=$1",[book])).rejects.toThrow(/reason/)
    await as(admin,'select public.unpublish_book($1,$2)',[book,'Review source rights'])
    expect(await guest('select id from public.books where id=$1',[book])).toEqual([])
    expect(await as(admin,'delete from storage.objects where name=$1 returning name',[path])).toEqual([])
    await as(admin,"update public.books set status='published' where id=$1",[book])
    expect(await as(admin,'select actor,action,detail from public.library_audit where entity_id=$1 order by id',[book])).toEqual([
      {actor:admin,action:'published',detail:''},
      {actor:admin,action:'unpublished',detail:'Review source rights'},
      {actor:admin,action:'published',detail:''},
    ])
  })

  it('keeps reviews private until moderated and restricts updates to the author', async () => {
    const [{id}] = await guest("select id from public.books where slug='gutenberg-131'") as {id:string}[]
    const save = 'select public.save_review($1,$2::smallint,$3,$4)'
    await expect(guest(save,[id,5,'guest',true])).rejects.toThrow(/permission denied/)
    await expect(as(reader,save,[id,5,'test',false])).rejects.toThrow(/Adult sign-in/)
    await as(reader,save,[id,4,'Useful read',true])
    expect(await guest('select * from public.public_reviews($1)',[id])).toEqual([])
    expect(await as(other,'select * from public.reviews where book_id=$1',[id])).toEqual([])
    await expect(as(other,"update public.reviews set body='changed' where book_id=$1",[id])).rejects.toThrow(/permission denied/)
    await expect(as(reader,"select public.moderate_review($1,$2,'approved')",[id,reader])).rejects.toThrow(/Administrator/)
    await as(admin,"select public.moderate_review($1,$2,'approved')",[id,reader])
    expect(await guest('select rating,body from public.public_reviews($1)',[id])).toEqual([{rating:4,body:'Useful read'}])
    await as(reader,save,[id,3,'Updated',true])
    expect(await guest('select rating from public.public_reviews($1)',[id])).toEqual([])
    expect(await as(reader,'select rating,body,status from public.reviews where book_id=$1',[id])).toEqual([{rating:3,body:'Updated',status:'pending'}])
    await guest("select public.submit_report($1,'Broken link','Could not open')",[id])
    expect(await as(reader,'select * from public.reports')).toEqual([])
    const [{id:report}] = await as(admin,'select id from public.reports where book_id=$1',[id]) as {id:string}[]
    await as(admin,'select public.resolve_report($1)',[report])
    expect(await as(admin,'select resolved from public.reports where id=$1',[report])).toEqual([{resolved:true}])
  })

  it('publishes, reschedules, cancels and unpublishes a single authoritative event', async () => {
    await as(admin,`insert into public.fellowships(id,theme,host,starts_at,duration_minutes)
      values ($1,'Prayer monthly','Host','2030-01-01T15:00Z',45)`,[event])
    expect(await guest('select theme from public.fellowships')).toEqual([])
    await as(reader,"update public.fellowships set status='published' where id=$1",[event])
    expect(await guest('select theme from public.fellowships')).toEqual([])
    await as(admin,"update public.fellowships set status='published',meet_url='https://meet.google.com/abc-defg-hij' where id=$1",[event])
    expect(await guest('select theme from public.fellowships')).toEqual([{theme:'Prayer monthly'}])
    await as(admin,"update public.fellowships set starts_at='2030-01-02T16:00Z' where id=$1",[event])
    expect(await guest("select extract(day from starts_at)::int as day from public.fellowships")).toEqual([{day:2}])
    await as(admin,"update public.fellowships set status='cancelled',meet_url=null where id=$1",[event])
    expect(await guest('select status,meet_url from public.fellowships')).toEqual([{status:'cancelled',meet_url:null}])
    await as(admin,"update public.fellowships set status='unpublished' where id=$1",[event])
    expect(await guest('select theme from public.fellowships')).toEqual([])
    expect(await as(admin,'select action from public.library_audit where entity_id=$1 order by id',[event])).toEqual([
      {action:'published'},{action:'rescheduled'},{action:'cancelled'},{action:'unpublished'},
    ])
  })
})
