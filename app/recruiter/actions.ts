'use server';

import { revalidatePath } from 'next/cache';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
import { evaluateSubmission } from '@/lib/evaluateSubmission';

// All recruiter mutations resolve the caller's org from their profile and scope
// every write to it. Service-role client + explicit recruiter guard above each.
const requireOrg = async (): Promise<string | null> => {
  const session = await getProfile();
  if (!session || session.profile.role !== 'recruiter' || !session.profile.org_id) return null;
  return session.profile.org_id;
};

export const createJob = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const title = String(formData.get('title') ?? '').slice(0, 200).trim();
  const status = String(formData.get('status') ?? 'open');
  if (!title) return;
  const db = createServiceClient();
  await db.from('jobs').insert({ org_id: orgId, title, status: ['draft', 'open', 'closed'].includes(status) ? status : 'open' });
  revalidatePath('/recruiter');
};

export const setJobStatus = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !['draft', 'open', 'closed'].includes(status)) return;
  const db = createServiceClient();
  await db.from('jobs').update({ status }).eq('id', id).eq('org_id', orgId);
  revalidatePath('/recruiter');
};

export const addTask = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const jobId = String(formData.get('job_id') ?? '');
  const title = String(formData.get('title') ?? '').slice(0, 200).trim();
  const briefMd = String(formData.get('brief_md') ?? '').slice(0, 20_000).trim();
  if (!jobId || !title || !briefMd) return;
  const db = createServiceClient();
  // Scope: job must belong to caller's org.
  const { data: job } = await db.from('jobs').select('id').eq('id', jobId).eq('org_id', orgId).maybeSingle();
  if (!job) return;
  await db.from('tasks').insert({ job_id: jobId, title, brief_md: briefMd });
  revalidatePath('/recruiter');
};

export const createRubric = async (formData: FormData) => {
  const orgId = await requireOrg();
  if (!orgId) return;
  const name = String(formData.get('name') ?? '').slice(0, 200).trim();
  const promptMd = String(formData.get('prompt_md') ?? '').slice(0, 20_000).trim();
  if (!name || !promptMd) return;
  const db = createServiceClient();
  await db.from('rubrics').insert({ org_id: orgId, name, prompt_md: promptMd });
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
  if (taskId) revalidatePath(`/recruiter/tasks/${taskId}`);
};
