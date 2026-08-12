import { requireScope, isResponse } from '@/lib/guard';
import { createServiceClient } from '@/lib/supabase/service';
import { json, err, readJson } from '@/lib/http';
import { rateLimit } from '@/lib/ratelimit';
import { ingestConversation } from '@/lib/ingest';
import { checkSubmissionAllowed } from '@/lib/submissionRules';

const RESULT_CAP = 100_000; // chars

type Body = {
  task_id?: string;
  result_md?: string;
  conversation?: { type?: 'url' | 'markdown'; url?: string; md?: string };
};

// POST /v1/submissions — candidate submits result_md + agent conversation.
export async function POST(req: Request) {
  const key = await requireScope(req, 'candidate', 'submissions:write');
  if (isResponse(key)) return key;

  // Anti-spam (spec §9.4): best-effort per-instance limiter.
  if (!rateLimit(`sub:${key.ownerId}`, 20, 10 * 60_000)) {
    return err(429, 'rate limit exceeded, slow down');
  }

  const body = await readJson<Body>(req);
  if (!body) return err(400, 'invalid json body');

  const taskId = String(body.task_id ?? '');
  const resultMd = String(body.result_md ?? '').slice(0, RESULT_CAP);
  const conv = body.conversation;
  if (!taskId) return err(400, 'task_id is required');
  if (!resultMd.trim()) return err(400, 'result_md is required');
  if (!conv || (conv.type !== 'url' && conv.type !== 'markdown')) {
    return err(400, "conversation.type must be 'url' or 'markdown'");
  }
  if (conv.type === 'url' && !conv.url) return err(400, 'conversation.url is required');
  if (conv.type === 'markdown' && !conv.md) return err(400, 'conversation.md is required');

  const db = createServiceClient();

  // Task must exist and belong to an open job.
  const { data: task, error: taskErr } = await db
    .from('tasks')
    .select('id, deadline_at, max_submissions_per_candidate, jobs!inner(status)')
    .eq('id', taskId)
    .eq('jobs.status', 'open')
    .maybeSingle();
  if (taskErr) return err(500, taskErr.message);
  if (!task) return err(404, 'task not found or not open');

  // Deadline + acceptance + per-candidate cap. Decided by lib/submissionRules,
  // which the UI Server Action also calls — one implementation, so the two entry
  // points cannot drift apart again (PRD §9.9).
  //
  // Acceptance is a gate here too: a key holding submissions:write but not
  // tasks:accept cannot submit to a task it never accepted, which is the point —
  // the funnel starts at acceptance on both paths or on neither.
  const [{ count, error: countErr }, { count: acceptedCount, error: acceptErr }] =
    await Promise.all([
      db
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('task_id', taskId)
        .eq('candidate_id', key.ownerId),
      db
        .from('task_acceptances')
        .select('id', { count: 'exact', head: true })
        .eq('task_id', taskId)
        .eq('candidate_id', key.ownerId),
    ]);
  if (countErr) return err(500, countErr.message);
  if (acceptErr) return err(500, acceptErr.message);

  const denial = checkSubmissionAllowed(task, {
    existingCount: count ?? 0,
    hasAccepted: (acceptedCount ?? 0) > 0,
  });
  if (denial) return err(denial.status, denial.message, { code: denial.code });

  // Insert the submission first — never blocked by transcript ingest.
  const { data: sub, error: subErr } = await db
    .from('submissions')
    .insert({ task_id: taskId, candidate_id: key.ownerId, result_md: resultMd })
    .select('id, status, submitted_at, content_hash')
    .single();
  if (subErr) return err(500, subErr.message);

  // Ingest + store the conversation artifact (best-effort for url).
  const artifact = await ingestConversation({ type: conv.type, url: conv.url, md: conv.md });
  const { error: artErr } = await db.from('conversation_artifacts').insert({
    submission_id: sub.id,
    ...artifact,
  });
  if (artErr) return err(500, artErr.message);

  return json(
    {
      submission: sub,
      conversation: { source_type: artifact.source_type, fetch_status: artifact.fetch_status },
    },
    201,
  );
}

// GET /v1/submissions?task_id=... — candidate lists their own submissions.
export async function GET(req: Request) {
  const key = await requireScope(req, 'candidate', 'submissions:read');
  if (isResponse(key)) return key;

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('task_id');

  const db = createServiceClient();
  let query = db
    .from('submissions')
    .select('id, task_id, status, submitted_at, content_hash, result_md')
    .eq('candidate_id', key.ownerId) // scope: only own submissions
    .order('submitted_at', { ascending: false })
    .limit(100);
  if (taskId) query = query.eq('task_id', taskId);

  const { data, error } = await query;
  if (error) return err(500, error.message);
  return json({ submissions: data ?? [] });
}
