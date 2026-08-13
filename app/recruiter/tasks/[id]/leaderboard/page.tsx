import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faFlag, faRankingStar } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import { rankCandidates, type RankableEvaluation } from '@/lib/leaderboard';
import Brand from '@/components/Brand';

type Sub = {
  id: string;
  candidate_id: string;
  submitted_at: string;
  candidate: { email: string | null } | null;
  evaluations: RankableEvaluation[];
};

const barTone = (score: number) =>
  score >= 80 ? 'bg-success-bar' : score >= 60 ? 'bg-info-bar' : 'bg-warn-bar';

// A5 — the ranked view the landing page has always promised. Ranking rules
// live in lib/leaderboard.ts, shared with GET /v1/evaluations.
export default async function LeaderboardPage(props: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await props.params;
  const session = await getProfile();
  if (!session) redirect('/login');
  if (session.profile.role !== 'recruiter' || !session.profile.org_id) redirect('/settings');
  const orgId = session.profile.org_id;

  // org_id filter for the same reason as the submissions view: the permissive
  // `tasks: candidate read open` policy also matches recruiters, so the task
  // lookup must state which org's task it wants.
  const supabase = await createClient();
  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, jobs!inner(org_id, title)')
    .eq('id', taskId)
    .eq('jobs.org_id', orgId)
    .maybeSingle();
  if (!task) notFound();

  const { data: submissions } = await supabase
    .from('submissions')
    .select(
      'id, candidate_id, submitted_at, ' +
        'candidate:users!submissions_candidate_id_fkey(email), ' +
        'evaluations(submission_id, status, ran_at, output_json)',
    )
    .eq('task_id', taskId);

  const subs = (submissions as Sub[] | null) ?? [];
  const ranked = rankCandidates(
    subs,
    subs.flatMap((s) => s.evaluations ?? []),
  );
  const unscored = subs.length - ranked.length;

  return (
    <main className="min-h-dvh">
      <nav className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div>
          <Link
            href={`/recruiter/tasks/${taskId}`}
            className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" /> Submissions
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink mt-2 flex items-center gap-2">
            <FontAwesomeIcon icon={faRankingStar} className="w-5 h-5 text-accent" />
            {task.title}
          </h1>
          <p className="text-sm text-muted mt-1">
            {ranked.length} ranked{unscored > 0 && ` · ${unscored} awaiting evaluation`}
          </p>
        </div>

        {ranked.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing ranked yet — evaluate at least one submission from the{' '}
            <Link href={`/recruiter/tasks/${taskId}`} className="text-accent hover:underline">
              submissions view
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-3">
            {ranked.map((c, i) => (
              <li key={c.candidateId} className="card p-5 flex items-start gap-4">
                <span className="shrink-0 w-7 text-center text-sm font-mono text-subtle mt-0.5">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="font-medium text-accent hover:underline truncate">
                        {c.email}
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-subtle truncate">
                        candidate {c.candidateId.slice(0, 8)}…
                      </span>
                    )}
                    <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{c.score}</span>
                  </div>

                  <div className="mt-1.5 h-1.5 rounded-full bg-elevated overflow-hidden">
                    <div className={`h-full rounded-full ${barTone(c.score)}`} style={{ width: `${c.score}%` }} />
                  </div>

                  {c.evaluation.output_json?.rationale && (
                    <p className="text-xs text-muted mt-1.5">{c.evaluation.output_json.rationale}</p>
                  )}

                  <div className="flex items-center flex-wrap gap-1.5 mt-2">
                    {c.evaluation.output_json?.dimensions?.map((d) => (
                      <span key={d.name} className="badge badge-muted">
                        {d.name} {d.score}
                      </span>
                    ))}
                    {c.evaluation.output_json?.flags?.map((f) => (
                      <span key={f} className="badge badge-warn">
                        <FontAwesomeIcon icon={faFlag} className="w-2.5 h-2.5" />
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
