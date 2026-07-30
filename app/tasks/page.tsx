import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faClock, faHandshake, faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';
import Brand from '@/components/Brand';
import { submitTask, acceptTask } from './actions';

type Task = {
  id: string;
  title: string;
  brief_md: string;
  deadline_at: string | null;
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
    .select('id, title, brief_md, deadline_at, jobs!inner(title, status)')
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
        {userId ? (
          <Link href="/settings" className="btn btn-ghost btn-sm">API key</Link>
        ) : (
          <Link href="/login" className="btn btn-primary btn-sm">Sign in</Link>
        )}
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Open tasks</h1>

        <ul className="space-y-4">
          {(tasks as Task[] | null)?.map((t) => {
            const mine = subsByTask.get(t.id) ?? [];
            const isAccepted = acceptedTasks.has(t.id);
            return (
              <li key={t.id} className="card p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-900">{t.title}</h2>
                  <span className="badge badge-accent shrink-0">{t.jobs.title}</span>
                </div>
                <p className="text-sm text-slate-600 whitespace-pre-wrap mt-1">{t.brief_md}</p>
                {t.deadline_at && (
                  <p className="text-xs text-slate-400 mt-2 inline-flex items-center gap-1">
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
                        <li key={m.id} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-500">
                              {new Date(m.submitted_at).toLocaleString()}
                            </span>
                            <span className="badge badge-muted">{m.status}</span>
                          </div>
                          {fb ? (
                            <div className="mt-2">
                              <div className="flex items-baseline gap-1.5">
                                <span className="text-xl font-extrabold text-slate-900 tabular-nums">
                                  {fb.score ?? '—'}
                                </span>
                                <span className="text-xs text-slate-400">/ 100</span>
                              </div>
                              {fb.rationale && <p className="text-xs text-slate-600 mt-1">{fb.rationale}</p>}
                              {fb.dimensions && fb.dimensions.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                  {fb.dimensions.map((d) => (
                                    <li key={d.name} className="text-xs text-slate-600 flex justify-between gap-3">
                                      <span className="truncate">{d.name}</span>
                                      <span className="tabular-nums font-medium text-slate-800">{d.score}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ) : (
                            m.status === 'evaluated' && (
                              <p className="text-xs text-slate-400 mt-1">
                                Evaluated — this employer doesn’t share feedback.
                              </p>
                            )
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {userId ? (
                  <details className="mt-3 border-t border-slate-100 pt-3">
                    <summary className="text-sm font-semibold cursor-pointer text-sky-700 select-none">Submit work</summary>
                    <form action={submitTask} className="space-y-2 mt-3">
                      <input type="hidden" name="task_id" value={t.id} />
                      <textarea name="result_md" required rows={3} placeholder="Your result / deliverable (markdown)" className="field-area" />
                      <textarea name="conversation_md" rows={3} placeholder="Paste your agent conversation transcript (markdown)" className="field-area" />
                      <div className="text-xs text-slate-400 text-center">— or —</div>
                      <input name="conversation_url" type="url" placeholder="https://link-to-your-agent-conversation" className="field h-9" />
                      <button className="btn btn-primary btn-sm">
                        <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" /> Submit
                      </button>
                    </form>
                  </details>
                ) : (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <Link href="/login" className="btn btn-primary btn-sm">
                      <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" /> Sign in to submit
                    </Link>
                  </div>
                )}
              </li>
            );
          })}
          {tasks?.length === 0 && <li className="text-sm text-slate-500">No open tasks right now.</li>}
        </ul>
      </div>
    </main>
  );
}
