# Architecture (locked)

When you add or change code in this repo, **follow these rules**. They
are not preferences — they are how this template is supposed to work.
Deviating is a bug.

## Stack — pinned

| Concern | Choice | Don't substitute |
|---|---|---|
| Data access | **`@supabase/ssr` + `@supabase/supabase-js`** (PostgREST) | No Drizzle / Prisma / Sequelize / direct `pg` connection. The data layer is `supabase-js` because this template's value-add is the Supabase platform (RLS, realtime, storage, auth). ORM-on-top defeats that — if you need an ORM-driven stack, pair `nextjs-standalone` with `express-postgres` over HTTP. |
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
  dashboard/page.tsx             SSR auth gate via supabase.auth.getUser()
  posts/page.tsx                 RSC list + Server Actions for create / delete
components/
  SignOutButton.tsx              client component (router.refresh after sign-out)
lib/
  supabase/
    server.ts                    createClient() for RSC / Server Actions / route handlers
    client.ts                    createBrowserClient() for client components
    middleware.ts                updateSession() — runs on every request to refresh
                                 the session cookie. Don't override the auth-cookie
                                 defaults from @supabase/ssr.
middleware.ts                    runs lib/supabase/middleware.updateSession on every request
supabase/
  migrations/                    Raw SQL — table DDL + RLS policies. Apply via
                                 `supabase db push`. Schema source of truth.
```

There is no `service/` layer in this template. Server Actions are
small enough that the "controller → service" split would be a
ceremony tax. If you ever grow a complex business operation that
spans multiple tables, add a `lib/services/` folder and move the
logic there — but for the canonical "RSC read + Server Action
create / delete" pattern, inline is fine.

## The 4-step recipe — adding a new resource

1. `supabase/migrations/00X_<thing>.sql` — table + RLS policies. The policies are the authoritative auth check; write them carefully.
2. `supabase db push` to apply.
3. `app/<thing>/page.tsx` — RSC for reads (calls `createClient()`), Server Actions inline for writes. Length-cap inputs before touching the DB.
4. Optional: if the page needs an interactive form, extract a client component (`'use client'`) for the form and pass the Server Action via `action={...}` prop.

The Server Action calls `supabase.auth.getUser()` first, returns early if absent, then performs the query.

## Authorization in detail

```sql
-- Authoritative — in supabase/migrations/
create policy "posts: read for authed users"
  on posts for select using (auth.uid() is not null);

create policy "posts: delete own"
  on posts for delete using (auth.uid() = author_id);
```

```ts
// app/posts/page.tsx — DON'T re-check ownership.
const deletePost = async (formData: FormData) => {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const supabase = await createClient();
  // RLS handles "only the author can delete". 0 rows when not yours
  // is the policy's "no, you can't" — same shape as not-found.
  await supabase.from('posts').delete().eq('id', id);
  revalidatePath('/posts');
};
```

## When to reach for the service-role client

Anywhere you need to bypass RLS for a server-owned operation (cron sweepers, system-only inserts, admin endpoints). Use the `SUPABASE_SERVICE_ROLE_KEY` to build a separate client. Write the in-code auth check **directly above** the admin call.

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

Read `app/posts/page.tsx` + `app/auth/callback/route.ts` — they're the canonical example.
