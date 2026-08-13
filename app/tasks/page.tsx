import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faClock, faHandshake, faCircleCheck, faLock } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';
import { checkSubmissionAllowed } from '@/lib/submissionRules';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import { acceptTask } from './actions';
import SubmitWorkForm from './SubmitWorkForm';

type Task = {
  id: string;
  title: string;
  brief_md: string;
  deadline_at: string | null;
  max_submissions_per_candidate: number | null;
  jobs: { title: string };
};
type Sub = { id: string; task_id: string; status: string; submitted_at: string };
type Feedback = {
  submission_id: string;
  task_id: string;
  visibility: 'score' | 'full';
  score: number | null;
  rationale: string | null;
  dimensions: { name: string; score: number; comment: string }[] | null;
};

export default async function TasksPage() {
  // Open tasks are public — anyone can browse without signing in. Signing in is
  // only required to submit (and to see your own submissions).
  //
  // Session client throughout, and every query below states which rows it wants
  // rather than leaning on RLS to imply them. RLS decides what MAY be read; on
  // this page that is a wider set than what the page means, because several
  // policies are permissive and untargeted and therefore also match a signed-in
  // recruiter:
  //   · `tasks: recruiter manage own org` would add their own draft/closed
  //     tasks to a list titled "Open tasks";
  //   · `submissions: recruiter read own org` would render other candidates'
  //     submissions under "your submissions";
  //   · `acceptances: recruiter read own org` would light up "Accepted" on
  //     tasks the viewer never accepted.
  // Hence the three filters. This is the candidate's view of open work.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const { data: tasks } = await supabase
    .from('tasks')
    .select(
      'id, title, brief_md, deadline_at, max_submissions_per_candidate, jobs!inner(title, status)',
    )
    .eq('jobs.status', 'open')
    .order('created_at', { ascending: false })
    .limit(100);

  const subsByTask = new Map<string, Sub[]>();
  const feedbackBySub = new Map<string, Feedback>();
  const acceptedTasks = new Set<string>();

  if (userId) {
    const [{ data: subs }, { data: accepted }, { data: feedback }] = await Promise.all([
      supabase
        .from('submissions')
        .select('id, task_id, status, submitted_at')
        .eq('candidate_id', userId)
        .order('submitted_at', { ascending: false }),
      supabase.from('task_acceptances').select('task_id').eq('candidate_id', userId),
      // A2 — redaction happens inside the function, not here (see migration 004).
      supabase.rpc('my_feedback'),
    ]);

    for (const s of (subs as Sub[] | null) ?? []) {
      subsByTask.set(s.task_id, [...(subsByTask.get(s.task_id) ?? []), s]);
    }
    for (const a of (accepted as { task_id: string }[] | null) ?? []) {
      acceptedTasks.add(a.task_id);
    }
    for (const f of (feedback as Feedback[] | null) ?? []) {
      feedbackBySub.set(f.submission_id, f);
    }
  }

  return (
    <main className="min-h-dvh">
      <nav className="max-w-2xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href={userId ? '/dashboard' : '/'} />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {userId ? (
            <Link href="/settings" className="btn btn-ghost btn-sm">API key</Link>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm">Sign in</Link>
          )}
        </div>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Open tasks</h1>

        <ul className="space-y-4">
          {(tasks as Task[] | null)?.map((t) => {
            const mine = subsByTask.get(t.id) ?? [];
            const isAccepted = acceptedTasks.has(t.id);
            // Same rules the Server Action enforces, applied here so a closed
            // task — or one this candidate has not accepted yet — explains
            // itself instead of offering a form that will refuse.
            const denial = userId
              ? checkSubmissionAllowed(t, { existingCount: mine.length, hasAccepted: isAccepted })
              : null;
            return (
              <li key={t.id} className="card p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-ink">{t.title}</h2>
                  <span className="badge badge-accent shrink-0">{t.jobs.title}</span>
                </div>
                <p className="text-sm text-muted whitespace-pre-wrap mt-1">{t.brief_md}</p>
                {t.deadline_at && (
                  <p className="text-xs text-subtle mt-2 inline-flex items-center gap-1">
                    <FontAwesomeIcon icon={faClock} className="w-3 h-3" /> due {new Date(t.deadline_at).toLocaleDateString()}
                  </p>
                )}

                {/* A1 — accept, so the employer can see who's working on it */}
                {userId && (
                  <div className="mt-3">
                    {isAccepted ? (
                      <span className="badge badge-success">
                        <FontAwesomeIcon icon={faCircleCheck} className="w-2.5 h-2.5" /> Accepted
                      </span>
                    ) : (
                      <form action={acceptTask}>
                        <input type="hidden" name="task_id" value={t.id} />
                        <button className="btn btn-ghost btn-sm">
                          <FontAwesomeIcon icon={faHandshake} className="w-3 h-3" /> Accept task
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {/* Your submissions + A2 feedback, when the employer shares it */}
                {mine.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {mine.map((m) => {
                      const fb = feedbackBySub.get(m.id);
                      return (
                        <li key={m.id} className="rounded-lg bg-elevated border border-hairline px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted">
                              {new Date(m.submitted_at).toLocaleString()}
                            </span>
                            <span className="badge badge-muted">{m.status}</span>
                          </div>
                          {fb ? (
                            <div className="mt-2">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-xl font-extrabold text-ink tabular-nums">
                                  {fb.score ?? '—'}
                                </span>
                                <span className="text-xs text-subtle">/ 100</span>
                              </div>
                              {fb.rationale && <p className="text-xs text-muted mt-1">{fb.rationale}</p>}
                              {fb.dimensions && fb.dimensions.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                  {fb.dimensions.map((d) => (
                                    <li key={d.name} className="text-xs text-muted flex justify-between gap-3">
                                      <span className="truncate">{d.name}</span>
                                      <span className="tabular-nums font-medium text-ink">{d.score}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : (
                            m.status === 'evaluated' && (
                              <p className="text-xs text-subtle mt-1">
                                Evaluated — this employer doesn’t share feedback.
                              </p>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {!userId ? (
                  <div className="mt-3 border-t border-hairline pt-3">
                    <Link href="/login" className="btn btn-primary btn-sm">
                      <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" /> Sign in to submit
                    </Link>
                  </div>
                ) : denial ? (
                  <div className="mt-3 border-t border-hairline pt-3">
                    <p className="text-sm text-muted flex items-start gap-2">
                      <FontAwesomeIcon icon={faLock} className="w-3.5 h-3.5 mt-0.5 shrink-0 text-subtle" />
                      {denial.message}
                    </p>
                  </div>
                ) : (
                  <SubmitWorkForm taskId={t.id} />
                )}
              </li>
            );
          })}
          {tasks?.length === 0 && <li className="text-sm text-muted">No open tasks right now.</li>}
        </ul>
      </div>
    </main>
  );
}
