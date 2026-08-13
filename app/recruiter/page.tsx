import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBriefcase, faListCheck, faClipboardCheck, faArrowRight, faHandshake,
  faUsers, faInbox, faCircleCheck, faRankingStar, faClock, faFlag,
} from '@fortawesome/free-solid-svg-icons';
import { getProfile } from '@/lib/profile';
import { createClient } from '@/lib/supabase/server';
import {
  countEvaluatedSubmissions,
  topCandidatesAcrossTasks,
  type RankableEvaluation,
} from '@/lib/leaderboard';
import { upcomingDeadlines, isPastDeadline } from '@/lib/submissionRules';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';
import { createJob, setJobStatus, addTask, createRubric } from './actions';

type Task = { id: string; title: string; created_at: string; deadline_at: string | null };
type Job = { id: string; title: string; status: string; tasks: Task[] };
type Rubric = { id: string; name: string; created_at: string };
type Submission = {
  id: string;
  task_id: string;
  candidate_id: string;
  submitted_at: string;
  candidate: { email: string | null } | null;
};

const statusBadge = (s: string) =>
  s === 'open' ? 'badge badge-success' : s === 'closed' ? 'badge badge-danger' : 'badge badge-muted';

const scoreTone = (score: number) =>
  score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-primary-soft' : 'bg-amber-500';

/** Coarse on purpose — the exact timestamp lives on the task page. */
const relative = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${Math.max(minutes, 1)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)} days`;
};

export default async function RecruiterPage() {
  const session = await getProfile();
  if (!session) redirect('/login');
  // UX guard only — the policies below are what actually scope the data.
  if (session.profile.role !== 'recruiter' || !session.profile.org_id) redirect('/settings');
  const orgId = session.profile.org_id;

  // Session client throughout, so RLS decides what may be read — no service role
  // on a browser path. Every query still states which rows it WANTS: `jobs/tasks:
  // candidate read open` are permissive and untargeted, so they match a recruiter
  // too and permissive policies OR together. Without the filters this dashboard
  // would count every open job on the platform.
  //
  // Scale note: the overview reads this org's acceptance / submission /
  // evaluation rows and aggregates them in memory. Right for an org with tens of
  // tasks, wrong for one with tens of thousands — at that point this becomes a
  // database view or an RPC, not a bigger page.
  const supabase = await createClient();
  const [{ data: jobsData }, { data: rubrics }, { data: org }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, title, status, tasks(id, title, created_at, deadline_at)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase.from('rubrics').select('id, name, created_at').order('created_at', { ascending: false }),
    supabase.from('organizations').select('name').maybeSingle(),
  ]);

  const jobs = (jobsData as Job[] | null) ?? [];
  const tasks = jobs.flatMap((j) => j.tasks ?? []);
  const taskIds = tasks.map((t) => t.id);

  const [{ data: acceptances }, { data: submissionsData }] = taskIds.length
    ? await Promise.all([
        supabase.from('task_acceptances').select('task_id, candidate_id').in('task_id', taskIds),
        supabase
          .from('submissions')
          .select(
            'id, task_id, candidate_id, submitted_at, ' +
              'candidate:users!submissions_candidate_id_fkey(email)',
          )
          .in('task_id', taskIds),
      ])
    : [{ data: [] }, { data: [] }];

  const acceptanceRows = (acceptances as { task_id: string; candidate_id: string }[] | null) ?? [];
  const submissions = (submissionsData as unknown as Submission[] | null) ?? [];

  const { data: evaluationsData } = submissions.length
    ? await supabase
        .from('evaluations')
        .select('submission_id, status, ran_at, output_json')
        .in(
          'submission_id',
          submissions.map((s) => s.id),
        )
    : { data: [] };
  const evaluations = (evaluationsData as RankableEvaluation[] | null) ?? [];

  // Aggregates. The counting rules that are easy to get wrong live in lib/ and
  // are tested (an errored evaluation is not "evaluated"; a candidate leading two
  // tasks is still one candidate). The rest is arithmetic over rows RLS scoped.
  const openJobs = jobs.filter((j) => j.status === 'open').length;
  const evaluatedCount = countEvaluatedSubmissions(submissions, evaluations);
  const engagedCandidates = new Set([
    ...acceptanceRows.map((a) => a.candidate_id),
    ...submissions.map((s) => s.candidate_id),
  ]).size;
  const ranked = topCandidatesAcrossTasks(tasks, submissions, evaluations, 5);
  const closingSoon = upcomingDeadlines(tasks, new Date(), 4);
  const pastDeadline = tasks.filter((t) => isPastDeadline(t.deadline_at)).length;

  const acceptCount = new Map<string, number>();
  for (const a of acceptanceRows) acceptCount.set(a.task_id, (acceptCount.get(a.task_id) ?? 0) + 1);
  const submissionCount = new Map<string, number>();
  for (const s of submissions) submissionCount.set(s.task_id, (submissionCount.get(s.task_id) ?? 0) + 1);

  const stats = [
    { icon: faBriefcase, value: jobs.length, label: 'Jobs', sub: `${openJobs} open` },
    {
      icon: faListCheck,
      value: tasks.length,
      label: 'Tasks',
      sub: pastDeadline > 0 ? `${pastDeadline} past deadline` : 'none past deadline',
    },
    { icon: faUsers, value: engagedCandidates, label: 'Candidates', sub: 'accepted or submitted' },
    {
      icon: faInbox,
      value: submissions.length,
      label: 'Submissions',
      sub: `${acceptanceRows.length} acceptances`,
    },
    {
      icon: faCircleCheck,
      value: evaluatedCount,
      label: 'Evaluated',
      sub: `of ${submissions.length} submission${submissions.length === 1 ? '' : 's'}`,
    },
  ];

  return (
    <main className="min-h-dvh">
      <nav className="max-w-3xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand href="/dashboard" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/settings" className="btn btn-ghost btn-sm">Settings &amp; API keys</Link>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Recruiter dashboard</h1>
          <p className="text-sm text-muted mt-1">{org?.name ?? 'Your organization'}</p>
        </div>

        {/* Overview — the whole org at a glance, so nobody has to click through
            every job to find out whether anything is happening. */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="card p-4">
              <FontAwesomeIcon icon={s.icon} className="w-3.5 h-3.5 text-subtle" />
              <p className="text-2xl font-extrabold text-ink tabular-nums mt-2 leading-none">
                {s.value}
              </p>
              <p className="text-xs font-semibold text-ink-soft mt-1.5">{s.label}</p>
              <p className="text-[11px] text-subtle leading-tight">{s.sub}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Top candidates — same ranking rules as the per-task leaderboard */}
          <section className="card p-6">
            <h2 className="font-semibold text-ink mb-1 flex items-center gap-2">
              <FontAwesomeIcon icon={faRankingStar} className="w-4 h-4 text-accent" /> Top candidates
            </h2>
            <p className="text-xs text-muted mb-4">Best score per candidate, across all your tasks.</p>
            {ranked.length === 0 ? (
              <p className="text-sm text-muted">
                {submissions.length === 0
                  ? 'No submissions yet — candidates appear here once they submit.'
                  : 'Nothing scored yet. Open a task and evaluate a submission against a rubric.'}
              </p>
            ) : (
              <ul className="space-y-3">
                {ranked.map((c, i) => (
                  <li key={c.candidateId} className="flex items-start gap-3">
                    <span className="shrink-0 w-4 text-center text-xs font-mono text-subtle mt-1">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink truncate">
                          {c.email ?? `candidate ${c.candidateId.slice(0, 8)}…`}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                          {c.score}
                        </span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-elevated overflow-hidden">
                        <div
                          className={`h-full rounded-full ${scoreTone(c.score)}`}
                          style={{ width: `${c.score}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <Link
                          href={`/recruiter/tasks/${c.taskId}/leaderboard`}
                          className="text-[11px] text-muted hover:text-accent truncate"
                        >
                          {c.taskTitle}
                        </Link>
                        {c.evaluation.output_json?.flags?.map((f) => (
                          <span key={f} className="badge badge-warn">
                            <FontAwesomeIcon icon={faFlag} className="w-2 h-2" />
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Closing soon */}
          <section className="card p-6">
            <h2 className="font-semibold text-ink mb-1 flex items-center gap-2">
              <FontAwesomeIcon icon={faClock} className="w-4 h-4 text-accent" /> Closing soon
            </h2>
            <p className="text-xs text-muted mb-4">Tasks that stop accepting submissions next.</p>
            {closingSoon.length === 0 ? (
              <p className="text-sm text-muted">
                {tasks.length === 0
                  ? 'No tasks yet.'
                  : pastDeadline > 0
                    ? 'Nothing upcoming — every dated task has already closed.'
                    : 'No deadlines set. Add one when creating a task if you want a cut-off.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {closingSoon.map(({ task, msRemaining }) => (
                  <li key={task.id} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/recruiter/tasks/${task.id}`}
                      className="text-sm text-ink-soft hover:text-accent truncate"
                    >
                      {task.title}
                    </Link>
                    <span
                      className={`badge shrink-0 ${msRemaining < 24 * 3600_000 ? 'badge-warn' : 'badge-muted'}`}
                    >
                      {relative(msRemaining)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Create job */}
        <section className="card p-6">
          <h2 className="font-semibold text-ink mb-3 flex items-center gap-2">
            <FontAwesomeIcon icon={faBriefcase} className="w-4 h-4 text-accent" /> New job
          </h2>
          <form action={createJob} className="flex gap-2">
            <input name="title" required placeholder="Senior Backend Engineer" className="field flex-1" />
            <select name="status" className="field w-auto">
              <option value="open">open</option>
              <option value="draft">draft</option>
            </select>
            <button className="btn btn-primary">Create</button>
          </form>
          <p className="text-xs text-subtle mt-2">
            Candidates only see tasks under an <span className="font-medium text-muted">open</span> job.
          </p>
        </section>

        {/* Jobs + tasks */}
        <section className="space-y-4">
          {jobs.map((job) => (
            <div key={job.id} className="card p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-ink flex items-center gap-2">
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
                  <li key={t.id} className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/recruiter/tasks/${t.id}`}
                      className="text-sm text-ink-soft hover:text-accent inline-flex items-center gap-1.5"
                    >
                      <FontAwesomeIcon icon={faListCheck} className="w-3 h-3 text-subtle" />
                      {t.title}
                      <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3 text-subtle" />
                    </Link>
                    {(acceptCount.get(t.id) ?? 0) > 0 && (
                      <span className="badge badge-muted" title="candidates who accepted this task">
                        <FontAwesomeIcon icon={faHandshake} className="w-2.5 h-2.5" />
                        {acceptCount.get(t.id)}
                      </span>
                    )}
                    {(submissionCount.get(t.id) ?? 0) > 0 && (
                      <span className="badge badge-accent" title="submissions received">
                        <FontAwesomeIcon icon={faInbox} className="w-2.5 h-2.5" />
                        {submissionCount.get(t.id)}
                      </span>
                    )}
                    {isPastDeadline(t.deadline_at) && (
                      <span className="badge badge-danger" title="deadline passed — no longer accepting submissions">
                        closed
                      </span>
                    )}
                  </li>
                ))}
                {(!job.tasks || job.tasks.length === 0) && (
                  <li className="text-xs text-subtle">No tasks yet.</li>
                )}
              </ul>

              <details className="border-t border-hairline pt-3">
                <summary className="text-sm font-semibold cursor-pointer text-accent select-none">
                  Add a task
                </summary>
                <form action={addTask} className="space-y-2 mt-3">
                  <input type="hidden" name="job_id" value={job.id} />
                  <input name="title" required placeholder="Task title" className="field h-9" />
                  <textarea
                    name="brief_md"
                    required
                    rows={2}
                    placeholder="Task brief (markdown) — describe the AI-agent-completable task"
                    className="field-area"
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted shrink-0">Candidate feedback</label>
                    <select name="feedback_visibility" defaultValue="none" className="field w-auto h-8 text-xs py-0">
                      <option value="none">none</option>
                      <option value="score">score only</option>
                      <option value="full">score + rationale</option>
                    </select>
                  </div>
                  <button className="btn btn-dark btn-sm">Add task</button>
                </form>
              </details>
            </div>
          ))}
          {jobs.length === 0 && (
            <div className="card p-6 text-center">
              <p className="text-sm text-muted">No jobs yet.</p>
              <p className="text-xs text-subtle mt-1">
                Create one above, add a task describing real work, then write a rubric to score it.
              </p>
            </div>
          )}
        </section>

        {/* Rubrics */}
        <section className="card p-6">
          <h2 className="font-semibold text-ink mb-1 flex items-center gap-2">
            <FontAwesomeIcon icon={faClipboardCheck} className="w-4 h-4 text-accent" /> Rubrics
          </h2>
          <p className="text-xs text-muted mb-3">
            Your scoring logic. A submission can only be evaluated once a rubric exists.
          </p>
          <ul className="space-y-1 mb-4">
            {(rubrics as Rubric[] | null)?.map((r) => (
              <li key={r.id} className="text-sm text-ink-soft font-medium">{r.name}</li>
            ))}
            {rubrics?.length === 0 && <li className="text-xs text-subtle">No rubrics yet.</li>}
          </ul>
          <details>
            <summary className="text-sm font-semibold cursor-pointer text-accent select-none">
              New rubric
            </summary>
            <form action={createRubric} className="space-y-2 mt-3">
              <input name="name" required placeholder="Rubric name" className="field h-9" />
              <textarea
                name="prompt_md"
                required
                rows={3}
                placeholder="Scoring criteria / prompt (markdown). This is your evaluation logic — the platform runs it against each submission."
                className="field-area"
              />
              <button className="btn btn-dark btn-sm">Create rubric</button>
            </form>
          </details>
        </section>
      </div>
    </main>
  );
}
