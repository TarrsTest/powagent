# powagent

**A work-sample hiring platform for AI-augmented work.**

Hiring still screens on résumés and live-coding puzzles, neither of which shows
what the job now actually is: framing a problem, directing an agent, spotting
where it went wrong, and shipping the result.

powagent turns that into evidence. An employer publishes a real task an AI agent
could plausibly help complete, plus a rubric describing what good looks like. A
candidate does the task with their own agent and submits **two** things: the
deliverable, and the transcript of how they got there. The platform runs the
employer's rubric against both and returns a structured, comparable score.

The transcript is the whole point. Any platform can collect a deliverable;
powagent evaluates the **process** — which is also what makes the result hard to
fake, because a good answer with an incoherent transcript is itself a signal.

Three principles the implementation holds to:

1. **The employer owns the scoring logic.** The platform supplies the runtime and
   the prompt-injection defences; it does not inject its own opinion of merit.
2. **Evidence is append-only.** A submission's content and a finished evaluation
   are immutable, enforced by database triggers. Re-running a rubric adds a row;
   it never edits one.
3. **Both sides are programmable.** Everything the UI can do, an agent can do
   over the REST API with a scoped key.

Full product requirements, open questions and architecture decisions:
[`docs/PRD.md`](docs/PRD.md). The `spec §N` citations in the code refer to its
sections. Binding architecture rules for anyone changing this repo:
[`CLAUDE.md`](CLAUDE.md).

---

## Recruiter workflow

1. **Sign in** — magic link to your email, no password.
2. **Create an organization** (`/settings`). This promotes you to `recruiter`.
   Everything below is scoped to your org.
3. **Invite teammates** (`/settings`) by email. They sign in with that address
   and accept from their own settings page. One tier — every member is a full
   recruiter.
4. **Create a job** (`/recruiter`) and set it to `open` so candidates can see it.
5. **Add tasks** under the job: a title, a markdown brief, and how much
   evaluation feedback the candidate may see (`none` / `score` / `full`).
   Optionally a deadline and a per-candidate submission cap.
6. **Write a rubric** (`/recruiter`) — free-form markdown. This is your scoring
   logic; the platform passes it through rather than overriding it.
7. **Watch uptake** — the dashboard shows how many candidates have accepted each
   task, before any work lands.
8. **Review submissions** (`/recruiter/tasks/<id>`) — deliverable, agent
   transcript, and the candidate's email (revealed once they submit to your task,
   which is their opt-in). Trigger an evaluation against any of your rubrics.
9. **Read the leaderboard** (`/recruiter/tasks/<id>/leaderboard`) — candidates
   ranked by their best submission's latest completed evaluation.

## Candidate workflow

1. **Browse open tasks** (`/tasks`) — no account needed.
2. **Sign in** with a magic link when you want to take one.
3. **Accept a task** so the employer can see you're working on it. Idempotent.
4. **Submit** your deliverable plus your agent transcript — paste the markdown,
   or give a public share URL and the server fetches it. A dead link degrades to
   `fetch_status='failed'`; it never blocks your submission.
5. **Limits are enforced on both entry points** (UI and API): past the deadline,
   or at the per-candidate cap, and the submission is refused with a clear
   reason. See [`lib/submissionRules.ts`](lib/submissionRules.ts).
6. **See your result** if the employer chose to share it — score only, or score
   plus rationale and per-dimension breakdown.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS 4 + FontAwesome Free |
| Data & auth | Supabase — `@supabase/ssr` + `supabase-js` over PostgREST |
| Auth method | Supabase Auth magic link (email OTP) |
| Authorization | Postgres RLS policies (UI) · API-key scopes (REST API) |
| Database | Postgres (Supabase). Schema lives in `supabase/migrations/*.sql` |
| Evaluation | Anthropic Messages API over plain `fetch` — no SDK dependency |
| Tests | Node's built-in test runner (`node --test`) — no test framework |

Deliberately absent: no ORM, no Zod, no NextAuth/Clerk, no Anthropic SDK, no
Jest/Vitest. See `CLAUDE.md` for why each one is a "don't substitute".

**Node 22.18+ is required.** `npm test` runs Node's test runner directly on
`.ts` files, which relies on the type stripping that shipped unflagged in 22.18.

## Two authorization paths

The single most important thing to understand before changing anything:

| Path | Client | Authorization |
|---|---|---|
| UI — pages, Server Actions | `lib/supabase/server.ts` (session) | **RLS policies** |
| REST API — `app/api/v1/*` | `lib/supabase/service.ts` (service role) | API-key scope, `lib/guard.ts` |

The service-role client bypasses RLS. It is confined to the API path plus a
closed list of privileged operations enumerated in `lib/supabase/service.ts`
(role promotion and API-key writes) — things RLS deliberately forbids a user to
do to themselves, each with an explicit in-code check directly above the call.
**If a query on a browser path seems to "need" service role, the missing piece is
a policy.**

Two policy traps, both of which have already caused real bugs:

- **Every UPDATE policy needs an explicit `WITH CHECK`.** Without one Postgres
  reuses `USING`, which pins the row but not its columns. That is how
  `users: update self` once let any signed-in user make themselves a recruiter in
  any organization (PRD §6).
- **A scoping filter is not an ownership re-check.** Permissive policies OR
  together and `jobs/tasks: candidate read open` are untargeted, so they match
  recruiters too. Queries still state *which rows they want* — omitting that is
  how `/tasks` once listed a recruiter's own draft tasks and other candidates'
  submissions.

---

## Local development

```bash
pnpm install
cp .env.example .env    # fill from your Supabase project: Settings → API
pnpm dev                # http://localhost:3000
```

On Tarrs, `.env` is gitignored and persists across sandbox restarts; use
`tarrs-cli db wire` to write the Supabase connection into it rather than pasting
keys by hand.

### Environment variables

Names only — never commit values. Server-only vars must not be exposed to the
client.

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL. Also feeds the CSP `connect-src` in `next.config.ts`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anon key for the session/browser clients. RLS is what protects data behind it. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | RLS-bypassing key for the REST API path and privileged operations. |
| `ANTHROPIC_API_KEY` | **server only** | Powers the evaluation runtime. See below. |
| `DATABASE_URL` | **server only** | Direct Postgres connection. Used for applying migrations and ad-hoc RLS checks, not by the app. |

> **Evaluation currently requires `ANTHROPIC_API_KEY` and it is not set.**
> Without it `lib/eval.ts` throws immediately, `POST /v1/submissions/:id/evaluate`
> returns **502**, the evaluation row is recorded as `status='error'` with the
> message, and the submission reverts to `submitted`. Everything else in the
> product works. Add it as a **secret** in the Tarrs env-vars UI — not in `.env`,
> not in a commit, not in a CI workflow.

### Migrations

`supabase/migrations/*.sql` is the schema source of truth. Every schema change
ships as a migration file — apply it to dev yourself, and staging/live run it
automatically at deploy.

```bash
supabase db push                       # via the Supabase CLI
psql "$DATABASE_URL" -f supabase/migrations/00X_thing.sql   # or directly
```

All migrations are idempotent, so re-running them is a no-op.

| File | Contents |
|---|---|
| `001_posts.sql` | Template leftover. Unused by the product; the `posts` table does not exist in dev. |
| `002_powagent.sql` | Core schema: orgs, users, jobs, tasks, submissions, conversation_artifacts, rubrics, evaluations, api_keys + append-only triggers + RLS. |
| `003_pipeline_smoke.sql` | Deploy-pipeline smoke marker, read back by the `dbcheck` edge function. Not product data. |
| `004_rls_authoritative_and_p1.sql` | Privilege-escalation fix, task acceptances, per-task feedback visibility + `my_feedback()`, org invites, candidate identity for recruiters, grants for `anon`/`authenticated`. |

There is no `supabase_migrations` tracking table in dev — migrations there were
applied by hand. To check whether one is live, query the catalog
(`pg_policies`, `information_schema.columns`) rather than trusting that the file
exists.

Row-level policies are best verified by impersonating a real user:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user-uuid>","email":"a@b.c","role":"authenticated"}';
select * from submissions;   -- exactly what that user's browser would see
rollback;
```

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm test` | Node's test runner over `test/*.test.ts` |
| `pnpm run lint` | ESLint via `next lint`, zero-warning baseline |
| `pnpm run build` | Production build |

All four run in CI (`.github/workflows/ci.yml`) on pushes to `dev` / `staging` /
`main` / `feature|fix|chore/**` and on every PR. CI needs no secrets.

Tests cover the logic where a mistake is silent and expensive — the submission
deadline and cap rules, and the leaderboard ranking rules. RLS and policy
behaviour is verified with the SQL impersonation recipe above, which a unit test
cannot reach.

---

## Project layout

```text
app/
  page.tsx                        landing
  login/page.tsx                  magic-link sign-in
  auth/callback/route.ts          code -> session, `next` validated against open-redirect
  dashboard/page.tsx              role-aware entry point
  tasks/                          candidate: browse, accept, submit, see feedback
    page.tsx  actions.ts  SubmitWorkForm.tsx
  recruiter/                      employer side
    page.tsx  actions.ts          jobs, tasks, rubrics
    tasks/[id]/page.tsx           submissions + trigger evaluation
    tasks/[id]/leaderboard/       ranked candidates
  settings/                       org creation, team invites, API keys
  api/v1/                         two-sided REST API (9 route handlers)
components/                       Brand, SignOutButton
lib/
  supabase/{server,client,middleware,service}.ts
  eval.ts                         evaluation runtime + prompt-injection defence
  ingest.ts                       transcript fetch + SSRF defence
  evaluateSubmission.ts           orchestration shared by UI and API
  leaderboard.ts                  ranking rules shared by UI and API
  submissionRules.ts              deadline + cap rules shared by UI and API
  apikey.ts  guard.ts             key generation, authentication, scope checks
  profile.ts  http.ts  ratelimit.ts
supabase/
  migrations/                     schema source of truth
  functions/                      Deno edge functions (ping/health/echo/dbcheck)
test/                             node --test suites
docs/PRD.md                       product requirements
middleware.ts                     refreshes the session cookie on every request
```

Anything shared by the UI and the API lives in a single `lib/` module on purpose.
`leaderboard.ts` and `submissionRules.ts` both exist because the two paths had
already drifted apart once each.

## REST API

`Authorization: Bearer pk_…` or `X-API-Key`. Keys are shown once at creation and
stored only as a sha256 hash. Scopes are disjoint by owner type.

**Org keys**

| Method | Path | Scope |
|---|---|---|
| POST / GET | `/api/v1/jobs` | `jobs:write` |
| POST | `/api/v1/jobs/:id/tasks` | `tasks:write` |
| POST / GET | `/api/v1/rubrics` | `rubrics:write` |
| GET | `/api/v1/tasks/:id/submissions` | `submissions:read` |
| POST | `/api/v1/submissions/:id/evaluate` | `evaluations:write` |
| GET | `/api/v1/evaluations?task_id=` | `evaluations:read` |

**Candidate keys**

| Method | Path | Scope |
|---|---|---|
| GET | `/api/v1/tasks` | `tasks:read` |
| POST | `/api/v1/tasks/:id/accept` | `tasks:accept` |
| POST / GET | `/api/v1/submissions` | `submissions:write` / `:read` |

`GET /evaluations` returns `{ ranking, evaluations }` — `ranking` is the
per-candidate leaderboard, `evaluations` is every row newest-first for status
polling.

## Deployment

Frontend on **Vercel**, database on **Supabase**. There is no Dockerfile and none
is needed.

Branches map to environments: `dev` is the team's integration branch **and**
Vercel's production branch, so a push to `dev` deploys `powagent.vercel.app`.
Pushing is the whole CI/CD — Tarrs runs the DB migrate step while Vercel rebuilds
the frontend from the same push.

Two things to know before promoting beyond dev:

- `origin/dev` shares **no common ancestor** with `origin/staging` or
  `origin/main` (the repo is a shallow clone whose dev history was rebuilt as an
  orphan commit). A straight merge will not work; this needs deciding before a
  promotion, not during one.
- Runtime secrets are injected by the platform. Never bake them into a build,
  a commit, or a workflow file.
