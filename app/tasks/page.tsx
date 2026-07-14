import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faClock } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
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
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Open tasks</h1>
          <Link href="/settings" className="text-sm text-violet-600 hover:underline">API key</Link>
        </header>

        <ul className="space-y-4">
          {(tasks as Task[] | null)?.map((t) => {
            const mine = subsByTask.get(t.id) ?? [];
            return (
              <li key={t.id} className="rounded-xl border border-zinc-200 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{t.title}</h2>
                  <span className="text-xs text-zinc-400">{t.jobs.title}</span>
                </div>
                <p className="text-sm text-zinc-600 whitespace-pre-wrap mt-1">{t.brief_md}</p>
                {t.deadline_at && (
                  <p className="text-xs text-zinc-400 mt-2 inline-flex items-center gap-1">
                    <FontAwesomeIcon icon={faClock} className="w-3 h-3" /> due {new Date(t.deadline_at).toLocaleDateString()}
                  </p>
                )}

                {mine.length > 0 && (
                  <p className="text-xs text-zinc-500 mt-2">
                    Your submissions: {mine.map((m) => m.status).join(', ')}
                  </p>
                )}

                <details className="mt-3 border-t border-zinc-100 pt-3">
                  <summary className="text-sm font-semibold cursor-pointer text-violet-700">Submit work</summary>
                  <form action={submitTask} className="space-y-2 mt-3">
                    <input type="hidden" name="task_id" value={t.id} />
                    <textarea name="result_md" required rows={3} placeholder="Your result / deliverable (markdown)" className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
                    <textarea name="conversation_md" rows={3} placeholder="Paste your agent conversation transcript (markdown)" className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
                    <div className="text-xs text-zinc-400 text-center">— or —</div>
                    <input name="conversation_url" type="url" placeholder="https://link-to-your-agent-conversation" className="w-full h-9 px-3 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
                    <button className="h-9 px-4 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 inline-flex items-center gap-1.5">
                      <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" /> Submit
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
          {tasks?.length === 0 && <li className="text-sm text-zinc-500">No open tasks right now.</li>}
        </ul>
      </div>
    </main>
  );
}
