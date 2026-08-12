'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ingestConversation } from '@/lib/ingest';
import { checkSubmissionAllowed } from '@/lib/submissionRules';

const RESULT_CAP = 100_000;

/** Result of submitTask, surfaced to the candidate via useActionState. */
export type SubmitState = { error?: string; ok?: boolean } | null;

/**
 * Candidate-side writes. Both run on the session client, so RLS is the auth
 * check: `submissions: candidate insert own` pins candidate_id to auth.uid(),
 * and `tasks: candidate read open` means a task we can select is by definition
 * a task we're allowed to work on. No ownership re-check in code.
 */

// A1 — accept a task. Idempotent: accepting twice keeps the first timestamp.
export const acceptTask = async (formData: FormData) => {
  const taskId = String(formData.get('task_id') ?? '');
  if (!taskId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('task_acceptances')
    .upsert(
      { task_id: taskId, candidate_id: user.id },
      { onConflict: 'task_id,candidate_id', ignoreDuplicates: true },
    );
  revalidatePath('/tasks');
};

// Submit result_md + agent conversation (markdown or url) for a task.
//
// Returns a message rather than failing silently: a candidate who hits the
// deadline or their submission cap needs to be told which one, and "the button
// did nothing" is the worst possible answer.
export const submitTask = async (
  _prev: SubmitState,
  formData: FormData,
): Promise<SubmitState> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in to submit.' };

  const taskId = String(formData.get('task_id') ?? '');
  const resultMd = String(formData.get('result_md') ?? '').slice(0, RESULT_CAP).trim();
  const convMd = String(formData.get('conversation_md') ?? '').trim();
  const convUrl = String(formData.get('conversation_url') ?? '').trim();
  if (!taskId) return { error: 'Missing task.' };
  if (!resultMd) return { error: 'Your result is required.' };
  if (!convMd && !convUrl) {
    return { error: 'Paste your agent transcript, or give a link to it.' };
  }

  // Selecting the task at all proves the policy lets this candidate see it,
  // i.e. its parent job is open. Its limits then decide whether it is still
  // accepting work — same module the REST API uses (PRD §9.9).
  const { data: task } = await supabase
    .from('tasks')
    .select('id, deadline_at, max_submissions_per_candidate')
    .eq('id', taskId)
    .maybeSingle();
  if (!task) return { error: 'This task is no longer open.' };

  // `submissions: candidate read own` and `acceptances: candidate own` already
  // restrict these to the caller; the explicit filters say which task we mean.
  const [{ count }, { count: acceptedCount }] = await Promise.all([
    supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .eq('candidate_id', user.id),
    supabase
      .from('task_acceptances')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .eq('candidate_id', user.id),
  ]);

  const denial = checkSubmissionAllowed(task, {
    existingCount: count ?? 0,
    hasAccepted: (acceptedCount ?? 0) > 0,
  });
  if (denial) return { error: denial.message };

  // Submission first — transcript ingest must never block it.
  const { data: sub } = await supabase
    .from('submissions')
    .insert({ task_id: taskId, candidate_id: user.id, result_md: resultMd })
    .select('id')
    .single();
  if (!sub) return { error: 'Could not save your submission. Please try again.' };

  const conv = convMd ? { type: 'markdown' as const, md: convMd } : { type: 'url' as const, url: convUrl };
  const artifact = await ingestConversation(conv);
  await supabase.from('conversation_artifacts').insert({ submission_id: sub.id, ...artifact });

  revalidatePath('/tasks');
  return { ok: true };
};
