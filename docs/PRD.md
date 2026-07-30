# powagent — Product Requirements

**Status:** living document · **Last updated:** 2026-07-28

> ## Why this file exists
>
> The code has always referenced this document — `lib/eval.ts` cites "spec §8",
> `lib/ingest.ts` cites "§7 / §9.2", `002_powagent.sql` cites "§6 / §9.5 / §12" —
> but the document itself was never committed. It lived in a chat session and
> vanished with it, leaving eight dangling cross-references and no record of
> what §1–§5, §10 or §11 ever said.
>
> This file closes that gap. §6–§9 and §12 are **reconstructed from the
> implementation** and match it as of migration 004; the section numbers are
> chosen to keep every existing in-code citation valid. §1–§5, §10 and §11 had
> no surviving source, so they record decisions taken on 2026-07-28 and are
> marked **[NEW]**. Anything still undecided is called out as **[OPEN]** rather
> than quietly invented.

---

## §1 Problem [NEW]

Hiring for AI-augmented work is still screening on résumés and live-coding
puzzles, neither of which shows what the job now actually is: framing a problem,
directing an agent, spotting where it went wrong, and shipping the result.

Two failures follow. Employers over-weight credentials and interview
performance, then discover on the job that someone who interviews well directs
an agent badly. Candidates who are genuinely good at this new mode of work have
no way to *show* it — the artefact that proves it (their conversation with the
agent) isn't something any ATS accepts.

## §2 Product [NEW]

powagent is a work-sample hiring platform. An employer publishes a real task
that an AI agent could plausibly help complete, plus a rubric describing what
good looks like. A candidate does the task with their own agent and submits two
things: the deliverable, and the transcript of how they got there. The platform
runs the employer's rubric against both and returns a structured, comparable
score.

The transcript is the product's whole reason to exist. Any platform can collect
a deliverable; powagent evaluates the **process** — and that is also what makes
the output hard to fake, because a good result with an incoherent transcript is
itself a signal.

Three principles the implementation is expected to hold to:

1. **The employer owns the scoring logic.** The platform supplies the runtime
   and the injection defences; it does not inject its own opinion of merit
   (§8). Same task + same rubric + same runtime = defensible comparison.
2. **Evidence is append-only.** A submission's content and a finished
   evaluation are immutable. Re-running a rubric adds a row; it never edits one
   (§10, §12).
3. **Both sides are programmable.** Everything the UI can do, an agent can do
   over the REST API with a scoped key (§6).

## §3 Users [NEW]

| Role | Wants | Success looks like |
|---|---|---|
| **Recruiter** (belongs to an organization) | A ranked shortlist grounded in real work, defensible to a hiring manager | Opens the leaderboard, reads the top three transcripts, emails two of them |
| **Candidate** | To be judged on what they can do, and to learn something either way | Submits in one sitting, sees a score, comes back for a second task |
| **Agent / integrator** | To drive either side programmatically | Runs the full loop with an API key and no browser |

## §4 Scope [NEW]

**In scope (v1):** organizations and recruiters; jobs and tasks; candidate
submissions with transcript; employer-authored rubrics; the evaluation runtime;
candidate ranking; the two-sided REST API; magic-link auth.

**Explicitly out of scope (v1):** interview scheduling, offers, ATS integration,
résumé parsing, candidate sourcing, messaging between the parties (email is the
handoff), payments and billing (§11 O4), non-English rubrics.

## §5 Success metrics [NEW] [OPEN]

Directional targets only — no analytics are instrumented yet, so nothing here is
currently measurable. Instrumenting these is unscheduled work.

- **Employer activation:** org created → first evaluated submission, same week.
- **Candidate completion:** accepted → submitted ≥ 40%.
- **Candidate return:** ≥ 25% of candidates who receive feedback submit a
  second task. (Feedback is the lever — §9.5.)
- **Trust:** recruiters read the transcript on ≥ 50% of top-3 candidates.

## §6 Authentication and authorization

Two independent paths reach the same data, and they are authorized differently.
This split is the single most important thing to understand about the codebase.

**UI path — Supabase Auth session.** Magic-link email sign-in. A
`public.users` row is provisioned by the `on_auth_user_created` trigger,
defaulting to `role='candidate'`. Every page and Server Action uses the session
client (`lib/supabase/server.ts`), so **RLS policies are the authorization**
(§11 D1). Code does not re-check ownership.

*Query filters are not auth checks.* A recruiter query may still say
`.eq('org_id', orgId)` — not to enforce anything, but because the permissive
`jobs/tasks: candidate read open` policies are untargeted and therefore also
match a recruiter. Without the filter a dashboard would list every open job on
the platform. RLS decides what may be read; the filter decides what is asked
for.

**API path — API keys.** `Authorization: Bearer pk_…` or `X-API-Key`. Keys are
random 24-byte values shown exactly once at creation; only a sha256 hash is
stored. There is no Supabase session, so no `auth.uid()` for a policy to act
on: these requests use the service-role client and are authorized entirely by
`lib/guard.ts`, which asserts owner type and scope. `key.ownerId` **is** the
tenant boundary.

Scopes are disjoint by owner type:

| Owner | Scopes |
|---|---|
| candidate | `tasks:read`, `tasks:accept`, `submissions:read`, `submissions:write` |
| org | `jobs:write`, `tasks:write`, `rubrics:write`, `submissions:read`, `evaluations:read`, `evaluations:write` |

**Privileged operations.** A short, closed list of writes that RLS deliberately
forbids a user to perform on themselves — role promotion (`createOrg`,
`acceptInvite`) and API-key writes (`issueKey`, `revokeKey`) — plus the
system-owned evaluation writes. These use the service-role client with an
explicit in-code auth check directly above the call, and are enumerated in
`lib/supabase/service.ts`. That list is the complete set; anything else on a
browser path that "needs" service role is a missing policy.

**Roles.** `candidate` and `recruiter`, one per user. Promotion happens only via
`createOrg` or by accepting an invite (§9.6). A user cannot self-promote: the
`users: update self` policy pins `role` and `org_id` to their existing values.

> **Incident, 2026-07-28.** The original policy was `for update using (id =
> auth.uid())` with no `WITH CHECK`. Postgres then reuses `USING` as the check,
> which pins only the row's id — the *columns* were unconstrained. Any signed-in
> user could `update users set role='recruiter', org_id='<any org>'` straight
> from the browser with the public anon key and immediately read that org's
> jobs, submissions and evaluations. Confirmed exploitable against dev, fixed in
> migration 004, and re-confirmed blocked. Any future policy that grants UPDATE
> must state an explicit `WITH CHECK`.

## §7 Conversation ingest

A submission carries a transcript in one of two forms:

- `markdown` — pasted verbatim. Canonical, always succeeds.
- `url` — a public share link the server fetches and converts to text.

**The submission is written before ingest is attempted, and ingest failure never
blocks it.** A dead link degrades to `fetch_status='failed'` on the artifact
row; the candidate's work is still recorded. This is why
`conversation_artifacts` is a separate table rather than columns on
`submissions`.

URL fetching is a deliberate SSRF surface, so it is constrained (§9.2):
https-only; DNS-resolved and checked against private, loopback, link-local,
CGNAT and cloud-metadata ranges; redirects followed manually so every hop is
re-vetted; 8s timeout; 512 KB cap.

**Known residual risk:** a DNS-rebind TOCTOU window exists between the
`lookup()` and `fetch()`'s own resolution. Accepted for now; the fix is to pin
the socket to the vetted IP or route egress through an allowlist proxy.

## §8 Evaluation runtime

The core capability. Input is the task brief, the candidate's result, the
transcript, and the employer's rubric. Output is a fixed JSON shape:

```json
{ "score": 0-100, "dimensions": [{ "name": "", "score": 0-100, "comment": "" }],
  "rationale": "", "flags": [] }
```

Model: Anthropic `claude-sonnet-5` by default, called over plain `fetch` (no SDK
dependency). Requires `ANTHROPIC_API_KEY`; absent, evaluation fails cleanly with
502 and records `status='error'`.

**The platform supplies the runtime, not the criteria.** The rubric's
`prompt_md` is the employer's scoring logic, passed through.

Failure handling: one retry on JSON parse/validation failure with a stricter
reminder; no retry on transport/API errors. Scores are clamped to 0–100. On
unrecoverable failure the evaluation row goes to `status='error'` and the
submission reverts to `submitted`.

**Known limitation (§11 O2):** `dimensions[]` is whatever the model emits, so
two candidates can be scored on differently-named dimensions. Cross-candidate
comparison is therefore weaker than the marketing claim of "the same weighted
dimensions". `rubrics.schema_json` exists to fix this — employer-declared
dimensions with weights, total computed server-side rather than trusted from the
model — and is currently **unused**.

## §9 Functional requirements

### §9.1 Prompt-injection defence

Candidate-supplied content is hostile input by default. The runtime wraps it in
explicit `<candidate_result>` / `<candidate_transcript>` sentinels; the system
prompt declares everything inside them untrusted data whose instructions must
never be followed; sentinel-shaped strings in candidate text are neutralized so
they cannot break out; and output is constrained to a fixed JSON schema so a
score cannot be talked into existence. A detected attempt must be recorded in
`flags` and treated as a negative signal, not silently ignored.

### §9.2 SSRF defence
See §7.

### §9.3 Key handling
Raw keys are shown once and never recoverable. Storage is sha256 only.
Revocation is immediate (`revoked_at`), checked on every authentication.

### §9.4 Rate limiting
Candidate submissions via the API are limited (20 per 10 min).

**Known limitation:** the limiter is a per-process in-memory map, so on Vercel
serverless each cold instance carries its own window and the effective limit is
much weaker than stated. The UI submission path has no limit at all. A real
global limit needs a shared counter (Postgres or Upstash); call sites depend
only on `rateLimit()`'s boolean, so the swap is local.

### §9.5 Candidate feedback [NEW]

Originally "evaluations are never visible to candidates", which left the
candidate with nothing to come back for. Now the employer chooses per task via
`tasks.feedback_visibility`:

| Value | Candidate sees |
|---|---|
| `none` (default) | nothing — preserves prior behaviour for existing tasks |
| `score` | the overall 0–100 number only |
| `full` | score + rationale + per-dimension breakdown |

**Enforced in the database, not the UI.** RLS is row-level, so any policy
permissive enough to expose a score would expose `output_json` wholesale, and
the `score` tier would leak the rationale to anyone querying PostgREST directly
with the anon key. Candidates therefore have **no** select policy on
`evaluations`; their only read path is the `my_feedback()` security-definer
function, which redacts by tier and returns the **latest** `done` evaluation per
submission.

### §9.6 Organizations and membership [NEW]

`createOrg` creates an organization and promotes its creator to recruiter. A
recruiter invites teammates by email (`org_invites`); the invitee signs in with
that address, sees the invitation in Settings, and accepts. Acceptance is a role
promotion and therefore runs on the privileged path, authorized by matching the
invite's email against the caller's own verified email.

**[OPEN]** There is one membership tier — every member is a full recruiter.
No owner/member distinction, no removal flow, and accepting an invite while
already in another org silently moves the user. Revisit when a customer has
more than a handful of seats.

### §9.7 Task acceptance [NEW]

Accepting a task is persisted (`task_acceptances`, unique per task+candidate,
idempotent). It answers "how many candidates are working on this?" before any
submission lands, and gives the funnel a first step.

**[OPEN]** Deadlines are absolute (`deadline_at`), not "N hours from
acceptance". Now that acceptance has a timestamp, relative deadlines are
possible but not implemented.

### §9.8 Ranking [NEW]

A leaderboard ranks **candidates**, not evaluation rows, under two rules:

1. A submission's score is its **latest `done` evaluation**. Evaluations are
   append-only, so a re-run adds a row and the most recent one is the current
   verdict. Rows that are queued, running or errored have no score and are
   **excluded**, not sorted as zero.
2. A candidate's score is their **best submission**, since multiple attempts are
   an allowed part of the task.

Both rules live in `lib/leaderboard.ts` and are shared by the UI and the API.

> **Bug this replaces.** `GET /v1/evaluations` used to sort every evaluation row
> for a task by score. A candidate whose submission had been evaluated three
> times occupied three positions, and errored rows (score defaulted to `-1`)
> were ranked below legitimate zeros. The UI had a second, differently-wrong
> ordering that surfaced a candidate's *highest historical* score rather than
> their current one. Sharing one module is the point, not an incidental tidy-up.

### §9.9 Enforcement gaps [OPEN]

Known and deliberately unclosed as of this revision:

- `deadline_at` is displayed but **never enforced** — a past-deadline task still
  accepts submissions on both paths.
- `max_submissions_per_candidate` is enforced on the **API path only**; the UI
  Server Action does not check it, so the cap is bypassable from a browser.
- `agent_allowed` is stored and never read; its semantics are undefined.
- API-key scopes cannot be chosen at issue time — every key gets its owner
  type's full set, which makes the scope system decorative in practice.

## §10 Data model

Nine product tables: `organizations`, `users`, `jobs`, `tasks`, `submissions`,
`conversation_artifacts`, `rubrics`, `evaluations`, `api_keys`, plus
`task_acceptances` and `org_invites` (§9.6, §9.7).

**Immutability contract.** A submission's `result_md`, `task_id`,
`candidate_id` and `submitted_at` cannot change after insert; only `status`
moves. A `done` evaluation is frozen entirely. Both are enforced by triggers,
not convention. Both carry a generated `content_hash` (§12).

**[OPEN] §10.1 Right to erasure.** Append-only immutability is in direct
tension with a candidate's request to delete their data. There is no deletion
path, and the triggers would block one. Needs a designed answer (tombstoning
with hash preservation is the likely shape) before this handles real applicants
at scale.

Legacy: `posts` (template leftover, unused — safe to drop) and `pipeline_smoke`
(deploy verification, not product data).

## §11 Architecture decisions [NEW]

**D1 — RLS is authoritative on the UI path.** *Decided 2026-07-28.*
Every page and Server Action previously used the service-role client, so the
carefully-written policies were a safety net that was never plugged in — one
forgotten `.eq('org_id', …)` away from cross-tenant disclosure, with no second
line of defence. The UI now runs on the session client; service role is confined
to the API path and the enumerated privileged operations (§6). The alternative —
keeping service role and documenting `requireOrg()` as the boundary — was
rejected because it leaves correctness dependent on remembering a filter in
every future query.

**D2 — Identity is revealed on submission.** Recruiters see a candidate's email
once that candidate has submitted to one of their org's tasks, and not before.
Submitting is the opt-in. Without this a recruiter could rank candidates and
then have no way to contact them.
**[OPEN]** Blind review (score first, reveal after) is a plausible later
refinement and is deliberately not implemented.

**O1 — Evaluation is synchronous.** *Unresolved.* The Anthropic call runs inside
the request. Vercel's function timeout (10s Hobby / 60s Pro) makes this fragile,
there is no batch evaluation and no retry after failure. The fix is a queue —
insert `queued`, drain from a Cron or Edge Function, poll or subscribe from the
UI — and it is not scheduled.

**O2 — Rubrics are unstructured.** See §8.

**O3 — No notifications.** Nothing is emailed on submission or on evaluation
completion; both sides must poll the UI.

**O4 — Cost and quota are undefined.** Every evaluation spends Anthropic
credits. There is no metering, no per-org quota and no billing. Unbounded from a
single org key.

**O5 — No tests.** No test suite and no `test` script. Verification to date is
manual plus SQL-level policy checks run against dev.

## §12 Content hashes and future attestation

`submissions.content_hash` and `evaluations.content_hash` are generated columns
(sha256 over the immutable content). Together with the append-only triggers,
they make a submission and its verdict independently checkable after the fact.

**[OPEN]** The original spec anticipated publishing these hashes for third-party
attestation. No chain, no publication mechanism and no requirement has been
defined — the hashes are groundwork, nothing more. Do not describe the product
as offering verifiable credentials until this section says how.

---

## Appendix — surface inventory

**Pages:** `/` · `/login` · `/auth/callback` · `/dashboard` · `/tasks` ·
`/settings` · `/recruiter` · `/recruiter/tasks/[id]` ·
`/recruiter/tasks/[id]/leaderboard`

**REST API** (`/api/v1`) — org keys:

| Method | Path | Scope |
|---|---|---|
| POST / GET | `/jobs` | `jobs:write` |
| POST | `/jobs/:id/tasks` | `tasks:write` |
| POST / GET | `/rubrics` | `rubrics:write` |
| GET | `/tasks/:id/submissions` | `submissions:read` |
| POST | `/submissions/:id/evaluate` | `evaluations:write` |
| GET | `/evaluations?task_id=` | `evaluations:read` |

Candidate keys:

| Method | Path | Scope |
|---|---|---|
| GET | `/tasks` | `tasks:read` |
| POST | `/tasks/:id/accept` | `tasks:accept` |
| POST / GET | `/submissions` | `submissions:write` / `:read` |

`GET /evaluations` returns `{ ranking, evaluations }` — `ranking` is the
per-candidate leaderboard (§9.8); `evaluations` is every row, newest first, for
status polling.

**Migrations:** `001_posts` (legacy) · `002_powagent` (schema + RLS) ·
`003_pipeline_smoke` (deploy check) · `004_rls_authoritative_and_p1` (§6
security fix, §9.5–§9.8).
