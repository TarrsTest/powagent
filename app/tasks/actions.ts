'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ingestConversation } from '@/lib/ingest';

const RESULT_CAP = 100_000;

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
export const submitTask = async (formData: FormData) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const taskId = String(formData.get('task_id') ?? '');
  const resultMd = String(formData.get('result_md') ?? '').slice(0, RESULT_CAP).trim();
  const convMd = String(formData.get('conversation_md') ?? '').trim();
  const convUrl = String(formData.get('conversation_url') ?? '').trim();
  if (!taskId || !resultMd) return;
  if (!convMd && !convUrl) return; // must supply at least one form of transcript

  // Selecting the task at all proves the policy lets this candidate see it,
  // i.e. its parent job is open.
  const { data: task } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle();
  if (!task) return;

  // Submission first — transcript ingest must never block it.
  const { data: sub } = await supabase
    .from('submissions')
    .insert({ task_id: taskId, candidate_id: user.id, result_md: resultMd })
    .select('id')
    .single();
  if (!sub) return;

  const conv = convMd ? { type: 'markdown' as const, md: convMd } : { type: 'url' as const, url: convUrl };
  const artifact = await ingestConversation(conv);
  await supabase.from('conversation_artifacts').insert({ submission_id: sub.id, ...artifact });

  revalidatePath('/tasks');
};
