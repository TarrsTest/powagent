import { createServiceClient } from '@/lib/supabase/service';
import { runEvaluation } from '@/lib/eval';

/**
 * Shared evaluation orchestration used by BOTH the REST API
 * (app/api/v1/submissions/[id]/evaluate) and the recruiter UI action.
 * Scoped to orgId: the submission and rubric must both belong to that org.
 *
 * Evaluations are append-only: this always inserts a NEW evaluation row; a done
 * row is never mutated (enforced by a trigger, not by convention).
 *
 * STATE MODEL — what actually happens today:
 *
 *   evaluations:  running -> done          (success)
 *                 running -> error         (failure)
 *   submissions:  submitted -> evaluating -> evaluated   (success)
 *                 submitted -> evaluating -> submitted   (failure, reverted)
 *
 * `queued` is a legal evaluations.status and is the column DEFAULT, but this
 * function never produces it: the Anthropic call runs inside the request, so a
 * row is already running by the time it exists. The value is deliberately kept
 * for the asynchronous path in PRD §11 O1 — a queue would insert without a
 * status (taking the default) and a worker would move it to running. Until that
 * exists, a `queued` row in the database means something crashed between insert
 * and update, not that work is waiting.
 */
export const evaluateSubmission = async (params: {
  orgId: string;
  submissionId: string;
  rubricId: string;
  model?: string;
}): Promise<
  | { ok: true; evaluation: Record<string, unknown> }
  | { ok: false; status: number; message: string }
> => {
  const { orgId, submissionId, rubricId, model } = params;
  const db = createServiceClient();

  const { data: sub, error: subErr } = await db
    .from('submissions')
    .select(
      'id, result_md, tasks!inner(brief_md, jobs!inner(org_id)), ' +
        'conversation_artifacts(raw_md)',
    )
    .eq('id', submissionId)
    .eq('tasks.jobs.org_id', orgId)
    .maybeSingle();
  if (subErr) return { ok: false, status: 500, message: subErr.message };
  if (!sub) return { ok: false, status: 404, message: 'submission not found in your organization' };

  const { data: rubric, error: rubErr } = await db
    .from('rubrics')
    .select('id, prompt_md')
    .eq('id', rubricId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (rubErr) return { ok: false, status: 500, message: rubErr.message };
  if (!rubric) return { ok: false, status: 404, message: 'rubric not found in your organization' };

  const subRow = sub as unknown as {
    result_md: string;
    tasks: { brief_md: string };
    conversation_artifacts: { raw_md: string | null }[];
  };
  const transcript =
    (subRow.conversation_artifacts ?? [])
      .map((a) => a.raw_md)
      .filter(Boolean)
      .join('\n\n---\n\n') || null;

  const { data: evalRow, error: evalErr } = await db
    .from('evaluations')
    .insert({ submission_id: submissionId, rubric_id: rubric.id, status: 'running', ran_at: new Date().toISOString() })
    .select('id')
    .single();
  if (evalErr) return { ok: false, status: 500, message: evalErr.message };

  await db.from('submissions').update({ status: 'evaluating' }).eq('id', submissionId);

  try {
    const { output, model: usedModel } = await runEvaluation({
      taskBrief: subRow.tasks.brief_md,
      resultMd: subRow.result_md,
      transcriptMd: transcript,
      rubricPrompt: rubric.prompt_md,
      model,
    });
    const { data: done, error: doneErr } = await db
      .from('evaluations')
      .update({ status: 'done', output_json: output, model: usedModel })
      .eq('id', evalRow.id)
      .select('id, status, model, output_json, content_hash, ran_at')
      .single();
    if (doneErr) return { ok: false, status: 500, message: doneErr.message };
    await db.from('submissions').update({ status: 'evaluated' }).eq('id', submissionId);
    return { ok: true, evaluation: done };
  } catch (e) {
    const message = (e as Error).message;
    await db.from('evaluations').update({ status: 'error', error: message }).eq('id', evalRow.id);
    await db.from('submissions').update({ status: 'submitted' }).eq('id', submissionId);
    return { ok: false, status: 502, message: `evaluation failed: ${message}` };
  }
};
