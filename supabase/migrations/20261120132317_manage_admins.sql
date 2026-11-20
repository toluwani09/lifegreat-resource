create table public.admin_role_audit (
  id bigint generated always as identity primary key,
  actor uuid not null,
  target uuid not null,
  granted boolean not null,
  occurred_at timestamptz not null default now()
);
alter table public.admin_role_audit enable row level security;
revoke all on public.admin_role_audit from public, anon, authenticated;

create function public.find_admin_account(account_email text)
returns table (user_id uuid, email text, is_admin boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, a.user_id is not null
    from auth.users u left join public.admins a on a.user_id = u.id
    where pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(account_email))
      and u.email_confirmed_at is not null;
end;
$$;

create function public.set_admin_access(account_id uuid, grant_access boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  changed boolean;
begin
  if actor_id is null or not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  -- Serialize membership changes and recheck the caller after acquiring the lock.
  lock table public.admins in share row exclusive mode;
  if not public.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if account_id is null or grant_access is null then
    raise exception 'Choose a confirmed registered account.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = account_id and email_confirmed_at is not null) then
    raise exception 'Confirmed account was not found.' using errcode = '22023';
  end if;

  if grant_access then
    insert into public.admins (user_id) values (account_id) on conflict (user_id) do nothing;
    changed := found;
  else
    if actor_id = account_id then
      raise exception 'You cannot remove your own admin access.' using errcode = '22023';
    end if;
    delete from public.admins where user_id = account_id;
    changed := found;
  end if;

  if changed then
    insert into public.admin_role_audit (actor, target, granted)
    values (actor_id, account_id, grant_access);
  end if;
  return changed;
end;
$$;

-- Also protect the last administrator if a user is removed through Auth.
create function public.keep_last_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  lock table public.admins in share row exclusive mode;
  if not exists (select 1 from public.admins where user_id <> old.user_id) then
    raise exception 'The last administrator cannot be removed.' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger admins_keep_last before delete on public.admins
for each row execute function public.keep_last_admin();

revoke all on function public.find_admin_account(text), public.set_admin_access(uuid, boolean), public.keep_last_admin()
from public, anon, authenticated;
grant execute on function public.find_admin_account(text), public.set_admin_access(uuid,boolean) to authenticated;
