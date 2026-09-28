# Kargo Hiring Dashboard

Ranks and explains PM / Senior PM candidates against the Kargo rubric (`data/rubric.txt`), drafts emails, and sends **one email per explicit confirmation**. The system recommends; Arjun decides. Nothing is sent automatically.

Stack: Next.js (App Router, TypeScript, Tailwind) · Supabase (Postgres) · Gemini Flash · Resend · Vercel.

## How it works

1. **Upload** (`/`): pick PM or SPM, drop in PDF/DOCX files (60 at once is fine). Each file's name field is pre-filled from the CV's first line; edit if wrong.
2. **PII separation, in code**: email and phone are pulled out with regex and the name comes from the form. All three are stored in PII columns, then every occurrence of name, email, phone and LinkedIn/GitHub URLs is replaced with `[REDACTED]`. Processing stops if any PII survives. **Only the redacted text is ever sent to Gemini.**
3. **Scoring**: every CV is scored against **both** rubrics (one Gemini call each), with criteria and anchors loaded from the database. The output is validated with zod and retried once on bad JSON, and the candidate is marked `error` if it still fails. Evidence quotes are checked against the CV and flagged if they are not verbatim.
4. **Weighted total and band are computed in code**: Σ weight × score / 5 (20–100). ≥75 shortlist, 55–74 review, <55 below the line.
5. **Briefs and email drafts**: the top 5 applicants per role (by score on their applied role) get a 3-sentence brief, 3 probe questions and an invite draft. Everyone else gets a rejection draft with no scores or criteria. Briefs are regenerated when the top 5 changes, and drafts are switched when a candidate moves in or out of the top 5. Sent emails are never touched.
6. **Sending**: on `/candidates/[id]`, edit the draft and click **Confirm & Send**. The dialog shows the recipient and the final email with the real name filled in. `[NAME]` is replaced on the server at send time. **Test mode: every email goes to `TEST_RECIPIENT_EMAIL`, never to the candidate.**

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
```

### Environment variables

| Name | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | Project Settings → API |
| `SUPABASE_ANON_KEY` | yes | anon / publishable key. Used **server-side only** |
| `GEMINI_API_KEY` | yes | https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | no | defaults to `gemini-flash-latest` |
| `RESEND_API_KEY` | no | leave blank until ready: the send button then shows "Email sending not configured" |
| `RESEND_FROM_EMAIL` | no | defaults to `onboarding@resend.dev` (Resend's test sender) |
| `TEST_RECIPIENT_EMAIL` | for sending | every email is delivered here in test mode |

`.env.local` is git-ignored. All Supabase, Gemini and Resend calls run in server route handlers. No key reaches the browser.

### Run the migration

The migration creates the tables and seeds both rubrics from `data/rubric.txt` (Part 7 JSON plus the full text). It is safe to re-run.

**Option A: SQL editor (simplest).** Open Supabase → SQL Editor → New query, paste the contents of `supabase/migrations/0001_init.sql`, and click Run.

**Option B: Supabase CLI.**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Check it worked: `select role, version, jsonb_array_length(criteria) from rubrics;` should return PM and SPM with 5 criteria each.

If the rubric changes, edit `data/rubric.txt` and run `npm run db:migration` to regenerate the SQL.

> Security note: the migration adds RLS policies that let the anon key read and write these tables, because the brief specifies the anon key. That key is only used on the server here, but anyone who obtains it can read candidate PII. For real use, switch the server to a service-role key and drop those policies.

### Run locally

```bash
npm run dev      # http://localhost:3000
npm run build    # production build check
```

## Deploy to Vercel

1. Push to GitHub (check `git ls-files | grep env` shows only `.env.example`).
2. Vercel → Add New → Project → import the repo (framework auto-detected as Next.js).
3. Settings → Environment Variables: add every variable from the table above.
4. Deploy. Redeploy after changing environment variables.

Each CV is processed in its own request (up to 300 s, with backoff on Gemini rate limits), so large batches don't hit function time limits. Files must be under 4 MB, which is Vercel's request body limit.

## Project layout

```
app/page.tsx                    Upload
app/dashboard/page.tsx          Ranked PM / SPM tabs with band dividers
app/candidates/[id]/page.tsx    Score breakdowns, brief, email editor
app/api/...                     extract-name, candidates, rescore, refresh, tasks, emails
lib/pii.ts                      Regex PII extraction + redaction (no AI)
lib/scoring.ts                  Gemini scoring prompt + zod validation
lib/scoring-math.ts             Weighted total, bands, top/weakest criteria
lib/ranking.ts                  Top-5 logic, brief/email task planning
lib/drafts.ts                   Brief and email prompts
lib/send.ts                     Resend, test-mode recipient, [NAME] substitution
supabase/migrations/            Schema + rubric seed (generated)
scripts/build-migration.mjs     Generates the migration from data/rubric.txt
```
