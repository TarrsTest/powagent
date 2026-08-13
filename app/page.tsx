import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRight, faBriefcase, faRobot, faChartLine,
  faScaleBalanced, faEye, faGaugeHigh, faShieldHalved,
} from '@fortawesome/free-solid-svg-icons';
import { createClient } from '@/lib/supabase/server';
import Brand from '@/components/Brand';
import ThemeToggle from '@/components/ThemeToggle';

const steps = [
  { icon: faBriefcase, title: 'Post a task', body: 'Recruiters publish real, AI-agent-completable work with a scoring rubric.' },
  { icon: faRobot, title: 'Submit the work', body: 'Candidates do the task with their own agent and submit the result + transcript.' },
  { icon: faChartLine, title: 'Evaluate the process', body: 'The runtime scores how they actually worked — not a résumé.' },
];

const reasons = [
  { icon: faScaleBalanced, title: 'Your rubric, applied evenly', body: 'The same rubric runs against every submission — your criteria, not the platform’s opinion of merit.' },
  { icon: faEye, title: 'See the whole process', body: 'The agent transcript is part of the evidence. Reward good reasoning, catch shortcuts.' },
  { icon: faGaugeHigh, title: 'Faster shortlists', body: 'Ranked candidates the moment work lands — spend review time on the top of the list.' },
  { icon: faShieldHalved, title: 'Consistent & auditable', body: 'Same task, same rubric, same runtime for everyone. Decisions you can defend.' },
];

// Presentational sample for the landing-page preview — mirrors the recruiter ranking view.
const previewRanks = [
  { name: 'Carol Diaz', score: 91, note: 'Dedupe + charge in one transaction — closed the crash-consistency gap.', tone: 'success' },
  { name: 'Alice Chen', score: 88, note: 'Insert-first dedupe, atomicity from the unique key.', tone: 'accent' },
  { name: 'Ben Okoro', score: 54, note: 'Check-then-set has a TOCTOU race; ignored the agent’s own warning.', tone: 'warn' },
] as const;

const barTone: Record<string, string> = {
  success: 'bg-emerald-500',
  accent: 'bg-primary-soft',
  warn: 'bg-amber-500',
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-dvh">
      <nav className="max-w-5xl mx-auto flex items-center justify-between px-6 h-16">
        <Brand />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href={user ? '/dashboard' : '/login'} className="btn btn-ghost btn-sm">
            {user ? 'Dashboard' : 'Sign in'}
          </Link>
        </div>
      </nav>

      <section className="max-w-3xl mx-auto text-center px-6 pt-20 pb-16">
        <span className="badge badge-accent mb-5">AI-native hiring</span>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-ink leading-[1.1]">
          Hire on how people
          <br className="hidden sm:block" /> actually work.
        </h1>
        <p className="text-lg text-muted mt-5 max-w-xl mx-auto">
          powagent evaluates real work samples — the candidate’s output <em>and</em> their agent
          conversation — against your own rubric. Judge the process, not the paperwork.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <Link href={user ? '/dashboard' : '/login'} className="btn btn-primary">
            {user ? 'Open dashboard' : 'Get started'}
            <FontAwesomeIcon icon={faArrowRight} className="w-3.5 h-3.5" />
          </Link>
          <Link href="/tasks" className="btn btn-ghost">
            Browse open tasks
          </Link>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div className="card p-6 sm:p-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs font-mono text-subtle">TASK · RANKED</p>
              <h2 className="font-semibold text-ink">Design a webhook idempotency layer</h2>
            </div>
            <span className="badge badge-accent">3 submissions</span>
          </div>
          <ul className="space-y-3">
            {previewRanks.map((c, i) => (
              <li key={c.name} className="flex items-center gap-4">
                <span className="shrink-0 w-6 text-center text-sm font-mono text-subtle">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ink truncate">{c.name}</span>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-ink">{c.score}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-elevated overflow-hidden">
                    <div className={`h-full rounded-full ${barTone[c.tone]}`} style={{ width: `${c.score}%` }} />
                  </div>
                  <p className="text-xs text-muted mt-1.5">{c.note}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle mt-5 text-center">Illustrative — your rubric, your dimensions.</p>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="card p-6 bg-accent-soft/50 border-accent-line">
              <div className="flex items-center gap-3 mb-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/25 text-accent">
                  <FontAwesomeIcon icon={s.icon} className="w-4 h-4" />
                </span>
                <span className="text-xs font-mono text-subtle">0{i + 1}</span>
              </div>
              <h3 className="font-semibold text-ink">{s.title}</h3>
              <p className="text-sm text-muted mt-1">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="text-center mb-10">
          <span className="badge badge-muted mb-3">Why teams switch</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
            Hiring signal you can trust
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {reasons.map((r) => (
            <div key={r.title} className="card p-6 flex items-start gap-4">
              <span className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-elevated text-accent">
                <FontAwesomeIcon icon={r.icon} className="w-4 h-4" />
              </span>
              <div>
                <h3 className="font-semibold text-ink">{r.title}</h3>
                <p className="text-sm text-muted mt-1">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Brand />
          <p className="text-sm text-muted">
            © {new Date().getFullYear()} powagent — hire on how people actually work.
          </p>
        </div>
      </footer>
    </main>
  );
}
