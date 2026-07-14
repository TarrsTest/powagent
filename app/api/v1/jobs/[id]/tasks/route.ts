import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err, readJson } from '@/lib/http';

type Body = {
  title?: string;
  brief_md?: string;
  agent_allowed?: boolean;
  max_submissions_per_candidate?: number | null;
  deadline_at?: string | null;
};

// POST /v1/jobs/:id/tasks — org adds a task to one of its jobs.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = await requireScope(req, 'org', 'tasks:write');
  if (isResponse(key)) return key;

  const { id: jobId } = await ctx.params;
  const body = await readJson<Body>(req);
  if (!body) return err(400, 'invalid json body');
  const title = String(body.title ?? '').slice(0, 200).trim();
  const briefMd = String(body.brief_md ?? '').slice(0, 20_000).trim();
  if (!title) return err(400, 'title is required');
  if (!briefMd) return err(400, 'brief_md is required');

  const db = createServiceClient();
  // Scope: the job must belong to the caller's org.
  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('org_id', key.ownerId)
    .maybeSingle();
  if (jobErr) return err(500, jobErr.message);
  if (!job) return err(404, 'job not found in your organization');

  const { data, error } = await db
    .from('tasks')
    .insert({
      job_id: jobId,
      title,
      brief_md: briefMd,
      agent_allowed: body.agent_allowed ?? true,
      max_submissions_per_candidate: body.max_submissions_per_candidate ?? null,
      deadline_at: body.deadline_at ?? null,
    })
    .select('id, title, agent_allowed, deadline_at, created_at')
    .single();
  if (error) return err(500, error.message);
  return json({ task: data }, 201);
}
