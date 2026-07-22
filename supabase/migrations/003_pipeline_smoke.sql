-- 003_pipeline_smoke.sql
-- Deploy-pipeline smoke test (NOT a product table). Proves the migrate phase
-- ran on the target environment: creates a tiny marker table and stamps one
-- row per deploy. The `dbcheck` edge function reads the latest row back, so
-- migrate + functions are verified end-to-end. Fully idempotent — safe on
-- every restart / re-deploy.

create table if not exists pipeline_smoke (
  id          bigint generated always as identity primary key,
  marker      text        not null,
  deployed_at timestamptz not null default now()
);

-- One marker row for migration 003. `on conflict do nothing` keeps it a no-op
-- on re-run (unique on marker).
create unique index if not exists pipeline_smoke_marker_uniq
  on pipeline_smoke (marker);

insert into pipeline_smoke (marker)
  values ('migration-003')
  on conflict (marker) do nothing;
