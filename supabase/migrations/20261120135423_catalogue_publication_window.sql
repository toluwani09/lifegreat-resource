create or replace function public.stage_catalogue_batch(batch_label text, editions jsonb, dry_run boolean default true)
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
      and rec.publication_year between 1980 and extract(year from current_date)
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
