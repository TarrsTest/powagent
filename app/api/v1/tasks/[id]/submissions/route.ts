import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err } from '@/lib/http';

// GET /v1/tasks/:id/submissions — org pulls all submissions for one of its
// tasks, including each candidate's normalized conversation transcript.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = await requireScope(req, 'org', 'submissions:read');
  if (isResponse(key)) return key;

  const { id: taskId } = await ctx.params;
  const db = createServiceClient();

  // Scope: the task must be under a job owned by the caller's org.
  const { data: task, error: taskErr } = await db
    .from('tasks')
    .select('id, jobs!inner(org_id)')
    .eq('id', taskId)
    .eq('jobs.org_id', key.ownerId)
    .maybeSingle();
  if (taskErr) return err(500, taskErr.message);
  if (!task) return err(404, 'task not found in your organization');

  const { data, error } = await db
    .from('submissions')
    .select(
      'id, candidate_id, result_md, status, submitted_at, content_hash, ' +
        'conversation_artifacts(source_type, source_url, raw_md, fetch_status, fetched_at)',
    )
    .eq('task_id', taskId)
    .order('submitted_at', { ascending: false });
  if (error) return err(500, error.message);
  return json({ submissions: data ?? [] });
}
