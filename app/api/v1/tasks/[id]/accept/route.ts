import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err } from '@/lib/http';

// POST /v1/tasks/:id/accept — candidate accepts a task.
// A1: acceptance is now persisted, so an employer can see who is working on a
// task before any submission lands. Idempotent — re-accepting returns the
// original accepted_at rather than erroring.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = await requireScope(req, 'candidate', 'tasks:accept');
  if (isResponse(key)) return key;

  const { id } = await ctx.params;
  const db = createServiceClient();
  const { data: task, error } = await db
    .from('tasks')
    .select('id, title, agent_allowed, deadline_at, jobs!inner(status)')
    .eq('id', id)
    .eq('jobs.status', 'open')
    .maybeSingle();

  if (error) return err(500, error.message);
  if (!task) return err(404, 'task not found or not open');

  const { data: acceptance, error: acceptErr } = await db
    .from('task_acceptances')
    .upsert(
      { task_id: task.id, candidate_id: key.ownerId },
      { onConflict: 'task_id,candidate_id', ignoreDuplicates: false },
    )
    .select('accepted_at')
    .single();
  if (acceptErr) return err(500, acceptErr.message);

  return json({
    accepted: true,
    task_id: task.id,
    accepted_at: acceptance.accepted_at,
    deadline_at: task.deadline_at,
  });
}
