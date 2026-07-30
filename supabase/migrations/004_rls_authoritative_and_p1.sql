-- 004_rls_authoritative_and_p1.sql
--
-- Two jobs in one migration, because they're the same change viewed twice:
--
--  (1) MAKE RLS AUTHORITATIVE (PRD §11 decision D1). Until now every UI page
--      and Server Action used the service-role client, so the policies in 002
--      were a safety net that was never plugged in. The app now drives the UI
--      through the session client, which means the policies below are the real
--      authorization layer and must actually cover the UI's queries.
--
--  (2) P1 closed-loop schema — A3 (candidate identity), A1 (task acceptance),
--      A2 (candidate feedback), A4 (org members). A5 (leaderboard) needs no
--      new tables, only the correct read + an index.
--
-- Fully idempotent: re-running on every deploy is a no-op.

-- ===========================================================================
-- SECURITY FIX — privilege escalation via "users: update self"
-- ===========================================================================
-- The 002 policy was `for update using (id = auth.uid())` with no WITH CHECK.
-- Postgres then reuses USING as the check, which only pins the row's id — the
-- *columns* were free. Any authenticated user could POST straight to PostgREST
-- with the public anon key:
--
--     update users set role='recruiter', org_id='<someone else's org>'
--
-- and instantly read that org's jobs, submissions and evaluations. Role and
-- org are now immutable from the user's own session; promotion happens only on
-- the privileged server path (createOrg / acceptInvite), which uses the
-- service-role client with an explicit in-code check.
--
-- app_user_role()/app_user_org() are SECURITY DEFINER, so reading them inside a
-- policy on `users` does not recurse through RLS. Both are STABLE, so they see
-- the pre-UPDATE snapshot — i.e. the values the row is required to keep.
drop policy if exists "users: update self" on users;
create policy "users: update self" on users for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = app_user_role()
    and org_id is not distinct from app_user_org()
  );

-- ===========================================================================
-- A3 — candidate identity for recruiters
-- ===========================================================================
-- A recruiter could rank candidates but never contact them: the UI only had
-- `candidate_id`. Submitting to an org's task is the candidate's opt-in, so
-- that is exactly the scope of the disclosure — a recruiter may read the user
-- row of someone who has submitted to a task under their own org, and nobody
-- else. (`users` has no policy exposing other columns, and PostgREST only
-- returns what the query selects; the UI selects `email` only.)
drop policy if exists "users: recruiter read own org candidates" on users;
create policy "users: recruiter read own org candidates" on users for select
  using (
    app_user_role() = 'recruiter'
    and exists (
      select 1
      from submissions s
      join tasks t on t.id = s.task_id
      join jobs j on j.id = t.job_id
      where s.candidate_id = users.id
        and j.org_id = app_user_org()
    )
  );

-- ===========================================================================
-- A1 — task acceptance is now persisted
-- ===========================================================================
-- POST /v1/tasks/:id/accept used to validate-and-forget, so "how many people
-- are working on this task" was unanswerable and deadlines had no anchor.
-- One row per (task, candidate); accepting twice is a no-op, not an error.
create table if not exists task_acceptances (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  candidate_id uuid not null references users(id) on delete cascade,
  accepted_at timestamptz not null default now(),
  unique (task_id, candidate_id)
);

create index if not exists task_acceptances_task_id_idx on task_acceptances(task_id);
create index if not exists task_acceptances_candidate_id_idx on task_acceptances(candidate_id);

alter table task_acceptances enable row level security;

drop policy if exists "acceptances: candidate own" on task_acceptances;
create policy "acceptances: candidate own" on task_acceptances for select
  using (candidate_id = auth.uid());
drop policy if exists "acceptances: candidate insert own" on task_acceptances;
create policy "acceptances: candidate insert own" on task_acceptances for insert
  with check (
    candidate_id = auth.uid()
    and exists (
      select 1 from tasks t join jobs j on j.id = t.job_id
      where t.id = task_acceptances.task_id and j.status = 'open')
  );
drop policy if exists "acceptances: recruiter read own org" on task_acceptances;
create policy "acceptances: recruiter read own org" on task_acceptances for select
  using (exists (
    select 1 from tasks t join jobs j on j.id = t.job_id
    where t.id = task_acceptances.task_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()));

-- ===========================================================================
-- A2 — candidate feedback visibility
-- ===========================================================================
-- 002 hard-coded "evaluations are never visible to candidates", which left the
-- candidate with no reason to ever come back. The employer now chooses, per
-- task:
--   none  — nothing (unchanged default, so existing tasks keep their behaviour)
--   score — the overall 0-100 number only
--   full  — score + rationale + per-dimension breakdown
alter table tasks add column if not exists feedback_visibility text not null default 'none';

alter table tasks drop constraint if exists tasks_feedback_visibility_check;
alter table tasks add constraint tasks_feedback_visibility_check
  check (feedback_visibility in ('none', 'score', 'full'));

-- NOTE: candidates deliberately get NO select policy on `evaluations`.
--
-- RLS is row-level, not column-level, so a policy permissive enough to show a
-- score would also expose `output_json` wholesale — the 'score' tier would leak
-- the rationale to anyone who queries PostgREST directly with the anon key
-- instead of using our UI. Redaction therefore happens inside this SECURITY
-- DEFINER function, which is the only candidate-facing read path for
-- evaluations. The UI cannot over-share because the data never leaves here
-- un-redacted.
create or replace function my_feedback()
returns table (
  submission_id uuid,
  task_id uuid,
  visibility text,
  score int,
  rationale text,
  dimensions jsonb,
  ran_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    s.id,
    s.task_id,
    t.feedback_visibility,
    (e.output_json ->> 'score')::int,
    case when t.feedback_visibility = 'full'
         then e.output_json ->> 'rationale' end,
    case when t.feedback_visibility = 'full'
         then e.output_json -> 'dimensions' end,
    e.ran_at
  from submissions s
  join tasks t on t.id = s.task_id
  -- latest completed evaluation for this submission, if any
  join lateral (
    select ev.output_json, ev.ran_at
    from evaluations ev
    where ev.submission_id = s.id and ev.status = 'done'
    order by ev.ran_at desc nulls last
    limit 1
  ) e on true
  where s.candidate_id = auth.uid()
    and t.feedback_visibility in ('score', 'full');
$$;

revoke all on function my_feedback() from public;
grant execute on function my_feedback() to authenticated;

-- ===========================================================================
-- A4 — organization members
-- ===========================================================================
-- createOrg made exactly one person a recruiter and offered no way to add a
-- second, so every org was permanently a team of one. Invites are by email:
-- the invitee signs in with that address and accepts. Acceptance is a role
-- promotion, so it runs on the privileged server path — never from the
-- session client (see the users UPDATE policy above).
create table if not exists org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid references users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one live invite per (org, email); accepted/revoked rows stay as history.
create unique index if not exists org_invites_pending_uniq
  on org_invites (org_id, lower(email)) where status = 'pending';
create index if not exists org_invites_email_idx on org_invites (lower(email));

drop trigger if exists set_updated_at on org_invites;
create trigger set_updated_at before update on org_invites
  for each row execute function set_updated_at();

alter table org_invites enable row level security;

drop policy if exists "invites: recruiter manage own org" on org_invites;
create policy "invites: recruiter manage own org" on org_invites for all
  using (app_user_role() = 'recruiter' and org_id = app_user_org())
  with check (app_user_role() = 'recruiter' and org_id = app_user_org());

-- The invitee reads invites addressed to their own verified email.
drop policy if exists "invites: invitee read own" on org_invites;
create policy "invites: invitee read own" on org_invites for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- ===========================================================================
-- A5 — leaderboard support
-- ===========================================================================
-- Ranking reads "latest done evaluation per submission"; this covers it.
create index if not exists evaluations_submission_done_idx
  on evaluations (submission_id, ran_at desc) where status = 'done';

-- ===========================================================================
-- Grants — required now that the UI runs as anon/authenticated
-- ===========================================================================
-- RLS decides WHICH ROWS; grants decide whether the role may touch the table at
-- all. Under the service-role client this never mattered. Stated explicitly
-- here so the migration is self-contained rather than relying on whatever
-- default privileges a given Supabase project happens to carry.
grant usage on schema public to anon, authenticated;

-- Anonymous visitors may browse open tasks (the /tasks page is public).
grant select on jobs, tasks to anon;

grant select on
  organizations, users, jobs, tasks, submissions, conversation_artifacts,
  rubrics, evaluations, api_keys, task_acceptances, org_invites
  to authenticated;

grant insert on
  jobs, tasks, rubrics, submissions, conversation_artifacts,
  task_acceptances, org_invites
  to authenticated;

grant update on users, jobs, tasks, rubrics, org_invites to authenticated;
grant delete on jobs, tasks, rubrics to authenticated;
