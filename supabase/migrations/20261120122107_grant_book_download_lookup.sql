-- New Supabase projects can disable automatic Data API grants.
grant select (slug, status, file_path, format) on public.books to service_role;
