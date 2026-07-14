import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faFlag, faPlay } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
import Brand from '@/components/Brand';
import { runEvaluate } from '../../actions';

type EvalRow = {
  id: string;
  status: string;
  error: string | null;
  ran_at: string | null;
  output_json: { score?: number; rationale?: string; flags?: string[]; dimensions?: { name: string; score: number }[] } | null;
};
type Artifact = { raw_md: string | null; fetch_status: string; source_type: string };
type Submission = {
  id: string;
  candidate_id: string;
  result_md: string;
  status: string;
  submitted_at: string;
  conversation_artifacts: Artifact[];
  evaluations: EvalRow[];
};

export default async function TaskSubmissionsPage(props: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await props.params;
  const session = await getProfile();
  if (!session) redirect('/login');
  if (session.profile.role !== 'recruiter' || !session.profile.org_id) redirect('/settings');
  const orgId = session.profile.org_id;

  const db = createServiceClient();
  const { data: task } = await db
    .from('tasks')
    .select('id, title, brief_md, jobs!inner(org_id, title)')
    .eq('id', taskId)
    .eq('jobs.org_id', orgId)
    .maybeSingle();
  if (!task) notFound();

  const [{ data: submissions }, { data: rubrics }] = await Promise.all([
    db
      .from('submissions')
      .select(
        'id, candidate_id, result_md, status, submitted_at, ' +
          'conversation_artifacts(raw_md, fetch_status, source_type), ' +
          'evaluations(id, status, error, ran_at, output_json)',
      )
      .eq('task_id', taskId)
      .order('submitted_at', { ascending: false }),
    db.from('rubrics').select('id, name').eq('org_id', orgId).order('created_at', { ascending: false }),
  ]);

  const rubricList = (rubrics as { id: string; name: string }[] | null) ?? [];

  return (
    <main className="min-h-dvh">
      <nav className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div>
          <Link href="/recruiter" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5">
            <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" /> Recruiter dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-2">{task.title}</h1>
          <p className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{task.brief_md}</p>
        </div>

        {rubricList.length === 0 && (
          <p className="text-sm text-amber-700 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            Create a rubric on the dashboard before you can evaluate submissions.
          </p>
        )}

        <ul className="space-y-4">
          {(submissions as Submission[] | null)?.map((s) => {
            const artifact = s.conversation_artifacts?.[0];
            const evals = (s.evaluations ?? []).slice().sort((a, b) => (b.output_json?.score ?? -1) - (a.output_json?.score ?? -1));
            return (
              <li key={s.id} className="card p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono text-slate-400">candidate {s.candidate_id.slice(0, 8)}…</span>
                  <span className="badge badge-muted">{s.status}</span>
                </div>

                <details className="mb-2 group">
                  <summary className="text-sm font-semibold text-slate-800 cursor-pointer select-none">Result</summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700">{s.result_md}</pre>
                </details>

                <details className="mb-3 group">
                  <summary className="text-sm font-semibold text-slate-800 cursor-pointer select-none">
                    Agent transcript{' '}
                    <span className="text-xs font-normal text-slate-400">
                      ({artifact?.source_type ?? 'none'} · {artifact?.fetch_status ?? 'n/a'})
                    </span>
                  </summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700">
                    {artifact?.raw_md ?? '(no transcript / fetch failed)'}
                  </pre>
                </details>

                {/* Trigger evaluation */}
                {rubricList.length > 0 && (
                  <form action={runEvaluate} className="flex items-center gap-2 border-t border-slate-100 pt-3">
                    <input type="hidden" name="submission_id" value={s.id} />
                    <input type="hidden" name="task_id" value={taskId} />
                    <select name="rubric_id" required className="field w-auto h-9 flex-1">
                      {rubricList.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                    <button className="btn btn-primary btn-sm h-9">
                      <FontAwesomeIcon icon={faPlay} className="w-3 h-3" /> Evaluate
                    </button>
                  </form>
                )}

                {/* Evaluation results, ranked */}
                {evals.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {evals.map((e) => (
                      <li key={e.id} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                        {e.status === 'done' && e.output_json ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-2xl font-extrabold text-slate-900 tabular-nums">{e.output_json.score ?? '—'}</span>
                              <span className="text-xs text-slate-400">/ 100</span>
                              {e.output_json.flags?.map((f) => (
                                <span key={f} className="badge badge-warn">
                                  <FontAwesomeIcon icon={faFlag} className="w-2.5 h-2.5" />{f}
                                </span>
                              ))}
                            </div>
                            <p className="text-xs text-slate-600 mt-1">{e.output_json.rationale}</p>
                          </>
                        ) : (
                          <span className="text-xs text-red-600">{e.status}: {e.error ?? '…'}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {submissions?.length === 0 && <li className="text-sm text-slate-500">No submissions yet.</li>}
        </ul>
      </div>
    </main>
  );
}
