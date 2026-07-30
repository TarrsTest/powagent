import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err } from '@/lib/http';
import { rankCandidates, type RankableEvaluation } from '@/lib/leaderboard';

type SubmissionRow = {
  id: string;
  candidate_id: string;
  submitted_at: string;
  candidate: { email: string | null } | null;
};

/**
 * GET /v1/evaluations?task_id=... — evaluation results for one of the caller's
 * tasks.
 *
 * Returns two things, because they answer different questions:
 *  · `ranking`     — one entry per CANDIDATE, highest score first. Previously
 *                    this endpoint sorted every evaluation row by score, so a
 *                    candidate whose submission had been re-evaluated occupied
 *                    several places at once and queued/errored rows (no score)
 *                    were ranked as if they'd scored below zero. Ranking rules
 *                    now live in lib/leaderboard.ts, shared with the UI.
 *  · `evaluations` — every row, newest run first, including failed ones, for
 *                    history and debugging. Evaluation is synchronous today, so
 *                    a row here is already `done` or `error` by the time the
 *                    triggering request returns; there is nothing to poll for
 *                    until PRD §11 O1 makes it asynchronous.
 */
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

  const { data: subs, error: subErr } = await db
    .from('submissions')
    .select('id, candidate_id, submitted_at, candidate:users!submissions_candidate_id_fkey(email)')
    .eq('task_id', taskId);
  if (subErr) return err(500, subErr.message);

  const submissions = (subs as unknown as SubmissionRow[] | null) ?? [];
  if (submissions.length === 0) return json({ ranking: [], evaluations: [] });

  const { data, error } = await db
    .from('evaluations')
    .select('id, submission_id, rubric_id, model, status, output_json, content_hash, ran_at, error')
    .in(
      'submission_id',
      submissions.map((s) => s.id),
    )
    .order('ran_at', { ascending: false });
  if (error) return err(500, error.message);

  const evaluations = (data ?? []) as (RankableEvaluation & { id: string })[];

  const ranking = rankCandidates(submissions, evaluations).map((r, i) => ({
    rank: i + 1,
    candidate_id: r.candidateId,
    email: r.email,
    submission_id: r.submissionId,
    score: r.score,
    evaluation: r.evaluation,
  }));

  return json({ ranking, evaluations });
}
