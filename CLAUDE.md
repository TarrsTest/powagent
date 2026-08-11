# Architecture (locked)

When you add or change code in this repo, **follow these rules**. They
are not preferences — they are how powagent is built. Deviating is a bug.

Product requirements, open questions and architecture decisions live in
[`docs/PRD.md`](docs/PRD.md); the `spec §N` citations in the code point at its
sections.

## Stack — pinned

| Concern | Choice | Don't substitute |
|---|---|---|
| Data access | **`@supabase/ssr` + `@supabase/supabase-js`** (PostgREST) | No Drizzle / Prisma / Sequelize / direct `pg` connection. The data layer is `supabase-js` because this product's authorization model *is* the Supabase platform — RLS is the auth check (PRD §11 D1), and an ORM on top would route around the policies that enforce it. |
| Authorization | **RLS policies in `supabase/migrations/`** | Do NOT add `if (post.author_id === user.id)` checks in Server Action / RSC code. The policy is the source of truth; an in-code duplicate drifts the day the policy changes. (UI nicety like hiding a delete button for non-authors is fine — actual enforcement is the policy.) |
| Auth | Supabase Auth (magic-link out of the box) via `@supabase/ssr` | Don't add NextAuth / Clerk / Auth.js / a custom bcrypt+JWT stack — if you need that pattern, pair `nextjs-standalone` with `express-postgres`. |
| Migrations | `supabase/migrations/*.sql` via Supabase CLI | No Alembic / Sequelize / dbmate. |
| Validation | Length-cap inline in Server Actions (`String(formData.get(...)).slice(0, 200)`) | Add Zod if a resource gets complex; current scale doesn't justify the dep weight. |
| Mutation surface | **Server Actions only** | Don't add `app/api/*` route handlers for mutations the form-action shape already covers. Add a route handler only when an external service needs to webhook you. |
| Reads | **React Server Components calling `createClient()`** from `lib/supabase/server.ts` | Don't fetch via the browser client + a useEffect — RSC is the canonical pattern, and SSR avoids the FOUC. |
| Cookie security | `@supabase/ssr` defaults: httpOnly, secure (prod), sameSite='lax' | Don't override these in `setAll` — losing httpOnly puts the JWT in reach of any XSS. |

## Folder layout — what each layer is for

```
app/
  layout.tsx
  page.tsx                       landing (RSC checks user via createClient)
  login/page.tsx                 magic-link sign-in (calls supabase.auth.signInWithOtp)
  auth/callback/route.ts         exchanges code -> session, validates `next`
                                 against open-redirect (anything that isn't a
                                 single-leading-slash relative path is rejected)
  dashboard/page.tsx             SSR auth gate, routes by role
  tasks/                         candidate: browse open tasks, accept, submit
    page.tsx  actions.ts
  recruiter/                     recruiter: jobs, tasks, rubrics, evaluation
    page.tsx  actions.ts
    tasks/[id]/page.tsx          submissions + transcripts for one task
    tasks/[id]/leaderboard/page.tsx   ranked candidates
  settings/                      org onboarding, team invites, API keys
    page.tsx  actions.ts  IssueKeyForm.tsx
  api/v1/                        two-sided REST API — API-key auth, NOT sessions
components/
  Brand.tsx  SignOutButton.tsx
lib/
  eval.ts                        evaluation runtime + injection defence (PRD §8, §9.1)
  evaluateSubmission.ts          shared orchestration — UI and API both call this
  ingest.ts                      transcript ingest + SSRF guards (§7, §9.2)
  leaderboard.ts                 ranking rules, shared by UI and API (§9.8)
  submissionRules.ts             deadline + submission-cap predicates (§9.9)
  apikey.ts  guard.ts            API-key issue / authenticate / scope check (§6)
  http.ts  ratelimit.ts  profile.ts
  supabase/
    server.ts                    createClient() for RSC / Server Actions / route handlers
    client.ts                    createBrowserClient() for client components
    service.ts                   service-role client — BYPASSES RLS, see below
    middleware.ts                updateSession() — runs on every request to refresh
                                 the session cookie. Don't override the auth-cookie
                                 defaults from @supabase/ssr.
middleware.ts                    runs lib/supabase/middleware.updateSession on every request
supabase/
  migrations/                    Raw SQL — table DDL + RLS policies. Schema source
                                 of truth. Replayed IN FULL on every deploy (there
                                 is no ledger), so every one must be idempotent.
test/                            node:test, no runner dep — `pnpm test`
docs/PRD.md                      product requirements; the `spec §N` citations
                                 in the code point at its sections
```

Logic that more than one entry point needs lives in `lib/` as a plain module —
`evaluateSubmission.ts`, `leaderboard.ts` and `submissionRules.ts` exist because
the UI and the REST API must behave identically, and they previously drifted.
Anything used from exactly one page still belongs inline in that page's
`actions.ts`; don't add a layer for a single caller.

## The 4-step recipe — adding a new resource

1. `supabase/migrations/00X_<thing>.sql` — table + RLS policies. The policies are the authoritative auth check; write them carefully.
2. `supabase db push` to apply.
3. `app/<thing>/page.tsx` — RSC for reads (calls `createClient()`), Server Actions inline for writes. Length-cap inputs before touching the DB.
4. Optional: if the page needs an interactive form, extract a client component (`'use client'`) for the form and pass the Server Action via `action={...}` prop.

The Server Action calls `supabase.auth.getUser()` first, returns early if absent, then performs the query.

## Authorization in detail

```sql
-- Authoritative — in supabase/migrations/
create policy "submissions: candidate insert own" on submissions for insert
  with check (candidate_id = auth.uid());

create policy "submissions: recruiter read own org" on submissions for select
  using (exists (
    select 1 from tasks t join jobs j on j.id = t.job_id
    where t.id = submissions.task_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()));
```

```ts
// app/tasks/actions.ts — DON'T re-check ownership.
const supabase = await createClient();
// The insert policy pins candidate_id to auth.uid(); a forged candidate_id is
// rejected by Postgres, not by an if-statement here. 0 rows when it isn't
// yours is the policy saying "no" — same shape as not-found.
await supabase.from('submissions').insert({ task_id: taskId, candidate_id: user.id, result_md });
```

Every UPDATE policy must state an explicit `WITH CHECK`. Without one Postgres
reuses `USING`, which pins the row but not its columns — exactly how
`users: update self` once let any user make themselves a recruiter in any
organization (PRD §6).

## When to reach for the service-role client

Only for operations RLS deliberately forbids a user to perform on themselves —
role promotion and API-key writes — plus system-owned writes, and the API-key
request path which has no session for a policy to act on. The complete list is
enumerated in `lib/supabase/service.ts`; write the in-code auth check **directly
above** the privileged call. If a browser-path query "needs" service role to
work, the missing piece is a policy.

## What NOT to do

- ❌ Don't add Drizzle / Prisma / Sequelize — use `supabase-js`.
- ❌ Don't re-check ownership in Server Actions or RSC code — RLS owns it.
- ❌ Don't fetch in `useEffect` for data that's known at request time — use RSC.
- ❌ Don't add NextAuth / Clerk — use Supabase Auth.
- ❌ Don't add `app/api/foo/route.ts` for mutations a Server Action already covers.
- ❌ Don't override the auth-cookie defaults in `setAll` (httpOnly / secure / sameSite).
- ❌ Don't use the browser client (`createBrowserClient`) for sensitive operations — use the server client from RSC.
- ❌ Don't accept `next` query params on `/auth/callback` without the `isSafeNext` check — open-redirect is real.
- ❌ Don't hand-write a `pnpm-workspace.yaml` / `allowBuilds:` block to silence pnpm's "Ignored build scripts" warning. Native-build approval is already declared in `package.json` → `pnpm.onlyBuiltDependencies` (`sharp`, `unrs-resolver`). If you add another dep with a build script, append its name to that array — don't improvise a workspace file.

## powagent: the two authorization paths

This product adds a second, deliberate exception to the "Server Actions only"
rule above: a two-sided REST API under `app/api/v1/*` so agents can drive both
sides programmatically. It is a product feature, not drift. The two paths are
authorized differently and must not be mixed up:

| Path | Client | Authorization |
|---|---|---|
| UI — pages, Server Actions | `lib/supabase/server.ts` (session) | **RLS policies** |
| REST API — `app/api/v1/*` | `lib/supabase/service.ts` (service role) | API-key scope in `lib/guard.ts` |

**Do not use the service-role client on a browser path.** Until 2026-07-28 every
page and Server Action did, which meant the RLS policies were never actually in
force. The only permitted service-role callers on a browser path are the
privileged operations enumerated in `lib/supabase/service.ts` — role promotion
and API-key writes, things RLS deliberately forbids a user to do to themselves —
each with an explicit auth check directly above the call. If a query "needs"
service role to work, the missing piece is a policy.

**A scoping filter is not an ownership re-check.** `jobs/tasks: candidate read
open` are permissive and untargeted, so they match recruiters too, and permissive
policies OR together. A recruiter query therefore still needs `.eq('org_id', …)`
— not to enforce anything, but to say which rows it wants. Omitting it lists
every open job on the platform.

**Every UPDATE policy needs an explicit `WITH CHECK`.** Without one Postgres
reuses `USING`, which pins the row but not its columns. That is exactly how
`users: update self` allowed any user to make themselves a recruiter in any
organization (see `docs/PRD.md` §6).

Product requirements, open questions and architecture decisions live in
`docs/PRD.md`. The `spec §N` citations in the code refer to its sections.

## What to do when in doubt

Read `app/tasks/actions.ts` (session client + RLS-as-authorization, the canonical
write path) and `app/api/v1/submissions/route.ts` (the API-key path, with scope
as the tenant boundary). `lib/evaluateSubmission.ts` shows how a single piece of
logic serves both.

Before changing behaviour, check `docs/PRD.md` — §9.9 and §11 list what is
knowingly unfinished, so you can tell a real gap from a deliberate one.

Run `pnpm typecheck && pnpm test && pnpm lint` before you call something done.
