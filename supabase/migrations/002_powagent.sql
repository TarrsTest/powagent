-- powagent MVP schema — AI work-sample hiring platform.
-- Two-sided: organizations/recruiters publish jobs+tasks+rubrics;
-- candidates submit result_md + agent conversation transcript;
-- the eval runtime scores a submission against a rubric.
--
-- Apply via `supabase db push` (staging/live run it automatically at deploy).
--
-- Design notes baked in here:
--  * submissions & evaluations are APPEND-ONLY on their content (see the
--    immutability triggers) so a stable content_hash can later be put on-chain
--    (spec §12). Status columns are the only mutable part.
--  * RLS below secures the Supabase-Auth UI path (recruiters see their org,
--    candidates see open tasks + own submissions). The programmatic REST API
--    uses the service-role client and enforces api_key scope in app code
--    (spec §6) — that path bypasses RLS by design.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Role / org of the currently-authenticated Supabase user (used by RLS).
-- plpgsql (not sql) so the body isn't validated against public.users at
-- creation time — the table is created further down in this same migration.
create or replace function app_user_role() returns text
language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  select role into r from public.users where id = auth.uid();
  return r;
end;
$$;

create or replace function app_user_org() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare o uuid;
begin
  select org_id into o from public.users where id = auth.uid();
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- users — mirrors auth.users, adds role + org. One table, role-discriminated.
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid references organizations(id) on delete set null,
  role text not null default 'candidate' check (role in ('recruiter','candidate')),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-provision a users row on Supabase signup (magic-link).
-- Defaults to candidate; app promotes to recruiter + assigns org later.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- jobs / tasks
-- ---------------------------------------------------------------------------

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  title text not null,
  brief_md text not null,
  agent_allowed boolean not null default true,
  max_submissions_per_candidate int,
  deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_job_id_idx on tasks(job_id);

-- ---------------------------------------------------------------------------
-- submissions — candidate's task output. Content is immutable (append-only).
-- ---------------------------------------------------------------------------

create table submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  candidate_id uuid not null references users(id) on delete cascade,
  result_md text not null,
  status text not null default 'submitted'
    check (status in ('submitted','evaluating','evaluated','rejected')),
  submitted_at timestamptz not null default now(),
  -- stable hash of the immutable content, for future on-chain attestation
  content_hash text generated always as (
    encode(digest(coalesce(result_md, ''), 'sha256'), 'hex')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index submissions_task_id_idx on submissions(task_id);
create index submissions_candidate_id_idx on submissions(candidate_id);

-- Block mutation of content fields after insert; status/updated_at may change.
create or replace function submissions_content_immutable() returns trigger
language plpgsql as $$
begin
  if new.result_md is distinct from old.result_md
     or new.task_id is distinct from old.task_id
     or new.candidate_id is distinct from old.candidate_id
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'submissions are append-only: content fields are immutable (create a new submission instead)';
  end if;
  return new;
end;
$$;

create trigger submissions_immutable
  before update on submissions
  for each row execute function submissions_content_immutable();

-- ---------------------------------------------------------------------------
-- conversation_artifacts — normalized agent transcript for a submission.
-- Stored separately so async/failed url ingest never blocks the submission.
-- ---------------------------------------------------------------------------

create table conversation_artifacts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  source_type text not null check (source_type in ('url','markdown')),
  source_url text,
  raw_md text,
  fetch_status text not null default 'pending'
    check (fetch_status in ('pending','ok','failed')),
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversation_artifacts_submission_id_idx
  on conversation_artifacts(submission_id);

-- ---------------------------------------------------------------------------
-- rubrics — HR-supplied evaluation prompt / scoring criteria.
-- ---------------------------------------------------------------------------

create table rubrics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  prompt_md text not null,
  schema_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rubrics_org_id_idx on rubrics(org_id);

-- ---------------------------------------------------------------------------
-- evaluations — result of one rubric applied to one submission. Append-only:
-- a finished (done) evaluation is frozen; re-evaluating creates a new row.
-- ---------------------------------------------------------------------------

create table evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  rubric_id uuid not null references rubrics(id) on delete cascade,
  model text,
  output_json jsonb,
  status text not null default 'queued'
    check (status in ('queued','running','done','error')),
  error text,
  ran_at timestamptz,
  content_hash text generated always as (
    encode(digest(coalesce(output_json::text, ''), 'sha256'), 'hex')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index evaluations_submission_id_idx on evaluations(submission_id);
create index evaluations_rubric_id_idx on evaluations(rubric_id);

-- A 'done' evaluation is frozen. Status may still move queued->running->done/error.
create or replace function evaluations_freeze_when_done() returns trigger
language plpgsql as $$
begin
  if old.status = 'done' then
    raise exception 'evaluations are append-only: a done evaluation is immutable (create a new evaluation instead)';
  end if;
  return new;
end;
$$;

create trigger evaluations_immutable
  before update on evaluations
  for each row execute function evaluations_freeze_when_done();

-- ---------------------------------------------------------------------------
-- api_keys — hashed keys for the two-sided REST API. Never store plaintext.
-- ---------------------------------------------------------------------------

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('candidate','org')),
  owner_id uuid not null,               -- users.id (candidate) or organizations.id (org)
  key_hash text not null unique,        -- sha256 of the raw key
  key_prefix text not null,             -- first chars, shown in UI for identification
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index api_keys_owner_idx on api_keys(owner_type, owner_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (all tables)
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger set_updated_at before update on jobs
  for each row execute function set_updated_at();
create trigger set_updated_at before update on tasks
  for each row execute function set_updated_at();
create trigger set_updated_at before update on submissions
  for each row execute function set_updated_at();
create trigger set_updated_at before update on conversation_artifacts
  for each row execute function set_updated_at();
create trigger set_updated_at before update on rubrics
  for each row execute function set_updated_at();
create trigger set_updated_at before update on evaluations
  for each row execute function set_updated_at();
create trigger set_updated_at before update on api_keys
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — Supabase-Auth UI path. (REST API uses service role.)
-- ---------------------------------------------------------------------------

alter table organizations         enable row level security;
alter table users                 enable row level security;
alter table jobs                  enable row level security;
alter table tasks                 enable row level security;
alter table submissions           enable row level security;
alter table conversation_artifacts enable row level security;
alter table rubrics               enable row level security;
alter table evaluations           enable row level security;
alter table api_keys              enable row level security;

-- organizations: members read their own org.
create policy "org: read own" on organizations for select
  using (id = app_user_org());

-- users: read self; recruiters read members of their org.
create policy "users: read self" on users for select
  using (id = auth.uid()
         or (app_user_role() = 'recruiter' and org_id = app_user_org()));
create policy "users: update self" on users for update
  using (id = auth.uid());

-- jobs: recruiters manage their org's jobs; candidates read open jobs.
create policy "jobs: recruiter manage own org" on jobs for all
  using (app_user_role() = 'recruiter' and org_id = app_user_org())
  with check (app_user_role() = 'recruiter' and org_id = app_user_org());
create policy "jobs: candidate read open" on jobs for select
  using (status = 'open');

-- tasks: recruiters manage tasks under their org's jobs; candidates read tasks
-- of open jobs.
create policy "tasks: recruiter manage own org" on tasks for all
  using (exists (
    select 1 from jobs j
    where j.id = tasks.job_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()))
  with check (exists (
    select 1 from jobs j
    where j.id = tasks.job_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()));
create policy "tasks: candidate read open" on tasks for select
  using (exists (
    select 1 from jobs j where j.id = tasks.job_id and j.status = 'open'));

-- submissions: candidates read/insert their own; recruiters read submissions
-- for tasks under their org.
create policy "submissions: candidate read own" on submissions for select
  using (candidate_id = auth.uid());
create policy "submissions: candidate insert own" on submissions for insert
  with check (candidate_id = auth.uid());
create policy "submissions: recruiter read own org" on submissions for select
  using (exists (
    select 1 from tasks t join jobs j on j.id = t.job_id
    where t.id = submissions.task_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()));

-- conversation_artifacts: visibility follows the parent submission.
create policy "artifacts: candidate own" on conversation_artifacts for all
  using (exists (
    select 1 from submissions s
    where s.id = conversation_artifacts.submission_id
      and s.candidate_id = auth.uid()))
  with check (exists (
    select 1 from submissions s
    where s.id = conversation_artifacts.submission_id
      and s.candidate_id = auth.uid()));
create policy "artifacts: recruiter read own org" on conversation_artifacts for select
  using (exists (
    select 1 from submissions s
    join tasks t on t.id = s.task_id
    join jobs j on j.id = t.job_id
    where s.id = conversation_artifacts.submission_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()));

-- rubrics: recruiters manage their org's rubrics.
create policy "rubrics: recruiter manage own org" on rubrics for all
  using (app_user_role() = 'recruiter' and org_id = app_user_org())
  with check (app_user_role() = 'recruiter' and org_id = app_user_org());

-- evaluations: recruiters of the owning org read (default: not visible to
-- candidates — spec §9.5). Writes go through the service-role API path.
create policy "evaluations: recruiter read own org" on evaluations for select
  using (exists (
    select 1 from submissions s
    join tasks t on t.id = s.task_id
    join jobs j on j.id = t.job_id
    where s.id = evaluations.submission_id
      and app_user_role() = 'recruiter' and j.org_id = app_user_org()));

-- api_keys: owner reads their own key metadata (never the raw key — not stored).
create policy "api_keys: candidate own" on api_keys for select
  using (owner_type = 'candidate' and owner_id = auth.uid());
create policy "api_keys: org own" on api_keys for select
  using (owner_type = 'org' and owner_id = app_user_org()
         and app_user_role() = 'recruiter');
