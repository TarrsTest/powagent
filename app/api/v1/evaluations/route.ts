import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err } from '@/lib/http';

// GET /v1/evaluations?task_id=... — org pulls evaluation results for one of its
// tasks (sorted by overall score desc for easy candidate ranking).
export async function GET(req: Request) {
  const key = await requireScope(req, 'org', 'evaluations:read');
  if (isResponse(key)) return key;

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('task_id');
  if (!taskId) return err(400, 'task_id is required');

  const db = createServiceClient();

  // Scope: task must be under the caller's org.
  const { data: task, error: taskErr } = await db
    .from('tasks')
    .select('id, jobs!inner(org_id)')
    .eq('id', taskId)
    .eq('jobs.org_id', key.ownerId)
    .maybeSingle();
  if (taskErr) return err(500, taskErr.message);
  if (!task) return err(404, 'task not found in your organization');

  // Submissions for this task → their evaluations.
  const { data: subs, error: subErr } = await db
    .from('submissions')
    .select('id')
    .eq('task_id', taskId);
  if (subErr) return err(500, subErr.message);
  const subIds = (subs ?? []).map((s) => s.id);
  if (subIds.length === 0) return json({ evaluations: [] });

  const { data, error } = await db
    .from('evaluations')
    .select('id, submission_id, rubric_id, model, status, output_json, content_hash, ran_at, error')
    .in('submission_id', subIds)
    .order('ran_at', { ascending: false });
  if (error) return err(500, error.message);

  // Rank done evaluations by overall score desc.
  const evaluations = (data ?? []).sort((a, b) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sa = (a.output_json as any)?.score ?? -1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (b.output_json as any)?.score ?? -1;
    return sb - sa;
  });
  return json({ evaluations });
}
