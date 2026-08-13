import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faFlag, faPlay, faRankingStar, faHandshake } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import Brand from '@/components/Brand';
import { runEvaluate, setFeedbackVisibility, recordTranscriptRead } from '../../actions';
import TranscriptDisclosure from './TranscriptDisclosure';

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
  candidate: { email: string | null } | null;
  conversation_artifacts: Artifact[];
  evaluations: EvalRow[];
};

export default async function TaskSubmissionsPage(props: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await props.params;
  const session = await getProfile();
  if (!session) redirect('/login');
  // UX guard only — the policies below are what actually scope the data.
  if (session.profile.role !== 'recruiter' || !session.profile.org_id) redirect('/settings');
  const orgId = session.profile.org_id;

  // Session client. Submissions / artifacts / evaluations / rubrics are scoped
  // to this org by their own policies, so those queries carry no org filter.
  //
  // The task lookup does, because `tasks: candidate read open` is permissive
  // and untargeted — it matches recruiters too, so without the filter this page
  // would happily render another org's open task (empty, but it shouldn't
  // resolve at all).
  const supabase = await createClient();
  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, brief_md, feedback_visibility, jobs!inner(org_id, title)')
    .eq('id', taskId)
    .eq('jobs.org_id', orgId)
    .maybeSingle();
  if (!task) notFound();

  const [{ data: submissions }, { data: rubrics }, { data: acceptances }] = await Promise.all([
    supabase
      .from('submissions')
      // A3 — the candidate's email, readable because they submitted to this
      // org's task ("users: recruiter read own org candidates").
      .select(
        'id, candidate_id, result_md, status, submitted_at, ' +
          'candidate:users!submissions_candidate_id_fkey(email), ' +
          'conversation_artifacts(raw_md, fetch_status, source_type), ' +
          'evaluations(id, status, error, ran_at, output_json)',
      )
      .eq('task_id', taskId)
      .order('submitted_at', { ascending: false }),
    supabase.from('rubrics').select('id, name').order('created_at', { ascending: false }),
    supabase.from('task_acceptances').select('id').eq('task_id', taskId),
  ]);

  const rubricList = (rubrics as { id: string; name: string }[] | null) ?? [];
  const acceptedCount = acceptances?.length ?? 0;

  return (
    <main className="min-h-dvh">
      <nav className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div>
          <Link href="/recruiter" className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5">
            <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" /> Recruiter dashboard
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink mt-2">{task.title}</h1>
          <p className="text-sm text-muted whitespace-pre-wrap mt-1">{task.brief_md}</p>
          <div className="flex items-center flex-wrap gap-3 mt-3">
            <Link href={`/recruiter/tasks/${taskId}/leaderboard`} className="btn btn-dark btn-sm">
              <FontAwesomeIcon icon={faRankingStar} className="w-3 h-3" /> Leaderboard
            </Link>
            <span className="badge badge-muted">
              <FontAwesomeIcon icon={faHandshake} className="w-2.5 h-2.5" /> {acceptedCount} accepted
            </span>
            {/* A2 — how much of the evaluation candidates may see */}
            <form action={setFeedbackVisibility} className="flex items-center gap-1.5">
              <input type="hidden" name="task_id" value={taskId} />
              <label className="text-xs text-muted">Candidate feedback</label>
              <select
                name="feedback_visibility"
                defaultValue={task.feedback_visibility}
                className="field w-auto h-8 text-xs py-0"
              >
                <option value="none">none</option>
                <option value="score">score only</option>
                <option value="full">score + rationale</option>
              </select>
              <button className="btn btn-ghost btn-sm h-8">Save</button>
            </form>
          </div>
        </div>

        {rubricList.length === 0 && (
          <p className="text-sm text-amber-300 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            Create a rubric on the dashboard before you can evaluate submissions.
          </p>
        )}

        <ul className="space-y-4">
          {(submissions as Submission[] | null)?.map((s) => {
            const artifact = s.conversation_artifacts?.[0];
            // Newest run first. Evaluations are append-only, so re-running a
            // rubric adds a row — ordering by score would surface the flattering
            // old run instead of the current verdict.
            const evals = (s.evaluations ?? [])
              .slice()
              .sort((a, b) => (b.ran_at ?? '').localeCompare(a.ran_at ?? ''));
            return (
              <li key={s.id} className="card p-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  {s.candidate?.email ? (
                    <a href={`mailto:${s.candidate.email}`} className="text-sm font-medium text-accent hover:underline truncate">
                      {s.candidate.email}
                    </a>
                  ) : (
                    <span className="text-xs font-mono text-subtle">candidate {s.candidate_id.slice(0, 8)}…</span>
                  )}
                  <span className="badge badge-muted shrink-0">{s.status}</span>
                </div>

                <details className="mb-2 group">
                  <summary className="text-sm font-semibold text-ink cursor-pointer select-none">Result</summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap bg-elevated border border-hairline rounded-lg p-3 text-ink-soft">{s.result_md}</pre>
                </details>

                {/* §5 metric 4 — opening this is the signal that the process,
                    not just the deliverable, is being looked at. */}
                <TranscriptDisclosure
                  className="mb-3 group"
                  onFirstOpen={recordTranscriptRead.bind(null, s.id)}
                >
                  <summary className="text-sm font-semibold text-ink cursor-pointer select-none">
                    Agent transcript{' '}
                    <span className="text-xs font-normal text-subtle">
                      ({artifact?.source_type ?? 'none'} · {artifact?.fetch_status ?? 'n/a'})
                    </span>
                  </summary>
                  <pre className="mt-2 text-xs whitespace-pre-wrap bg-elevated border border-hairline rounded-lg p-3 text-ink-soft">
                    {artifact?.raw_md ?? '(no transcript / fetch failed)'}
                  </pre>
                </TranscriptDisclosure>

                {/* Trigger evaluation */}
                {rubricList.length > 0 && (
                  <form action={runEvaluate} className="flex items-center gap-2 border-t border-hairline pt-3">
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
                      <li key={e.id} className="rounded-lg bg-elevated border border-hairline p-3">
                        {e.status === 'done' && e.output_json ? (
                          <>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-2xl font-extrabold text-ink tabular-nums">{e.output_json.score ?? '—'}</span>
                              <span className="text-xs text-subtle">/ 100</span>
                              {e.output_json.flags?.map((f) => (
                                <span key={f} className="badge badge-warn">
                                  <FontAwesomeIcon icon={faFlag} className="w-2.5 h-2.5" />{f}
                                </span>
                              ))}
                            </div>
                            <p className="text-xs text-muted mt-1">{e.output_json.rationale}</p>
                          </>
                        ) : (
                          <span className="text-xs text-red-400">{e.status}: {e.error ?? '…'}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {submissions?.length === 0 && <li className="text-sm text-muted">No submissions yet.</li>}
        </ul>
      </div>
    </main>
  );
}
