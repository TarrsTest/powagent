-- metrics.sql — the internal read path for PRD §5. Read-only, safe on production.
--
--     pnpm run metrics        # psql "$DATABASE_URL" -f supabase/metrics.sql
--
-- INTERNAL BY DESIGN. Metric 4 measures the recruiter's own attention, and a
-- metric about your own behaviour stops measuring it the moment you are shown it
-- (PRD §5). There is no recruiter-facing surface for these numbers and the
-- `events` table has no SELECT policy — this script runs as the service role or
-- a direct psql connection, which is the whole delivery mechanism. That is also
-- why it is a script rather than a page: an admin UI would need an admin role,
-- which this schema does not have.
--
-- Metrics 1, 2 and 4 live here. Metric 3 (candidate return) is not written: §5.4
-- has not decided whether "receives feedback" means eligible or actually viewed.
--
-- Metrics 1 and 2 read nothing but the product tables, so they answer for the
-- whole history of the database, including the part that predates this file.
-- Metric 4 can only see what the event log caught (§5.1).
--
-- CENSORING. A rate is only honest over outcomes that have had time to happen.
-- An org that signed up yesterday has not failed to activate and a candidate who
-- accepted this morning has not failed to submit; counting them as failures
-- understates every rate here permanently, and the understatement grows with
-- signups. Both sections below therefore split the population into SETTLED (the
-- window closed, the outcome is known) and IN FLIGHT (too early to say), and
-- compute the rate over settled only. The in-flight count is printed next to it
-- so a small denominator is visible rather than implied.
--
-- Repetition of the CTEs between sections is deliberate, for the same reason
-- verify_schema.sql gives: this stays one read-only script with no temp tables
-- and no views, so it runs unchanged against production.

\echo ''
\echo '================================================================'
\echo ' PRD §5 metric 1 — employer activation'
\echo '================================================================'
\echo ''
\echo 'Where do new organizations stop? Each row is how many orgs ever'
\echo 'reached that step. `depends_on` matters: an employer controls the'
\echo 'steps marked employer, and cannot make a candidate show up. A big'
\echo 'drop at a market step is a demand problem, not an onboarding one.'
\echo ''

with org_stage as (
  select
    o.id,
    o.created_at,
    exists (select 1 from jobs j where j.org_id = o.id) as has_job,
    exists (
      select 1 from jobs j join tasks t on t.job_id = j.id where j.org_id = o.id
    ) as has_task,
    exists (select 1 from rubrics r where r.org_id = o.id) as has_rubric,
    exists (
      select 1 from jobs j join tasks t on t.job_id = j.id
      where j.org_id = o.id and j.status = 'open'
    ) as has_open_task,
    exists (
      select 1 from task_acceptances ta
      join tasks t on t.id = ta.task_id join jobs j on j.id = t.job_id
      where j.org_id = o.id
    ) as has_acceptance,
    exists (
      select 1 from submissions s
      join tasks t on t.id = s.task_id join jobs j on j.id = t.job_id
      where j.org_id = o.id
    ) as has_submission,
    (
      select min(e.ran_at) from evaluations e
      join submissions s on s.id = e.submission_id
      join tasks t on t.id = s.task_id join jobs j on j.id = t.job_id
      where j.org_id = o.id and e.status = 'done'
    ) as first_eval_at
  from organizations o
),
funnel as (
  select 1 as step, 'organization created'      as stage, 'employer' as depends_on, count(*)                                       as orgs from org_stage
  union all
  select 2, 'created a job',                    'employer', count(*) filter (where has_job)                 from org_stage
  union all
  select 3, 'added a task',                     'employer', count(*) filter (where has_task)                from org_stage
  union all
  select 4, 'wrote a rubric',                   'employer', count(*) filter (where has_rubric)              from org_stage
  union all
  select 5, 'task visible to candidates',       'employer', count(*) filter (where has_open_task)           from org_stage
  union all
  select 6, 'a candidate accepted',             'market',   count(*) filter (where has_acceptance)          from org_stage
  union all
  select 7, 'a candidate submitted',            'market',   count(*) filter (where has_submission)          from org_stage
  union all
  select 8, 'first evaluation completed',       'employer', count(*) filter (where first_eval_at is not null) from org_stage
)
select
  step,
  stage,
  depends_on,
  orgs,
  round(100.0 * orgs / nullif(first_value(orgs) over (order by step), 0), 1) as pct_of_all_orgs,
  coalesce(lag(orgs) over (order by step) - orgs, 0)                        as lost_here
from funnel
order by step;

\echo ''
\echo '--- the §5 target: activated within 7 days of signing up ---'
\echo ''

with org_stage as (
  select
    o.id,
    o.created_at,
    (
      select min(e.ran_at) from evaluations e
      join submissions s on s.id = e.submission_id
      join tasks t on t.id = s.task_id join jobs j on j.id = t.job_id
      where j.org_id = o.id and e.status = 'done'
    ) as first_eval_at
  from organizations o
),
settled as (
  select *, created_at <= now() - interval '7 days' as window_closed from org_stage
)
select
  count(*) filter (where window_closed)                     as orgs_judged,
  count(*) filter (
    where window_closed
      and first_eval_at is not null
      and first_eval_at <= created_at + interval '7 days'
  )                                                          as activated_in_7d,
  round(100.0 * count(*) filter (
    where window_closed
      and first_eval_at is not null
      and first_eval_at <= created_at + interval '7 days'
  ) / nullif(count(*) filter (where window_closed), 0), 1)   as activation_rate_pct,
  count(*) filter (where not window_closed)                  as still_in_window
from settled;

\echo ''
\echo '================================================================'
\echo ' PRD §5 metric 2 — candidate completion (accepted -> submitted)'
\echo '================================================================'
\echo ''
\echo 'Target: >= 40%. Accepting is a prerequisite for submitting (§9.9),'
\echo 'so every submission has an acceptance and the funnel is complete.'
\echo ''

with pair as (
  select
    ta.task_id,
    ta.candidate_id,
    ta.accepted_at,
    exists (
      select 1 from submissions s
      where s.task_id = ta.task_id and s.candidate_id = ta.candidate_id
    ) as submitted,
    exists (
      select 1 from submissions s
      join evaluations e on e.submission_id = s.id and e.status = 'done'
      where s.task_id = ta.task_id and s.candidate_id = ta.candidate_id
    ) as evaluated,
    -- The outcome is known once they acted, or once their window shut.
    (
      exists (
        select 1 from submissions s
        where s.task_id = ta.task_id and s.candidate_id = ta.candidate_id
      )
      or ta.accepted_at <= now() - interval '7 days'
      or (t.deadline_at is not null and t.deadline_at < now())
    ) as is_settled
  from task_acceptances ta
  join tasks t on t.id = ta.task_id
)
select
  count(*)                                            as acceptances_total,
  count(*) filter (where is_settled)                  as settled,
  count(*) filter (where is_settled and submitted)    as submitted,
  round(100.0 * count(*) filter (where is_settled and submitted)
        / nullif(count(*) filter (where is_settled), 0), 1) as completion_rate_pct,
  40.0                                                as target_pct,
  count(*) filter (where is_settled and evaluated)    as also_evaluated,
  count(*) filter (where not is_settled)              as still_in_flight
from pair;

\echo ''
\echo '--- worst tasks by completion, settled acceptances only ---'
\echo ''

with pair as (
  select
    ta.task_id,
    exists (
      select 1 from submissions s
      where s.task_id = ta.task_id and s.candidate_id = ta.candidate_id
    ) as submitted,
    (
      exists (
        select 1 from submissions s
        where s.task_id = ta.task_id and s.candidate_id = ta.candidate_id
      )
      or ta.accepted_at <= now() - interval '7 days'
      or (t.deadline_at is not null and t.deadline_at < now())
    ) as is_settled
  from task_acceptances ta
  join tasks t on t.id = ta.task_id
)
select
  t.title                                       as task,
  o.name                                        as organization,
  count(*)                                      as settled_acceptances,
  count(*) filter (where p.submitted)           as submitted,
  round(100.0 * count(*) filter (where p.submitted) / nullif(count(*), 0), 1) as completion_pct
from pair p
join tasks t on t.id = p.task_id
join jobs j on j.id = t.job_id
join organizations o on o.id = j.org_id
where p.is_settled
group by t.title, o.name
having count(*) >= 3          -- fewer than three outcomes is noise, not a signal
order by completion_pct asc
limit 10;

\echo ''
\echo '--- integrity: submissions with no acceptance behind them ---'
\echo ''
\echo 'Must be 0. Acceptance became a prerequisite on 2026-08-12 and is'
\echo 'enforced on both write paths, but PRD §9.9 records that the rules'
\echo 'are app-layer only — a candidate posting straight to PostgREST can'
\echo 'still bypass them. A number that grows is that hole being used, and'
\echo 'it silently deflates metric 2 by adding submissions no funnel saw.'
\echo ''

select count(*) as submissions_without_acceptance
from submissions s
where not exists (
  select 1 from task_acceptances ta
  where ta.task_id = s.task_id and ta.candidate_id = s.candidate_id
);

\echo ''
\echo '================================================================'
\echo ' PRD §5 metric 4 — transcript reads on top-3 candidates'
\echo '================================================================'
\echo ''

-- Ranking mirrors lib/leaderboard.ts, which is the definition of record:
--   1. a submission scores as its LATEST done evaluation (append-only, so the
--      most recent run is the current verdict);
--   2. a candidate scores as their BEST submission;
--   3. anything unscored is excluded, never sorted as zero.
with latest_eval as (
  select distinct on (e.submission_id)
    e.submission_id,
    (e.output_json ->> 'score')::numeric as score
  from evaluations e
  where e.status = 'done'
  order by e.submission_id, e.ran_at desc nulls last
),
scored as (
  select s.id as submission_id, s.task_id, s.candidate_id, j.org_id, le.score
  from submissions s
  join tasks t on t.id = s.task_id
  join jobs j on j.id = t.job_id
  join latest_eval le on le.submission_id = s.id
  where le.score is not null
),
best_per_candidate as (
  select distinct on (task_id, candidate_id)
    submission_id, task_id, candidate_id, org_id, score
  from scored
  order by task_id, candidate_id, score desc
),
ranked as (
  select *, row_number() over (partition by task_id order by score desc) as position
  from best_per_candidate
),
top3 as (
  select r.*,
    exists (
      select 1 from events ev
      where ev.type = 'transcript.read'
        and ev.subject_type = 'submission'
        and ev.subject_id = r.submission_id
        -- Drops rows an actor attributed to a submission outside their own org,
        -- which is the one thing the insert policy deliberately does not check.
        and ev.org_id = r.org_id
    ) as was_read
  from ranked r
  where r.position <= 3
)
select
  count(*)                                          as top3_candidates,
  count(*) filter (where was_read)                  as transcripts_read,
  round(100.0 * count(*) filter (where was_read)
        / nullif(count(*), 0), 1)                   as read_rate_pct,
  50.0                                              as target_pct
from top3;

\echo ''
\echo '--- per organization ---'
\echo ''

with latest_eval as (
  select distinct on (e.submission_id)
    e.submission_id,
    (e.output_json ->> 'score')::numeric as score
  from evaluations e
  where e.status = 'done'
  order by e.submission_id, e.ran_at desc nulls last
),
scored as (
  select s.id as submission_id, s.task_id, s.candidate_id, j.org_id, le.score
  from submissions s
  join tasks t on t.id = s.task_id
  join jobs j on j.id = t.job_id
  join latest_eval le on le.submission_id = s.id
  where le.score is not null
),
best_per_candidate as (
  select distinct on (task_id, candidate_id)
    submission_id, task_id, candidate_id, org_id, score
  from scored
  order by task_id, candidate_id, score desc
),
ranked as (
  select *, row_number() over (partition by task_id order by score desc) as position
  from best_per_candidate
),
top3 as (
  select r.*,
    exists (
      select 1 from events ev
      where ev.type = 'transcript.read'
        and ev.subject_type = 'submission'
        and ev.subject_id = r.submission_id
        and ev.org_id = r.org_id
    ) as was_read
  from ranked r
  where r.position <= 3
)
select
  o.name                                            as organization,
  count(*)                                          as top3_candidates,
  count(*) filter (where t.was_read)                as transcripts_read,
  round(100.0 * count(*) filter (where t.was_read)
        / nullif(count(*), 0), 1)                   as read_rate_pct
from top3 t
join organizations o on o.id = t.org_id
group by o.name
order by read_rate_pct nulls last;

\echo ''
\echo 'Known limits of the number above:'
\echo '  · "read" means the disclosure was expanded, not that anyone read it.'
\echo '  · Ranking is CURRENT, not as-of-the-read. Evaluations are append-only,'
\echo '    so a re-run can move a candidate in or out of the top 3 after the'
\echo '    fact, and this recomputes from today. Point-in-time attribution needs'
\echo '    the ranking position stored on the event (events.metadata).'
\echo '  · A top-3 candidate whose transcript ingest failed is still counted in'
\echo '    the denominator; there was nothing to read.'
\echo ''
