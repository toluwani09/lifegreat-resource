# LifeGreat Resource

A mobile-first library for free Christian and educational e-books, reader reviews, and monthly online fellowship. Guests can browse and download. Adult readers can sign in with Google to review a book. Admins publish and moderate catalogue entries and fellowship events.

## Local setup on Windows

Install Git and Node.js 24 LTS. Clone the repository, open PowerShell in its directory, and run:

```powershell
npm ci
npm run dev
```

Open http://localhost:5173. With no environment file, the app displays the verified starter catalogue and the fellowship empty state. Google sign-in, review submission, reports, and admin functions require Supabase.

For a connected run:

```powershell
Copy-Item .env.example .env.local
```

Set the Supabase project URL and its **publishable** key in `.env.local`, then restart Vite. The publishable key is intended for the browser. Keep the service-role key, database password, and Google OAuth secret out of browser environment variables and Git.

## Set up Supabase

Create a free Supabase project in your account after deployment is approved. Use the Supabase CLI from a supported installation method, then run:

```powershell
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase functions deploy book-download --no-verify-jwt
```

The migration creates the library tables, policies, audit records, and the private `book-files` bucket. The public download function looks up the book’s current publication status on each request and streams only the recorded PDF or EPUB. Supabase injects its service-role credential into the Edge Function environment. The function never sends it to a reader. A previously downloaded copy stays on the reader’s device.

For local Supabase development with Docker, run `supabase start`, apply the local migration with `supabase db reset`, and serve the function with `supabase functions serve book-download --no-verify-jwt`. Use the local API URL and publishable key reported by `supabase status`. Reset only a disposable local database.

### Import the starter catalogue

Run `node scripts/catalogue-sql.mjs` and paste the resulting SQL into the Supabase SQL Editor. To save it to a file in PowerShell, use:

```powershell
node scripts/catalogue-sql.mjs | Set-Content -Encoding utf8 starter-catalogue.sql
```

Existing slugs are skipped, preserving any admin changes. The [catalogue JSON](src/starter-catalogue.json) contains 40 editions, split evenly across Adults and Children, with ten Christian and ten Education titles per audience. Each record includes the exact edition identifier, attribution, source, format, and provider rights statement. Project Gutenberg’s [machine-readable catalogue](https://www.gutenberg.org/ebooks/offline_catalogs.html) supplied the edition and rights metadata. On 19 November 2026 we checked all 40 EPUB links against the publisher’s [PGLAF mirror](https://www.gutenbergnews.org/2026/pg-monthly-newsletter-june-2026/) and confirmed that they delivered EPUB archive headers. The collection uses text-based placeholder covers and publisher-hosted copies. Project Gutenberg’s rights statement is specific to the US. Refer to its [permission guidance](https://www.gutenberg.org/policy/permission.html) and verify local redistribution rights before rehosting an edition.

### Google sign-in and first administrator

1. Create a web OAuth client in Google Cloud. Use the callback URL displayed by the Supabase Google provider as a Google authorised redirect URI.
2. Enable Google under Supabase Authentication providers and enter the OAuth client ID and secret there.
3. Add `http://localhost:5173/account` to Supabase Authentication → URL Configuration → Redirect URLs for local sign-in. For production, add the exact production origin followed by `/account` (for example, `https://lifegreat-resource.pages.dev/account`) and set Site URL to the actual production origin. Successful sign-in finishes at the homepage.
4. Have the intended admin sign in once. Copy their verified user UUID from Supabase Authentication → Users. In the SQL Editor, insert that UUID into `public.admins`:

```sql
insert into public.admins (user_id) values ('REPLACE_WITH_VERIFIED_USER_UUID');
```

Refresh the app or sign in again. Existing administrators can then open **Admin → Manage Admins** to grant or revoke access for a confirmed registered reader by exact email. Changes are audited. A reader cannot grant themselves admin access. See the [Supabase Google provider documentation](https://supabase.com/docs/guides/auth/social-login/auth-google) and [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).

### Publish the first fellowship

In **Admin → Fellowship → Schedule fellowship**, enter the theme, description, host, date and time in WAT, duration, and Google Meet link. Use **Preview** to review the public information. Choose **Save draft** to keep it private or **Publish** to make it visible on the homepage and Fellowship page. Use **Edit / reschedule** to change the date or time. **Cancel event** shows a cancellation and removes the join link. **Unpublish** removes the event from both public surfaces. An uploaded book can be unpublished with a reason and restored from the catalogue editor.

## Cloudflare Pages

After approval, connect the repository to a Cloudflare Pages project. Use `main` as the production branch, the build command `npm run build`, Node 24, and output directory `dist`. Set the two Vite environment variables in the Pages build environment. Use the default single-page application route fallback and verify a direct visit to `/books/gutenberg-131`. Complete the Google/Supabase redirect configuration after the Pages hostname is assigned. See the [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The unit and policy suite runs the migration in embedded PostgreSQL with test equivalents of the Supabase Auth and Storage schemas. The browser suite exercises desktop and mobile layouts and reader and admin flows against a simulated Supabase API. After configuring a real project, smoke-test Google sign-in, a PDF/EPUB upload and guest download, access after unpublishing, and a fellowship event including calendar export and the Meet link. These checks require the actual provider accounts.

## Import verified editions

From the project folder, run `node scripts/catalogue-dry-run.mjs path/to/catalogue.json` (or use a CSV with the same column names). It validates rows locally and reports duplicates within the file. It does not connect to Supabase or check external URLs.

In the signed-in admin dashboard, choose **Catalogue imports**, add a batch name, and select the file. **Dry run** also checks the database for existing or staged editions. **Stage new editions** creates pending batches of up to 200 rows. Use **Review batch** to inspect the edition source, rights evidence and download link. Confirm the review before selecting **Publish reviewed batch**. A pending batch is private. The original Project Gutenberg titles are outside the verified-edition import.

Required fields are slug, title, author, publisher, edition, publication_year, language, audience, topic, subject, scholarly_level, format, description, source_name, source_url, rights, rights_url, attribution and verified_on. Set reading_level for children using an existing reading-level label. An optional download_url points to a verified source file; omit it to use the official access page. Format is PDF or EPUB. The import accepts publication years from 1980 through the current year. The verification date uses YYYY-MM-DD.
