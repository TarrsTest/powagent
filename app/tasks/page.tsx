import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faClock } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
import Brand from '@/components/Brand';
import { submitTask } from './actions';

type Task = {
  id: string;
  title: string;
  brief_md: string;
  deadline_at: string | null;
  jobs: { title: string };
};
type Sub = { id: string; task_id: string; status: string; submitted_at: string };

export default async function TasksPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  const { userId } = session;

  const db = createServiceClient();
  const [{ data: tasks }, { data: subs }] = await Promise.all([
    db
      .from('tasks')
      .select('id, title, brief_md, deadline_at, jobs!inner(title, status)')
      .eq('jobs.status', 'open')
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('submissions')
      .select('id, task_id, status, submitted_at')
      .eq('candidate_id', userId)
      .order('submitted_at', { ascending: false }),
  ]);

  const mySubs = (subs as Sub[] | null) ?? [];
  const subsByTask = new Map<string, Sub[]>();
  for (const s of mySubs) subsByTask.set(s.task_id, [...(subsByTask.get(s.task_id) ?? []), s]);

  return (
    <main className="min-h-dvh">
      <nav className="max-w-2xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
        <Link href="/settings" className="btn btn-ghost btn-sm">API key</Link>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Open tasks</h1>

        <ul className="space-y-4">
          {(tasks as Task[] | null)?.map((t) => {
            const mine = subsByTask.get(t.id) ?? [];
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

                {mine.length > 0 && (
                  <p className="text-xs text-slate-500 mt-2">
                    Your submissions: {mine.map((m) => m.status).join(', ')}
                  </p>
                )}

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
              </li>
            );
          })}
          {tasks?.length === 0 && <li className="text-sm text-slate-500">No open tasks right now.</li>}
        </ul>
      </div>
    </main>
  );
}
