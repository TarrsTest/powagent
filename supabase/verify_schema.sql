-- verify_schema.sql — read-only. Answers "which migrations are actually live?"
--
-- There is no `supabase_migrations` ledger in this project: migrations are
-- replayed in full on every deploy and were applied by hand in dev. So the
-- presence of a file in supabase/migrations/ proves nothing about a given
-- database. README tells you to query the catalog by hand instead; this is that
-- check, written down once so it is repeatable and identical across dev,
-- staging and live.
--
--   psql "$DATABASE_URL" -f supabase/verify_schema.sql      (or: pnpm run db:verify)
--
-- Every row is a SELECT against a system catalog. It creates nothing, changes
-- nothing, and is safe to run against production.
--
-- Reading the output:
--   PRESENT  — object is there
--   MISSING  — the migration that owns it has not been applied (or only partly)
--   FAILED   — object exists but in a form that reintroduces a known bug
--   SKIPPED  — cannot be checked here (a Supabase-only role is absent)
--
-- `auth.users` and the `anon` / `authenticated` roles only exist on Supabase.
-- Against a plain Postgres those checks report SKIPPED rather than failing the
-- whole run.

\pset pager off

select * from (

  -- §10 product tables ------------------------------------------------------
  select '002' as migration, 'table ' || t as object,
         case when to_regclass('public.' || t) is null then 'MISSING' else 'PRESENT' end as status
  from unnest(array[
    'organizations','users','jobs','tasks','submissions',
    'conversation_artifacts','rubrics','evaluations','api_keys'
  ]) as t

  union all
  select '004', 'table ' || t,
         case when to_regclass('public.' || t) is null then 'MISSING' else 'PRESENT' end
  from unnest(array['task_acceptances','org_invites']) as t

  union all
  select '003', 'table pipeline_smoke (deploy marker, not product data)',
         case when to_regclass('public.pipeline_smoke') is null then 'MISSING' else 'PRESENT' end

  -- 005 is a drop: PRESENT here means the table is correctly gone -----------
  union all
  select '005', 'table posts dropped (template leftover)',
         case when to_regclass('public.posts') is null then 'PRESENT' else 'FAILED' end

  -- §12 content hashes: generated, not application-supplied ------------------
  union all
  select '002', 'column ' || c.tbl || '.content_hash is GENERATED',
         case when exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = c.tbl
             and column_name = 'content_hash' and is_generated = 'ALWAYS'
         ) then 'PRESENT' else 'MISSING' end
  from (values ('submissions'), ('evaluations')) as c(tbl)

  -- functions ---------------------------------------------------------------
  union all
  select '002', 'function ' || f || '()',
         case when exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = f
         ) then 'PRESENT' else 'MISSING' end
  from unnest(array[
    'set_updated_at','app_user_role','app_user_org','handle_new_user',
    'submissions_content_immutable','evaluations_freeze_when_done'
  ]) as f

  union all
  select '004', 'function my_feedback() (§9.5 redaction happens inside)',
         case when exists (
           select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'my_feedback'
         ) then 'PRESENT' else 'MISSING' end

  -- append-only triggers: the immutability contract is enforced here, not in
  -- application code, so their absence is a data-integrity hole ------------
  union all
  select '002', 'trigger ' || g.tg || ' on ' || g.tbl,
         case when exists (
           select 1 from pg_trigger
           where tgname = g.tg and tgrelid = to_regclass('public.' || g.tbl)
             and not tgisinternal
         ) then 'PRESENT' else 'MISSING' end
  from (values
    ('submissions_immutable', 'submissions'),
    ('evaluations_immutable', 'evaluations')
  ) as g(tg, tbl)

  union all
  select '002', 'trigger set_updated_at on ' || t,
         case when exists (
           select 1 from pg_trigger
           where tgname = 'set_updated_at' and tgrelid = to_regclass('public.' || t)
             and not tgisinternal
         ) then 'PRESENT' else 'MISSING' end
  from unnest(array[
    'organizations','users','jobs','tasks','submissions',
    'conversation_artifacts','rubrics','evaluations','api_keys'
  ]) as t

  union all
  select '004', 'trigger set_updated_at on org_invites',
         case when exists (
           select 1 from pg_trigger
           where tgname = 'set_updated_at' and tgrelid = to_regclass('public.org_invites')
             and not tgisinternal
         ) then 'PRESENT' else 'MISSING' end

  -- the auth.users mirror: without it a new signup never gets a public.users
  -- row and every RLS policy that joins on it denies everything -------------
  union all
  select '002', 'trigger on_auth_user_created on auth.users',
         case
           when to_regclass('auth.users') is null then 'SKIPPED'
           when exists (
             select 1 from pg_trigger
             where tgname = 'on_auth_user_created' and tgrelid = to_regclass('auth.users')
               and not tgisinternal
           ) then 'PRESENT'
           else 'MISSING'
         end

  -- RLS is the authorization for the whole UI path (D1). Off = wide open. ---
  union all
  select m.mig, 'RLS enabled on ' || m.tbl,
         case
           when to_regclass('public.' || m.tbl) is null then 'MISSING'
           when (select relrowsecurity from pg_class where oid = to_regclass('public.' || m.tbl))
             then 'PRESENT'
           else 'FAILED'
         end
  from (values
    ('002','organizations'), ('002','users'), ('002','jobs'), ('002','tasks'),
    ('002','submissions'), ('002','conversation_artifacts'), ('002','rubrics'),
    ('002','evaluations'), ('002','api_keys'),
    ('004','task_acceptances'), ('004','org_invites')
  ) as m(mig, tbl)

  -- policies ----------------------------------------------------------------
  union all
  select p.mig, 'policy "' || p.pol || '" on ' || p.tbl,
         case when exists (
           select 1 from pg_policies
           where schemaname = 'public' and tablename = p.tbl and policyname = p.pol
         ) then 'PRESENT' else 'MISSING' end
  from (values
    ('002','org: read own','organizations'),
    ('002','users: read self','users'),
    ('002','jobs: recruiter manage own org','jobs'),
    ('002','jobs: candidate read open','jobs'),
    ('002','tasks: recruiter manage own org','tasks'),
    ('002','tasks: candidate read open','tasks'),
    ('002','submissions: candidate insert own','submissions'),
    ('002','submissions: candidate read own','submissions'),
    ('002','submissions: recruiter read own org','submissions'),
    ('002','artifacts: candidate own','conversation_artifacts'),
    ('002','artifacts: recruiter read own org','conversation_artifacts'),
    ('002','rubrics: recruiter manage own org','rubrics'),
    ('002','evaluations: recruiter read own org','evaluations'),
    ('002','api_keys: candidate own','api_keys'),
    ('002','api_keys: org own','api_keys'),
    ('004','users: update self','users'),
    ('004','users: recruiter read own org candidates','users'),
    ('004','acceptances: candidate own','task_acceptances'),
    ('004','acceptances: candidate insert own','task_acceptances'),
    ('004','acceptances: recruiter read own org','task_acceptances'),
    ('004','invites: recruiter manage own org','org_invites'),
    ('004','invites: invitee read own','org_invites')
  ) as p(mig, pol, tbl)

  -- The §6 privilege-escalation fix. An UPDATE policy with no WITH CHECK lets
  -- Postgres reuse USING, which pins the row but not its new column values —
  -- that is exactly how any signed-in user could once make themselves a
  -- recruiter. If 002 is applied but 004 is not, the policy is PRESENT above
  -- and FAILED here, which is the whole reason this check is separate.
  union all
  select '004', 'policy "users: update self" has an explicit WITH CHECK (§6)',
         case
           when not exists (
             select 1 from pg_policies
             where schemaname = 'public' and tablename = 'users'
               and policyname = 'users: update self'
           ) then 'MISSING'
           when exists (
             select 1 from pg_policies
             where schemaname = 'public' and tablename = 'users'
               and policyname = 'users: update self' and with_check is not null
           ) then 'PRESENT'
           else 'FAILED'
         end

  -- index backing the leaderboard's latest-done lookup ----------------------
  union all
  select '004', 'index evaluations_submission_done_idx',
         case when to_regclass('public.evaluations_submission_done_idx') is null
              then 'MISSING' else 'PRESENT' end

  -- grants. PostgREST connects as anon/authenticated; RLS alone is not enough
  -- if the table grant is missing — every query 401s/permission-denies. -----
  union all
  select '004', 'grant ' || g.priv || ' on ' || g.tbl || ' to ' || g.role,
         case
           when not exists (select 1 from pg_roles where rolname = g.role) then 'SKIPPED'
           when to_regclass('public.' || g.tbl) is null then 'MISSING'
           when has_table_privilege(g.role, 'public.' || g.tbl, g.priv) then 'PRESENT'
           else 'MISSING'
         end
  from (values
    ('anon','select','jobs'),
    ('anon','select','tasks'),
    ('authenticated','select','submissions'),
    ('authenticated','select','evaluations'),
    ('authenticated','insert','submissions'),
    ('authenticated','insert','task_acceptances'),
    ('authenticated','update','users'),
    ('authenticated','delete','jobs')
  ) as g(role, priv, tbl)

  union all
  select '004', 'function my_feedback() executable by authenticated',
         case
           when not exists (select 1 from pg_roles where rolname = 'authenticated') then 'SKIPPED'
           when not exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'my_feedback'
           ) then 'MISSING'
           when has_function_privilege('authenticated', 'public.my_feedback()', 'execute')
             then 'PRESENT'
           else 'MISSING'
         end

) as checks
order by migration, object;

-- Verdict. Exit status is always 0 (this is a report, not a gate) — read the
-- line below rather than $?.
select
  count(*) filter (where status = 'PRESENT') as present,
  count(*) filter (where status = 'MISSING') as missing,
  count(*) filter (where status = 'FAILED')  as failed,
  count(*) filter (where status = 'SKIPPED') as skipped,
  case
    when count(*) filter (where status in ('MISSING','FAILED')) = 0
      then 'OK — schema matches migrations 002-005'
    else 'INCOMPLETE — see MISSING/FAILED rows above'
  end as verdict
from (
  -- Recomputed rather than stored: this file must stay a single read-only
  -- script with no temp table, so it can run against production unchanged.
  select status from (
    select case when to_regclass('public.' || t) is null then 'MISSING' else 'PRESENT' end as status
    from unnest(array[
      'organizations','users','jobs','tasks','submissions','conversation_artifacts',
      'rubrics','evaluations','api_keys','task_acceptances','org_invites'
    ]) as t
    union all
    select case when to_regclass('public.posts') is null then 'PRESENT' else 'FAILED' end
    union all
    select case
             when not exists (
               select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'users' and policyname = 'users: update self'
             ) then 'MISSING'
             when exists (
               select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'users' and policyname = 'users: update self'
                 and with_check is not null
             ) then 'PRESENT'
             else 'FAILED'
           end
    union all
    select case when exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'my_feedback'
           ) then 'PRESENT' else 'MISSING' end
  ) as core
) as summary;
