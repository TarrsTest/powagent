import { requireScope, isResponse } from '@/lib/guard';
import { json, err, readJson } from '@/lib/http';
import { evaluateSubmission } from '@/lib/evaluateSubmission';

type Body = { rubric_id?: string; model?: string };

// POST /v1/submissions/:id/evaluate — org triggers evaluation of a submission
// against one of its rubrics. Runs the rubric inline (running→done|error) and
// returns the finished row, so the caller does not poll. Simple, and fragile
// against Vercel's function timeout — see PRD §11 O1 for the queue that would
// fix it. The evaluation row is append-only: a done evaluation is frozen;
// re-running creates a new row.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const key = await requireScope(req, 'org', 'evaluations:write');
  if (isResponse(key)) return key;

  const { id: submissionId } = await ctx.params;
  const body = await readJson<Body>(req);
  if (!body?.rubric_id) return err(400, 'rubric_id is required');

  const result = await evaluateSubmission({
    orgId: key.ownerId,
    submissionId,
    rubricId: body.rubric_id,
    model: body.model,
  });
  if (!result.ok) return err(result.status, result.message);
  return json({ evaluation: result.evaluation }, 201);
}
