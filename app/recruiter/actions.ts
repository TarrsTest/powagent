'use server';

import { revalidatePath } from 'next/cache';
import { getProfile } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import { evaluateSubmission } from '@/lib/evaluateSubmission';

/**
 * Recruiter mutations. These run on the session client: the `jobs/tasks/
 * rubrics: recruiter manage own org` policies are the authorization check, so
 * there is no ownership re-check in code. org_id is still read from the profile
 * because inserts must SUPPLY it — the policy's WITH CHECK then verifies it
 * matches the caller's org, which is what makes supplying it safe.
 *
 * runEvaluate is the exception: evaluation rows are system-owned (append-only,
 * written on the privileged path), so it keeps an explicit recruiter check.
 */
const requireOrg = async (): Promise<string | null> => {
  const session = await getProfile();
  if (!session || session.profile.role !== 'recruiter' || !session.profile.org_id) return null;
  return session.profile.org_id;
};

const VISIBILITY = ['none', 'score', 'full'];

export const createJob = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const title = String(formData.get('title') ?? '').slice(0, 200).trim();
  const status = String(formData.get('status') ?? 'open');
  if (!title) return;
  const supabase = await createClient();
  await supabase
    .from('jobs')
    .insert({ org_id: orgId, title, status: ['draft', 'open', 'closed'].includes(status) ? status : 'open' });
  revalidatePath('/recruiter');
};

export const setJobStatus = async (formData: FormData) => {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['draft', 'open', 'closed'].includes(status)) return;
  const supabase = await createClient();
  await supabase.from('jobs').update({ status }).eq('id', id);
  revalidatePath('/recruiter');
};

export const addTask = async (formData: FormData) => {
  const jobId = String(formData.get('job_id') ?? '');
  const title = String(formData.get('title') ?? '').slice(0, 200).trim();
  const briefMd = String(formData.get('brief_md') ?? '').slice(0, 20_000).trim();
  const visibility = String(formData.get('feedback_visibility') ?? 'none');
  if (!jobId || !title || !briefMd) return;
  const supabase = await createClient();
  await supabase.from('tasks').insert({
    job_id: jobId,
    title,
    brief_md: briefMd,
    feedback_visibility: VISIBILITY.includes(visibility) ? visibility : 'none',
  });
  revalidatePath('/recruiter');
};

// A2 — choose how much of the evaluation a candidate may see for this task.
export const setFeedbackVisibility = async (formData: FormData) => {
  const taskId = String(formData.get('task_id') ?? '');
  const visibility = String(formData.get('feedback_visibility') ?? '');
  if (!taskId || !VISIBILITY.includes(visibility)) return;
  const supabase = await createClient();
  await supabase.from('tasks').update({ feedback_visibility: visibility }).eq('id', taskId);
  revalidatePath(`/recruiter/tasks/${taskId}`);
};

export const createRubric = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const name = String(formData.get('name') ?? '').slice(0, 200).trim();
  const promptMd = String(formData.get('prompt_md') ?? '').slice(0, 20_000).trim();
  if (!name || !promptMd) return;
  const supabase = await createClient();
  await supabase.from('rubrics').insert({ org_id: orgId, name, prompt_md: promptMd });
  revalidatePath('/recruiter');
};

export const runEvaluate = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const submissionId = String(formData.get('submission_id') ?? '');
  const rubricId = String(formData.get('rubric_id') ?? '');
  const taskId = String(formData.get('task_id') ?? '');
  if (!submissionId || !rubricId) return;
  await evaluateSubmission({ orgId, submissionId, rubricId });
  if (taskId) {
    revalidatePath(`/recruiter/tasks/${taskId}`);
    revalidatePath(`/recruiter/tasks/${taskId}/leaderboard`);
  }
};
