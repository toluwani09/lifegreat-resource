import { downloadBook } from './handler.ts'

Deno.serve(request => downloadBook(request, Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')))
