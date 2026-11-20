alter table public.books
  add column publication_year integer check (publication_year between 1000 and 2999),
  add column subject text check (length(subject) <= 120),
  add column publisher text check (length(publisher) <= 160),
  add column rights_url text check (rights_url ~ '^https://[^[:space:]]+$'),
  add column attribution text check (length(attribution) <= 1000),
  add column verified_on date,
  add column edition_key text,
  add column scholarly_level text check (length(scholarly_level) <= 80);

create unique index books_edition_key on public.books(edition_key) where edition_key is not null;
create unique index books_imported_source_edition on public.books(source_url,edition) where edition_key is not null;
create index books_published_title on public.books(title,id) where status = 'published';

create function public.search_catalogue(
  phrase text default '', audience_filter text default '', topic_filter text default '',
  subject_filter text default '', language_filter text default '', level_filter text default '',
  year_filter integer default null, format_filter text default '',
  page_offset integer default 0, page_size integer default 16
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matches as materialized (
    select b.id,b.slug,b.title,b.author,b.audience,b.topic,b.reading_level,b.language,
      b.publication_year,b.subject,b.format,b.scholarly_level
    from public.books b
    where b.status = 'published'
      and (audience_filter = '' or b.audience = audience_filter)
      and (topic_filter = '' or b.topic = topic_filter)
      and (subject_filter = '' or strpos(lower(coalesce(b.subject,'')),lower(subject_filter)) > 0)
      and (language_filter = '' or lower(b.language) = lower(language_filter))
      and (level_filter = '' or b.reading_level = level_filter or b.scholarly_level = level_filter)
      and (year_filter is null or b.publication_year = year_filter)
      and (format_filter = '' or b.format = format_filter)
      and not exists (
        select 1 from regexp_split_to_table(lower(trim(left(phrase,120))), '[[:space:]]+') term
        where term <> '' and strpos(lower(b.title || ' ' || b.author),term) = 0
      )
  ), page as (
    select * from matches order by title,id
    offset greatest(0,least(page_offset,100000))
    limit greatest(1,least(page_size,50))
  ) select jsonb_build_object(
    'books', coalesce((select jsonb_agg(page order by page.title,page.id) from page),'[]'::jsonb),
    'total', (select count(*) from matches)
  );
$$;
revoke all on function public.search_catalogue(text,text,text,text,text,text,integer,text,integer,integer) from public;
grant execute on function public.search_catalogue(text,text,text,text,text,text,integer,text,integer,integer) to anon,authenticated;

create table public.catalogue_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 150),
  staged_by uuid not null,
  staged_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  published_count integer
);
create table public.catalogue_staging (
  batch_id uuid not null references public.catalogue_batches(id),
  edition_key text not null,
  record jsonb not null,
  primary key (batch_id,edition_key)
);
alter table public.catalogue_batches enable row level security;
alter table public.catalogue_staging enable row level security;
revoke all on public.catalogue_batches,public.catalogue_staging from public,anon,authenticated;
grant select on public.catalogue_batches,public.catalogue_staging to authenticated;
create policy catalogue_admin_batches on public.catalogue_batches for select to authenticated using ((select public.is_admin()));
create policy catalogue_admin_staging on public.catalogue_staging for select to authenticated using ((select public.is_admin()));

create function public.stage_catalogue_batch(batch_label text, editions jsonb, dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_batch uuid; item jsonb; rec public.books; seen text[] := '{}'; seen_slugs text[] := '{}';
        duplicate_count integer := 0; accepted integer := 0; edition_fingerprint text;
begin
  perform public.require_admin();
  if batch_label is null or length(trim(batch_label)) not between 1 and 150
    or jsonb_typeof(editions) is distinct from 'array' then raise exception 'Provide a batch name and an edition array.'; end if;
  if jsonb_array_length(editions) not between 1 and 200 then raise exception 'Each batch must contain 1–200 editions.'; end if;
  if dry_run is false then
    lock table public.catalogue_batches in share row exclusive mode;
    insert into public.catalogue_batches(label,staged_by) values (trim(batch_label),auth.uid()) returning id into new_batch;
  end if;
  for item in select value from jsonb_array_elements(editions) loop
    rec := jsonb_populate_record(null::public.books,item);
    if not coalesce(
      rec.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(rec.slug) <= 150
      and length(trim(rec.title)) between 1 and 250 and length(trim(rec.author)) between 1 and 200
      and length(trim(rec.description)) between 1 and 3000 and length(trim(rec.edition)) between 1 and 500
      and length(trim(rec.source_name)) between 1 and 150 and length(trim(rec.publisher)) between 1 and 160
      and length(trim(rec.rights)) between 1 and 2000 and length(trim(rec.attribution)) between 1 and 1000
      and length(trim(rec.subject)) between 1 and 120 and length(trim(rec.language)) between 1 and 80
      and length(trim(rec.scholarly_level)) between 1 and 80
      and rec.audience in ('Adults','Children') and rec.topic in ('Christian','Education')
      and ((rec.audience = 'Adults' and rec.reading_level is null) or
        (rec.audience = 'Children' and rec.reading_level in ('Read together','Developing reader','Independent reader')))
      and rec.publication_year between 2020 and extract(year from current_date)
      and rec.verified_on between make_date(rec.publication_year,1,1) and current_date
      and rec.source_url ~ '^https://[^/[:space:]@]+/[^[:space:]]+$'
      and rec.rights_url ~ '^https://[^/[:space:]@]+/[^[:space:]]+$'
      and (rec.download_url is null or rec.download_url ~ '^https://[^/[:space:]@]+/[^[:space:]]+$')
      and rec.format in ('PDF','EPUB'), false
    ) then raise exception 'Invalid edition at row %.', accepted + duplicate_count + 1 using errcode = '22023'; end if;
    edition_fingerprint := md5(lower(regexp_replace(trim(rec.title),'[^[:alnum:]]','','g')) || '|' ||
      lower(regexp_replace(trim(rec.author),'[^[:alnum:]]','','g')) || '|' ||
      lower(regexp_replace(trim(rec.edition),'[^[:alnum:]]','','g')) || '|' || rec.publication_year);
    if edition_fingerprint = any(seen) or rec.slug = any(seen_slugs) or exists (
      select 1 from public.books b where b.slug = rec.slug or b.edition_key = edition_fingerprint
        or (b.source_url = rec.source_url and b.edition = rec.edition)
    ) or exists (
      select 1 from public.catalogue_staging s join public.catalogue_batches b on b.id = s.batch_id
      where b.approved_at is null and (s.edition_key = edition_fingerprint or s.record->>'slug' = rec.slug)
    ) then
      duplicate_count := duplicate_count + 1;
      continue;
    end if;
    seen := array_append(seen,edition_fingerprint);
    seen_slugs := array_append(seen_slugs,rec.slug);
    accepted := accepted + 1;
    if new_batch is not null then
      insert into public.catalogue_staging(batch_id,edition_key,record) values (new_batch,edition_fingerprint,item);
    end if;
  end loop;
  if new_batch is not null and accepted = 0 then raise exception 'No new editions to stage.'; end if;
  return jsonb_build_object('batch_id',new_batch,'accepted',accepted,'duplicates',duplicate_count);
end $$;

create function public.publish_catalogue_batch(target_batch uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare target public.catalogue_batches; inserted integer;
begin
  perform public.require_admin();
  select * into target from public.catalogue_batches where id = target_batch for update;
  if not found then raise exception 'Batch not found.'; end if;
  if target.approved_at is not null then return target.published_count; end if;

  insert into public.books(slug,title,author,description,audience,topic,language,reading_level,
    source_name,source_url,edition,rights,download_url,format,status,publication_year,subject,
    publisher,rights_url,attribution,verified_on,edition_key,scholarly_level)
  select r.slug,r.title,r.author,r.description,r.audience,r.topic,r.language,r.reading_level,
    r.source_name,r.source_url,r.edition,r.rights,r.download_url,r.format,'published',r.publication_year,r.subject,
    r.publisher,r.rights_url,r.attribution,r.verified_on,s.edition_key,r.scholarly_level
  from public.catalogue_staging s cross join lateral jsonb_populate_record(null::public.books,s.record) r
  where s.batch_id = target_batch
  on conflict do nothing;

  get diagnostics inserted = row_count;
  update public.catalogue_batches set approved_by=auth.uid(),approved_at=now(),published_count=inserted where id=target_batch;
  return inserted;
end $$;

revoke all on function public.stage_catalogue_batch(text,jsonb,boolean),public.publish_catalogue_batch(uuid) from public,anon,authenticated;
grant execute on function public.stage_catalogue_batch(text,jsonb,boolean),public.publish_catalogue_batch(uuid) to authenticated;
