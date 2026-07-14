import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err } from '@/lib/http';

// POST /v1/tasks/:id/accept — candidate accepts a task.
// v1 acceptance is lightweight: we validate the task is open and ack it.
// The meaningful, persisted action is the subsequent submission.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = await requireScope(req, 'candidate', 'tasks:accept');
  if (isResponse(key)) return key;

  const { id } = await ctx.params;
  const db = createServiceClient();
  const { data, error } = await db
    .from('tasks')
    .select('id, title, agent_allowed, deadline_at, jobs!inner(status)')
    .eq('id', id)
    .eq('jobs.status', 'open')
    .maybeSingle();

  if (error) return err(500, error.message);
  if (!data) return err(404, 'task not found or not open');
  return json({ accepted: true, task_id: data.id });
}
