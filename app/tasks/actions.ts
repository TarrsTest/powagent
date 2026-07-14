'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { ingestConversation } from '@/lib/ingest';

const RESULT_CAP = 100_000;

// Candidate submits result_md + agent conversation (markdown or url) for a task.
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

  const db = createServiceClient();
  // Task must belong to an open job.
  const { data: task } = await db
    .from('tasks')
    .select('id, jobs!inner(status)')
    .eq('id', taskId)
    .eq('jobs.status', 'open')
    .maybeSingle();
  if (!task) return;

  // Submission first — transcript ingest must never block it.
  const { data: sub } = await db
    .from('submissions')
    .insert({ task_id: taskId, candidate_id: user.id, result_md: resultMd })
    .select('id')
    .single();
  if (!sub) return;

  const conv = convMd ? { type: 'markdown' as const, md: convMd } : { type: 'url' as const, url: convUrl };
  const artifact = await ingestConversation(conv);
  await db.from('conversation_artifacts').insert({ submission_id: sub.id, ...artifact });

  revalidatePath('/tasks');
};
