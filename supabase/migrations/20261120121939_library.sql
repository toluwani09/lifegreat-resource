create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.admins where user_id = (select auth.uid())) $$;

create table public.books (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(trim(title)) between 1 and 250),
  author text not null check (length(trim(author)) between 1 and 200),
  description text not null default '' check (length(description) <= 3000),
  audience text not null check (audience in ('Adults','Children')),
  topic text not null check (topic in ('Christian','Education')),
  language text not null default 'English' check (length(trim(language)) between 1 and 80),
  reading_level text check (reading_level in ('Read together','Developing reader','Independent reader')),
  source_name text not null default '' check (length(source_name) <= 150),
  source_url text check (source_url ~ '^https://[^/[:space:]]'),
  edition text not null default '' check (length(edition) <= 500),
  rights text not null default '' check (length(rights) <= 2000),
  download_url text check (download_url ~ '^https://[^/[:space:]]'),
  file_path text unique check (file_path ~ '^[0-9a-f-]{36}\.(pdf|epub)$'),
  format text check (format in ('PDF','EPUB')),
  file_size bigint check (file_size > 0),
  status text not null default 'draft' check (status in ('draft','published','unpublished')),
  check ((audience = 'Children') = (reading_level is not null)),
  check (file_path is null or download_url is null),
  check (file_path is null or lower(format) = split_part(file_path,'.',2) and format is not null),
  check (download_url is null or format is not null),
  check (status <> 'published' or (source_url is not null and length(trim(source_name)) > 0
    and length(trim(edition)) > 0 and length(trim(rights)) > 0 and length(trim(description)) > 0))
);

create index books_audience on public.books(audience, status, title);

create table public.fellowships (
  id uuid primary key default gen_random_uuid(),
  theme text not null check (length(trim(theme)) between 1 and 150),
  description text not null default '' check (length(description) <= 2500),
  host text not null check (length(trim(host)) between 1 and 120),
  starts_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 1 and 60),
  meet_url text check (meet_url ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  status text not null default 'draft' check (status in ('draft','published','cancelled','unpublished')),
  check ((status = 'published') = (meet_url is not null) or status in ('draft','unpublished'))
);

create index fellowship_schedule on public.fellowships(status, starts_at);

create table public.reviews (
  book_id uuid references public.books(id) not null,
  user_id uuid references auth.users(id) on delete cascade default auth.uid() not null,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (length(body) <= 1500),
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  updated_at timestamptz not null default now(),
  primary key (book_id,user_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id),
  reason text not null check (reason in ('Broken link','File quality','Audience suitability','Copyright')),
  details text not null default '' check (length(details) <= 1500),
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);

create index reports_book_reason_time on public.reports(book_id, reason, created_at);

create table public.library_audit (
  id bigint generated always as identity primary key,
  actor uuid not null,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  detail text not null default '',
  occurred_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.books enable row level security;
alter table public.fellowships enable row level security;
alter table public.reviews enable row level security;
alter table public.reports enable row level security;
alter table public.library_audit enable row level security;

revoke all on public.admins, public.books, public.fellowships, public.reviews, public.reports, public.library_audit from anon, authenticated;
grant select on public.books, public.fellowships to anon, authenticated;
grant insert, update on public.books, public.fellowships to authenticated;
grant select on public.reviews, public.reports, public.library_audit to authenticated;

create policy books_read on public.books for select to anon,authenticated
using (status = 'published' or (select public.is_admin()));
create policy books_insert on public.books for insert to authenticated
with check ((select public.is_admin()));
create policy books_update on public.books for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

create policy fellowships_read on public.fellowships for select to anon,authenticated
using (status in ('published','cancelled') or (select public.is_admin()));
create policy fellowships_insert on public.fellowships for insert to authenticated
with check ((select public.is_admin()));
create policy fellowships_update on public.fellowships for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));

create policy review_private_read on public.reviews for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy reports_admin_read on public.reports for select to authenticated
using ((select public.is_admin()));
create policy audit_admin_read on public.library_audit for select to authenticated
using ((select public.is_admin()));

create function public.require_admin() returns void language plpgsql
set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
end $$;

create function public.audit_library_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare change_action text;
begin
  if auth.uid() is null then return new; end if;

  if tg_table_name = 'books' then
    if tg_op = 'UPDATE' and old.status = 'published' and new.status = 'draft' then
      raise exception 'Unpublish the book with a reason before returning it to draft';
    end if;
    if new.status = 'published' and new.file_path is not null and not exists (
      select 1 from storage.objects where bucket_id = 'book-files' and name = new.file_path
    ) then
      raise exception 'The uploaded book file is missing';
    end if;
    if new.status = 'unpublished' and (tg_op = 'INSERT' or old.status <> new.status) then
      if tg_op = 'INSERT' or coalesce(current_setting('lifegreat.unpublish_reason',true),'') = '' then
        raise exception 'An unpublish reason is required';
      end if;
      change_action := 'unpublished';
    elsif new.status = 'published' and (tg_op = 'INSERT' or old.status <> new.status) then
      change_action := 'published';
    end if;
  else
    if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> new.status then
      if old.status <> 'published' then raise exception 'Only a published event can be cancelled'; end if;
      change_action := 'cancelled';
    elsif new.status = 'published' and (tg_op = 'INSERT' or old.status <> new.status) then
      change_action := 'published';
    elsif tg_op = 'UPDATE' and new.status = 'published' and
      (old.starts_at,old.duration_minutes) is distinct from (new.starts_at,new.duration_minutes) then
      change_action := 'rescheduled';
    elsif tg_op = 'UPDATE' and new.status = 'unpublished' and old.status <> new.status then
      change_action := 'unpublished';
    end if;
  end if;

  if change_action is not null then
    insert into public.library_audit(actor,entity,entity_id,action,detail)
    values (auth.uid(),tg_table_name,new.id,change_action,
      case when tg_table_name = 'books' and change_action = 'unpublished'
        then current_setting('lifegreat.unpublish_reason',true) else '' end);
  end if;
  return new;
end $$;

create trigger books_audit after insert or update on public.books
for each row execute function public.audit_library_change();
create trigger fellowships_audit after insert or update on public.fellowships
for each row execute function public.audit_library_change();

create function public.unpublish_book(target uuid, reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if reason is null or length(trim(reason)) not between 1 and 500 then
    raise exception 'Enter an unpublish reason (1–500 characters)';
  end if;
  perform set_config('lifegreat.unpublish_reason',trim(reason),true);
  update public.books set status = 'unpublished' where id = target and status = 'published';
  if not found then raise exception 'This book is no longer published'; end if;
end $$;

create function public.public_reviews(target uuid)
returns table(rating smallint, body text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.rating,r.body,r.updated_at from public.reviews r
  join public.books b on b.id = r.book_id
  where r.book_id = target and r.status = 'approved' and b.status = 'published'
  order by r.updated_at desc limit 50
$$;

create function public.save_review(target uuid, stars smallint, comment text, adult_confirmed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or adult_confirmed is distinct from true then
    raise exception 'Adult sign-in is required' using errcode = '42501';
  end if;
  if not exists(select 1 from public.books where id = target and status = 'published') then
    raise exception 'This book is unavailable';
  end if;
  insert into public.reviews(book_id,user_id,rating,body)
    values(target,auth.uid(),stars,trim(coalesce(comment,'')))
  on conflict (book_id,user_id) do update
    set rating = excluded.rating,body = excluded.body,status = 'pending',updated_at = now();
end $$;

create function public.moderate_review(target uuid, reviewer uuid, decision text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  if decision is null or decision not in ('approved','hidden') then raise exception 'Invalid review decision'; end if;
  update public.reviews set status = decision where book_id = target and user_id = reviewer;
  if not found then raise exception 'Review is unavailable'; end if;
end $$;

create function public.submit_report(target uuid, issue text, message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.books where id = target and status = 'published') then
    raise exception 'This book is unavailable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target::text,0));
  if (select count(*) from public.reports where book_id = target and reason = issue
        and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many reports for this book right now. Try again shortly.';
  end if;
  insert into public.reports(book_id,reason,details) values (target,issue,trim(coalesce(message,'')));
end $$;

create function public.resolve_report(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_admin();
  update public.reports set resolved = true where id = target;
end $$;

revoke execute on function public.is_admin(),public.require_admin(),public.audit_library_change(),
  public.unpublish_book(uuid,text),public.public_reviews(uuid),public.save_review(uuid,smallint,text,boolean),
  public.moderate_review(uuid,uuid,text),public.submit_report(uuid,text,text),public.resolve_report(uuid)
  from public,anon,authenticated;
grant execute on function public.is_admin(),public.public_reviews(uuid),public.submit_report(uuid,text,text) to anon,authenticated;
grant execute on function public.require_admin(),public.unpublish_book(uuid,text),public.save_review(uuid,smallint,text,boolean),
  public.moderate_review(uuid,uuid,text),public.resolve_report(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('book-files','book-files',false,20971520,array['application/pdf','application/epub+zip'])
on conflict (id) do nothing;

create policy book_files_admin_read on storage.objects for select to authenticated
using (bucket_id = 'book-files' and (select public.is_admin()));
create policy book_files_admin_upload on storage.objects for insert to authenticated
with check (bucket_id = 'book-files' and name ~ '^[0-9a-f-]{36}\.(pdf|epub)$' and (select public.is_admin()));
create policy book_files_admin_remove_orphan on storage.objects for delete to authenticated
using (bucket_id = 'book-files' and (select public.is_admin())
  and not exists(select 1 from public.books where file_path = name));
