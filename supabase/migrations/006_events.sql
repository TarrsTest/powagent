-- 006_events.sql — the event log behind PRD §5.
--
-- WHY A TABLE AT ALL. Three of the four §5 metrics (employer activation,
-- candidate completion, candidate return) are derivable from the product tables
-- that already exist: organizations.created_at, task_acceptances, submissions
-- and evaluations record everything those questions ask about, and they record
-- it retroactively. They must NOT be routed through this table — an event log
-- cannot answer questions about the past, and a second copy of a fact that
-- `submissions` already owns is a copy that will eventually disagree with it.
--
-- The fourth metric is different in kind. "Did the recruiter actually read the
-- agent transcript?" leaves no trace anywhere: the transcript ships inside the
-- initial HTML and is revealed by a native <details> toggle, so the server never
-- learns that it happened. Nothing can be reconstructed later. That is the whole
-- reason this table exists, and it is why it ships before there is traffic
-- rather than after.
--
-- AUDIENCE (decided 2026-08-12). These aggregates are INTERNAL. Metric 4
-- measures the recruiter's own attention, and a metric about your own behaviour
-- stops measuring it the moment you are shown it — a transcript "read" is one
-- click, the cheapest thing in the product to inflate. Recruiters therefore get
-- no read path here at all: there is no SELECT policy and no SELECT grant, so
-- the table is invisible through PostgREST to anon and authenticated alike.
-- Analysis runs on the service role. Opening this up later is one policy; the
-- reverse is impossible, because behaviour recorded under observation cannot be
-- un-contaminated.
--
-- Fully idempotent: re-running on every deploy is a no-op.

create table if not exists events (
  id uuid primary key default gen_random_uuid(),

  -- Dotted event name, e.g. 'transcript.read'. Deliberately unconstrained: a
  -- CHECK would mean a migration per new event type, which is the one thing a
  -- generic event log exists to avoid. The names in use are listed in PRD §5.
  type text not null,

  -- Who did it. ON DELETE SET NULL rather than CASCADE: erasing a person must
  -- not silently rewrite history for everyone else (PRD §10.1). The row survives
  -- for aggregate counting with the identity removed.
  actor_id uuid references users(id) on delete set null,

  -- Denormalised so the internal queries can group by organization without
  -- walking submission -> task -> job on every row. Nullable because not every
  -- future event happens inside an org.
  org_id uuid references organizations(id) on delete cascade,

  -- What it happened to. Not a foreign key: subjects live in different tables
  -- and an event must outlive the thing it describes, or deleting a job would
  -- quietly delete the evidence that anyone looked at it.
  subject_type text,
  subject_id uuid,

  -- Room for per-type detail (dwell time, ranking position at the time, ...)
  -- without a migration each time. Empty today by design; see PRD §5.
  metadata jsonb not null default '{}',

  occurred_at timestamptz not null default now()
);

-- The analysis scan: "all reads of this type, newest first, optionally per org".
create index if not exists events_type_occurred_idx
  on events (type, occurred_at desc);

-- Joining events back to what they describe, and de-duplicating repeat opens
-- of the same transcript by the same person.
create index if not exists events_subject_idx
  on events (subject_type, subject_id);

alter table events enable row level security;

-- INSERT only, and only as yourself. Pinning actor_id is what stops a signed-in
-- user attributing an event to someone else; there is no UPDATE or DELETE grant,
-- so a written event is final.
--
-- A recruiter can still, in principle, POST fabricated reads of their own org's
-- submissions straight to PostgREST. That is accepted rather than closed: the
-- aggregate is invisible to them (no SELECT policy), so there is nothing to
-- game, and the alternative — validating the subject inside the policy — costs a
-- join on every insert to defend against an attack with no motive.
drop policy if exists "events: actor inserts own" on events;
create policy "events: actor inserts own" on events for insert
  with check (actor_id = auth.uid());

-- Deliberately NO select policy. See the audience note above.

grant insert on events to authenticated;
