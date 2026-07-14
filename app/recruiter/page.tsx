import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBriefcase, faListCheck, faClipboardCheck, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
import { createJob, setJobStatus, addTask, createRubric } from './actions';

type Task = { id: string; title: string; created_at: string };
type Job = { id: string; title: string; status: string; tasks: Task[] };
type Rubric = { id: string; name: string; created_at: string };

export default async function RecruiterPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  if (session.profile.role !== 'recruiter' || !session.profile.org_id) redirect('/settings');
  const orgId = session.profile.org_id;

  const db = createServiceClient();
  const [{ data: jobs }, { data: rubrics }] = await Promise.all([
    db
      .from('jobs')
      .select('id, title, status, tasks(id, title, created_at)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    db.from('rubrics').select('id, name, created_at').eq('org_id', orgId).order('created_at', { ascending: false }),
  ]);

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Recruiter dashboard</h1>
          <Link href="/settings" className="text-sm text-violet-600 hover:underline">Settings & API keys</Link>
        </header>

        {/* Create job */}
        <section className="rounded-xl border border-zinc-200 p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faBriefcase} className="w-4 h-4 text-violet-600" /> New job
          </h2>
          <form action={createJob} className="flex gap-2">
            <input name="title" required placeholder="Senior Backend Engineer" className="flex-1 h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:border-violet-500" />
            <select name="status" className="h-10 px-2 rounded-lg border border-zinc-300 text-sm">
              <option value="open">open</option>
              <option value="draft">draft</option>
            </select>
            <button className="h-10 px-4 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700">Create</button>
          </form>
        </section>

        {/* Jobs + tasks */}
        <section className="space-y-4">
          {(jobs as Job[] | null)?.map((job) => (
            <div key={job.id} className="rounded-xl border border-zinc-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">
                  {job.title} <span className="ml-2 text-xs font-mono text-zinc-400">{job.status}</span>
                </h3>
                <form action={setJobStatus} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={job.id} />
                  <select name="status" defaultValue={job.status} className="h-8 px-2 rounded border border-zinc-300 text-xs">
                    <option value="open">open</option>
                    <option value="draft">draft</option>
                    <option value="closed">closed</option>
                  </select>
                  <button className="h-8 px-2 rounded border border-zinc-200 text-xs hover:bg-zinc-50">Set</button>
                </form>
              </div>

              <ul className="space-y-1 mb-3">
                {job.tasks?.map((t) => (
                  <li key={t.id}>
                    <Link href={`/recruiter/tasks/${t.id}`} className="text-sm text-zinc-700 hover:text-violet-600 inline-flex items-center gap-1.5">
                      <FontAwesomeIcon icon={faListCheck} className="w-3 h-3 text-zinc-400" />
                      {t.title}
                      <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3 text-zinc-300" />
                    </Link>
                  </li>
                ))}
                {(!job.tasks || job.tasks.length === 0) && <li className="text-xs text-zinc-400">No tasks yet.</li>}
              </ul>

              <form action={addTask} className="space-y-2 border-t border-zinc-100 pt-3">
                <input type="hidden" name="job_id" value={job.id} />
                <input name="title" required placeholder="Task title" className="w-full h-9 px-3 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
                <textarea name="brief_md" required rows={2} placeholder="Task brief (markdown) — describe the AI-agent-completable task" className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
                <button className="h-9 px-3 rounded-lg bg-zinc-800 text-white text-xs font-semibold hover:bg-zinc-700">Add task</button>
              </form>
            </div>
          ))}
          {jobs?.length === 0 && <p className="text-sm text-zinc-500">No jobs yet — create one above.</p>}
        </section>

        {/* Rubrics */}
        <section className="rounded-xl border border-zinc-200 p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faClipboardCheck} className="w-4 h-4 text-violet-600" /> Rubrics
          </h2>
          <ul className="space-y-1 mb-4">
            {(rubrics as Rubric[] | null)?.map((r) => (
              <li key={r.id} className="text-sm text-zinc-700 font-mono">{r.name}</li>
            ))}
            {rubrics?.length === 0 && <li className="text-xs text-zinc-400">No rubrics yet.</li>}
          </ul>
          <form action={createRubric} className="space-y-2">
            <input name="name" required placeholder="Rubric name" className="w-full h-9 px-3 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
            <textarea name="prompt_md" required rows={3} placeholder="Scoring criteria / prompt (markdown). This is your evaluation logic — the platform runs it against each submission." className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm focus:outline-none focus:border-violet-500" />
            <button className="h-9 px-3 rounded-lg bg-zinc-800 text-white text-xs font-semibold hover:bg-zinc-700">Create rubric</button>
          </form>
        </section>
      </div>
    </main>
  );
}
