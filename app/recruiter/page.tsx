import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBriefcase, faListCheck, faClipboardCheck, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createServiceClient } from '@/lib/supabase/service';
import Brand from '@/components/Brand';
import { createJob, setJobStatus, addTask, createRubric } from './actions';

type Task = { id: string; title: string; created_at: string };
type Job = { id: string; title: string; status: string; tasks: Task[] };
type Rubric = { id: string; name: string; created_at: string };

const statusBadge = (s: string) =>
  s === 'open' ? 'badge badge-success' : s === 'closed' ? 'badge badge-danger' : 'badge badge-muted';

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
    <main className="min-h-dvh">
      <nav className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
        <Link href="/settings" className="btn btn-ghost btn-sm">Settings & API keys</Link>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Recruiter dashboard</h1>

        {/* Create job */}
        <section className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faBriefcase} className="w-4 h-4 text-sky-700" /> New job
          </h2>
          <form action={createJob} className="flex gap-2">
            <input name="title" required placeholder="Senior Backend Engineer" className="field flex-1" />
            <select name="status" className="field w-auto">
              <option value="open">open</option>
              <option value="draft">draft</option>
            </select>
            <button className="btn btn-primary">Create</button>
          </form>
        </section>

        {/* Jobs + tasks */}
        <section className="space-y-4">
          {(jobs as Job[] | null)?.map((job) => (
            <div key={job.id} className="card p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                  {job.title} <span className={statusBadge(job.status)}>{job.status}</span>
                </h3>
                <form action={setJobStatus} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={job.id} />
                  <select name="status" defaultValue={job.status} className="field w-auto h-8 text-xs py-0">
                    <option value="open">open</option>
                    <option value="draft">draft</option>
                    <option value="closed">closed</option>
                  </select>
                  <button className="btn btn-ghost btn-sm h-8">Set</button>
                </form>
              </div>

              <ul className="space-y-1 mb-3">
                {job.tasks?.map((t) => (
                  <li key={t.id}>
                    <Link href={`/recruiter/tasks/${t.id}`} className="text-sm text-slate-700 hover:text-sky-700 inline-flex items-center gap-1.5">
                      <FontAwesomeIcon icon={faListCheck} className="w-3 h-3 text-slate-400" />
                      {t.title}
                      <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3 text-slate-300" />
                    </Link>
                  </li>
                ))}
                {(!job.tasks || job.tasks.length === 0) && <li className="text-xs text-slate-400">No tasks yet.</li>}
              </ul>

              <form action={addTask} className="space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="job_id" value={job.id} />
                <input name="title" required placeholder="Task title" className="field h-9" />
                <textarea name="brief_md" required rows={2} placeholder="Task brief (markdown) — describe the AI-agent-completable task" className="field-area" />
                <button className="btn btn-dark btn-sm">Add task</button>
              </form>
            </div>
          ))}
          {jobs?.length === 0 && <p className="text-sm text-slate-500">No jobs yet — create one above.</p>}
        </section>

        {/* Rubrics */}
        <section className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faClipboardCheck} className="w-4 h-4 text-sky-700" /> Rubrics
          </h2>
          <ul className="space-y-1 mb-4">
            {(rubrics as Rubric[] | null)?.map((r) => (
              <li key={r.id} className="text-sm text-slate-700 font-medium">{r.name}</li>
            ))}
            {rubrics?.length === 0 && <li className="text-xs text-slate-400">No rubrics yet.</li>}
          </ul>
          <form action={createRubric} className="space-y-2">
            <input name="name" required placeholder="Rubric name" className="field h-9" />
            <textarea name="prompt_md" required rows={3} placeholder="Scoring criteria / prompt (markdown). This is your evaluation logic — the platform runs it against each submission." className="field-area" />
            <button className="btn btn-dark btn-sm">Create rubric</button>
          </form>
        </section>
      </div>
    </main>
  );
}
